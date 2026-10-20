import * as assert from 'assert';
import * as vscode from 'vscode';
import { RecordingPort } from '@jawata/chat-core/test-support';
import type { JawataChatApi } from '../extension';

/** The command that shows the sessions the agent has: with no session open, it opens the chat and lists them (R6: one session, titled Pong). */
suite('Open Session', function () {
	this.timeout(60000);
	const node = process.env.npm_node_execpath || 'node';
	const api = async () => (await vscode.extensions.getExtension<JawataChatApi | undefined>('jawata.jawata-chat')!.activate())!;
	const config = () => vscode.workspace.getConfiguration('jawataChat');

	suiteTeardown(async () => {
		await vscode.commands.executeCommand('jawataChat.disconnectAgent');
		await config().update('agent', undefined, vscode.ConfigurationTarget.Global);
	});

	test('with no session open, the command lists the agent\'s sessions to the chat', async () => {
		await vscode.commands.executeCommand('jawataChat.disconnectAgent'); // an agent an earlier test left running would answer, not this one
		await config().update('agent', { command: node, args: [require.resolve('@jawata/acp-contract/replay'), require.resolve('@jawata/acp-contract/sessions/R6.jsonl')] }, vscode.ConfigurationTarget.Global);
		const { chat } = await api();
		const port = new RecordingPort();
		chat.attach(port);
		await vscode.commands.executeCommand('jawataChat.openSession');
		const lists = port.toView.filter(m => m.type === 'sessionList') as { type: 'sessionList'; show?: boolean; sessions: { title?: string | null }[] }[];
		assert.strictEqual(lists.length, 1, `the chat was told the agent's sessions; it was told: ${JSON.stringify(port.toView.map(m => m.type === 'error' ? m : m.type))}`);
		assert.strictEqual(lists[0].show, true, 'and asked to show it');
		assert.strictEqual(lists[0].sessions.length, 1);
		assert.strictEqual(lists[0].sessions[0].title, 'Pong');
	});
});
