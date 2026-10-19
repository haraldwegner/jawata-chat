import * as assert from 'assert';
import { execFileSync } from 'child_process';
import * as path from 'path';
import * as vscode from 'vscode';

const pause = (milliseconds: number) => new Promise(r => setTimeout(r, milliseconds));

/**
 * Visual: replay R3 (one prompt, after which the agent sends its commands), click into the chat input, type "/" with a real keystroke (xdotool), and
 * screenshot this window (ImageMagick import) to JAWATA_VISUAL_OUT for a person to look at.
 */
suite('Visual: the / list', () => {
	test('R3 commands appear when / is typed', async () => {
		const out = process.env.JAWATA_VISUAL_OUT;
		assert.ok(out, 'JAWATA_VISUAL_OUT is set');
		await vscode.commands.executeCommand('jawataChat.disconnectAgent');
		const config = vscode.workspace.getConfiguration('jawataChat');
		await config.update('agent', {
			command: process.env.npm_node_execpath || 'node',
			args: [require.resolve('@jawata/acp-contract/replay'), require.resolve('@jawata/acp-contract/sessions/R3.jsonl')],
		}, vscode.ConfigurationTarget.Global);
		await vscode.commands.executeCommand('jawataChat.openChat');
		await vscode.commands.executeCommand('jawataChat.connectAgent', 'agent');
		// the recorded agent sends its command list after the first prompt
		await vscode.commands.executeCommand('jawataChat.sendPrompt', 'list');
		await pause(2 * 1000);

		const win = execFileSync('xdotool', ['search', '--onlyvisible', '--name', 'Extension Development Host']).toString().trim().split('\n')[0];
		execFileSync('xdotool', ['windowactivate', '--sync', win]);
		const geo = execFileSync('xdotool', ['getwindowgeometry', '--shell', win]).toString();
		const height = Number(/HEIGHT=(\d+)/.exec(geo)![1]);
		// the chat input sits at the bottom of the side panel
		execFileSync('xdotool', ['mousemove', '--window', win, '260', String(height - 165), 'click', '1']);
		await pause(500);
		execFileSync('xdotool', ['type', '--window', win, '/']);
		await pause(1000);
		execFileSync('import', ['-window', win, path.join(out, 'slash-list.png')]);
	});
});
