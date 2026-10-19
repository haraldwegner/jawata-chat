import * as assert from 'assert';
import * as vscode from 'vscode';

/**
 * One chat: with the recorded hires of R4 played (two concurrent sub-agent tool calls) the chat opens
 * no tab and no webview panel. The chat is the one view in the side bar (a view the editor's API cannot
 * count, so what is measured is that nothing else opens); a hire is shown inside it (S14), never as
 * something of its own in the editor. That a second connect starts no second session is chat-core's
 * test (flow.test.mjs).
 */
suite('One chat', function () {
	this.timeout(60000);
	const tabs = () => vscode.window.tabGroups.all.flatMap(g => g.tabs).map(t => t.label);

	test('R4: the hires are played and no tab and no webview panel is opened', async () => {
		await vscode.commands.executeCommand('jawataChat.disconnectAgent');
		const config = vscode.workspace.getConfiguration('jawataChat');
		await config.update('agent', { command: process.env.npm_node_execpath || 'node', args: [require.resolve('@jawata/acp-contract/replay'), require.resolve('@jawata/acp-contract/sessions/R4.jsonl')] }, vscode.ConfigurationTarget.Global);
		await vscode.commands.executeCommand('jawataChat.openChat');
		const before = tabs();
		await vscode.commands.executeCommand('jawataChat.connectAgent');
		await vscode.commands.executeCommand('jawataChat.sendPrompt', 'replay');
		await new Promise(r => setTimeout(r, 500));
		assert.deepStrictEqual(tabs(), before, 'a tab or panel was opened');
		assert.ok(vscode.window.tabGroups.all.every(g => g.tabs.every(t => !(t.input instanceof vscode.TabInputWebview))), 'a webview panel is open');
	});
});
