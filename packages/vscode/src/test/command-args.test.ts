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

	test('sendPrompt, setMode and setModel take theirs', async () => {
		const { chat, did } = fakeChat();
		await commands(chat).sendPrompt('hello');
		await commands(chat).setMode('plan');
		await commands(chat).setModel('m1');
		assert.deepStrictEqual(did, [['prompt', 'hello'], ['handle', { type: 'setMode', modeId: 'plan' }], ['handle', { type: 'setModel', modelId: 'm1' }]]);
	});
});
