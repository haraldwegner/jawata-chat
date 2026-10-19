import * as assert from 'assert';
import { execFileSync } from 'child_process';
import * as path from 'path';
import * as vscode from 'vscode';

const pause = (milliseconds: number) => new Promise(r => setTimeout(r, milliseconds));

/**
 * Visual: with no agent connected, click History in the chat (a real click, xdotool), so the chat asks the agent (the replay of R6) for
 * its sessions, and screenshot this window (ImageMagick import) to JAWATA_VISUAL_OUT for a person to look at: evidence, not a gate.
 */
suite('Visual: the history list', () => {
	test('R6: the agent\'s sessions are listed in the chat', async () => {
		const out = process.env.JAWATA_VISUAL_OUT;
		assert.ok(out, 'JAWATA_VISUAL_OUT is set');
		await vscode.commands.executeCommand('jawataChat.disconnectAgent');
		const config = vscode.workspace.getConfiguration('jawataChat');
		await config.update('agent', {
			command: process.env.npm_node_execpath || 'node',
			args: [require.resolve('@jawata/acp-contract/replay'), require.resolve('@jawata/acp-contract/sessions/R6.jsonl')],
		}, vscode.ConfigurationTarget.Global);
		await vscode.commands.executeCommand('jawataChat.openChat');
		await pause(1000);
		const win = execFileSync('xdotool', ['search', '--onlyvisible', '--name', 'Extension Development Host']).toString().trim().split('\n')[0];
		execFileSync('xdotool', ['windowactivate', '--sync', win]);
		// the History button of the empty state, as it sits in the side bar
		execFileSync('xdotool', ['mousemove', '--window', win, '378', '484', 'click', '1']);
		await pause(2 * 1000);
		execFileSync('import', ['-window', win, path.join(out, 'history-r6.png')]);
	});
});
