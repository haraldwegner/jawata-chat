import * as assert from 'assert';
import { execFileSync } from 'child_process';
import * as path from 'path';
import * as vscode from 'vscode';
import type { JawataChatApi } from '../extension';
import { answerProposals } from '../test/answering';

const pause = (milliseconds: number) => new Promise(r => setTimeout(r, milliseconds));

/**
 * Visual: replay R7 (two proposals with a diff), send a prompt, and screenshot this window while the first proposal waits
 * for an answer (ImageMagick import) to JAWATA_VISUAL_OUT for a person to look at: evidence, not a gate.
 */
suite('Visual: a proposal waits for an answer', () => {
	test('R7: the diff with Accept and Reject is on screen', async () => {
		const out = process.env.JAWATA_VISUAL_OUT;
		assert.ok(out, 'JAWATA_VISUAL_OUT is set');
		await vscode.commands.executeCommand('jawataChat.disconnectAgent');
		const config = vscode.workspace.getConfiguration('jawataChat');
		await config.update('agent', {
			command: process.env.npm_node_execpath || 'node',
			args: [require.resolve('@jawata/acp-contract/replay'), require.resolve('@jawata/acp-contract/sessions/R7.jsonl')],
		}, vscode.ConfigurationTarget.Global);
		await vscode.commands.executeCommand('jawataChat.openChat');
		await vscode.commands.executeCommand('jawataChat.connectAgent', 'agent');
		await pause(2 * 1000);
		await pause(500);
		// an earlier run left a "/" in the input and its list open: clear it, so nothing covers what is shown
		const found = execFileSync('xdotool', ['search', '--onlyvisible', '--name', 'Extension Development Host']).toString().trim().split('\n')[0];
		execFileSync('xdotool', ['windowactivate', '--sync', found]);
		const height = Number(/HEIGHT=(\d+)/.exec(execFileSync('xdotool', ['getwindowgeometry', '--shell', found]).toString())![1]);
		execFileSync('xdotool', ['mousemove', '--window', found, '260', String(height - 165), 'click', '1', 'key', '--window', found, 'ctrl+a', 'BackSpace']);
		await pause(500);
		const turn = vscode.commands.executeCommand('jawataChat.sendPrompt', 'write two files');
		await pause(2 * 1000);

		const win = execFileSync('xdotool', ['search', '--onlyvisible', '--name', 'Extension Development Host']).toString().trim().split('\n')[0];
		execFileSync('xdotool', ['windowactivate', '--sync', win]);
		execFileSync('import', ['-window', win, path.join(out, 'proposal-r7.png')]);

		// then answer, so the turn ends
		const api = (await vscode.extensions.getExtension<JawataChatApi | undefined>('jawata.jawata-chat')!.activate())!;
		const stop = answerProposals(api.chat, ['allow-once', 'reject']);
		try { await turn; } finally { stop(); }
	});
});
