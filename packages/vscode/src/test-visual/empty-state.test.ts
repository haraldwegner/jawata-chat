import * as assert from 'assert';
import { execFileSync } from 'child_process';
import * as path from 'path';
import * as vscode from 'vscode';

const pause = (milliseconds: number) => new Promise(r => setTimeout(r, milliseconds));

/**
 * Visual: the chat with no agent connected, screenshotted to JAWATA_VISUAL_OUT for a person to look
 * at: evidence, not a gate.
 */
suite('Visual: the chat with no agent connected', () => {
	test('the empty state is on screen', async () => {
		const out = process.env.JAWATA_VISUAL_OUT;
		assert.ok(out, 'JAWATA_VISUAL_OUT is set');
		await vscode.commands.executeCommand('jawataChat.disconnectAgent');
		await vscode.commands.executeCommand('jawataChat.openChat');
		await pause(2 * 1000);

		const win = execFileSync('xdotool', ['search', '--onlyvisible', '--name', 'Extension Development Host']).toString().trim().split('\n')[0];
		execFileSync('xdotool', ['windowactivate', '--sync', win]);
		execFileSync('import', ['-window', win, path.join(out, 'empty-state.png')]);
	});
});
