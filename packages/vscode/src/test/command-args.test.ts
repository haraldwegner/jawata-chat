import * as assert from 'assert';
import * as vscode from 'vscode';
import type { ChatController } from '@jawata/chat-core';
import { chatCommands } from '../commands';

/**
 * Every command a harness drives takes its argument, so it can be bound to a key or called by another extension without a person
 * answering a dialog (ledger 28i-C56-3): send a prompt, set a mode or a model, attach a file, open a session.
 */
suite('Commands take their arguments', () => {
	function fakeChat() {
		const did: unknown[] = [];
		const chat = {
			flow: { open: async (id: string) => { did.push(['open', id]); }, connect: async () => { did.push(['connect']); } },
			handle: async (intent: unknown) => { did.push(['handle', intent]); },
			attachFile: (path: string) => { did.push(['attach', path]); },
			sendPrompt: async (text: string) => { did.push(['prompt', text]); },
			showHistory: async () => { did.push(['history']); },
		};
		return { chat: chat as unknown as ChatController, did };
	}
	const commands = (chat: ChatController) => chatCommands({ chat, showChat: async () => undefined });

	test('attachFile takes a path, or the file the explorer passes, and asks nothing', async () => {
		const { chat, did } = fakeChat();
		await commands(chat).attachFile('/w/notes.txt');
		await commands(chat).attachFile(vscode.Uri.file('/w/other.txt'));
		assert.deepStrictEqual(did, [['attach', '/w/notes.txt'], ['attach', vscode.Uri.file('/w/other.txt').fsPath]]);
	});

	test('openSession takes the id of a session and opens it, without the list', async () => {
		const { chat, did } = fakeChat();
		await commands(chat).openSession('s-42');
		assert.deepStrictEqual(did, [['open', 's-42']]);
	});

	test('setAutonomy takes on or off, and with nothing asks for the opposite of what the agent reports', async () => {
		const { chat, did } = fakeChat();
		const reporting = (value: string) => ({ ...chat, snapshot: () => ({ session: { configOptions: [{ id: 'autonomy', type: 'select', currentValue: value, options: [] }] } }) }) as unknown as ChatController;
		await commands(chat).setAutonomy('on');
		await commands(chat).setAutonomy('off');
		await commands(reporting('off')).setAutonomy();
		await commands(reporting('on')).setAutonomy();
		const intent = (value: string) => ['handle', { type: 'setConfigOption', configId: 'autonomy', value }];
		assert.deepStrictEqual(did, [intent('on'), intent('off'), intent('on'), intent('off')]);
	});

	test('askSide takes the question, shows the chat and sends it as the side intent, and asks nothing', async () => {
		const { chat, did } = fakeChat();
		const shown: string[] = [];
		const withShow = chatCommands({ chat, showChat: async () => { shown.push('shown'); return undefined; } });
		await withShow.askSide('what time is it');
		assert.deepStrictEqual(did, [['handle', { type: 'askSide', text: 'what time is it' }]]);
		assert.deepStrictEqual(shown, ['shown']);
	});

	test('sendPrompt, setMode and setModel take theirs', async () => {
		const { chat, did } = fakeChat();
		await commands(chat).sendPrompt('hello');
		await commands(chat).setMode('plan');
		await commands(chat).setModel('m1');
		assert.deepStrictEqual(did, [['prompt', 'hello'], ['handle', { type: 'setMode', modeId: 'plan' }], ['handle', { type: 'setModel', modelId: 'm1' }]]);
	});
});
