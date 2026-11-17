import * as assert from 'assert';
import * as vscode from 'vscode';
import type { JawataChatApi } from '../extension';
import type { VscodeNotifier } from '../host/VscodeNotifier';

/**
 * 28h D57 (e), in a VS Code started for it (`.vscode-test.mjs`, label `start`): the workspace's settings name an agent (the recorded turn of the
 * jawata agent, R1-jawata), and with no command run the chat is open and connected when the window has started, and answers a message.
 */
suite('The chat opens connected at start', function () {
	this.timeout(120000);

	test('with no click the chat is open, connected, and answers a message', async () => {
		const api = (await vscode.extensions.getExtension<JawataChatApi | undefined>('jawata.jawata-chat')!.activate())!;
		await api.started;

		assert.ok(api.chat.hasPage, 'the chat is open');
		assert.ok(api.sessionManager.getActiveSession(), `a session is open; the person was told: ${JSON.stringify((api.host.notifier as VscodeNotifier).told)}`);

		await vscode.commands.executeCommand('jawataChat.sendPrompt', 'Reply with exactly the one word: done');
		const answered = JSON.stringify(api.chat.snapshot().entries);
		assert.ok(answered.includes('done'), `the agent's answer is in the chat: ${answered.slice(0, 600)}`);
	});
});
