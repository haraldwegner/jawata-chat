import * as assert from 'assert';
import { execFileSync } from 'child_process';
import * as path from 'path';
import * as vscode from 'vscode';
import type { JawataChatApi } from '../extension';
import { answerProposals } from '../test/answering';

const pause = (milliseconds: number) => new Promise(r => setTimeout(r, milliseconds));

/**
 * Visual: replay R2 (a tool call and its answer), send a prompt through the command, and screenshot
 * this window (ImageMagick import) to JAWATA_VISUAL_OUT for a person to look at: evidence, not a gate.
 */
suite('Visual: a turn with a tool call', () => {
	test('R2: the answer and its tool call are on screen', async () => {
		const out = process.env.JAWATA_VISUAL_OUT;
		assert.ok(out, 'JAWATA_VISUAL_OUT is set');
		await vscode.commands.executeCommand('jawataChat.disconnectAgent');
		const config = vscode.workspace.getConfiguration('jawataChat');
		await config.update('agent', {
			command: process.env.npm_node_execpath || 'node',
			args: [require.resolve('@jawata/acp-contract/replay'), require.resolve('@jawata/acp-contract/sessions/R2.jsonl')],
		}, vscode.ConfigurationTarget.Global);
		await vscode.commands.executeCommand('jawataChat.openChat');
		await vscode.commands.executeCommand('jawataChat.connectAgent', 'agent');
		await pause(2 * 1000);
		// the person accepts the proposal the recorded agent makes
		const api = (await vscode.extensions.getExtension<JawataChatApi | undefined>('jawata.jawata-chat')!.activate())!;
		const stop = answerProposals(api.chat, ['allow-once']);
		try { await vscode.commands.executeCommand('jawataChat.sendPrompt', 'read a file'); } finally { stop(); }
		await pause(2 * 1000);

		const win = execFileSync('xdotool', ['search', '--onlyvisible', '--name', 'Extension Development Host']).toString().trim().split('\n')[0];
		execFileSync('xdotool', ['windowactivate', '--sync', win]);
		execFileSync('import', ['-window', win, path.join(out, 'turn-r2.png')]);
	});
});
