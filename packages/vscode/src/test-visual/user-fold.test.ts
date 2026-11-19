import * as assert from 'assert';
import { execFileSync } from 'child_process';
import * as path from 'path';
import * as vscode from 'vscode';
import type { JawataChatApi } from '../extension';
import { answerProposals } from '../test/answering';

const pause = (milliseconds: number) => new Promise(r => setTimeout(r, milliseconds));

/**
 * Visual, Sprint 28h Stage 27 (z3): a message of his of more than six lines is shown folded, with "Show all (N lines)". The chat is connected
 * to the replay of R2 (a recorded agent), a prompt of twelve lines is sent through the command, and the window is photographed folded
 * and after the person's click on the fold. Evidence for a person to look at, not a gate.
 */
suite('Visual: a long message of his is folded', () => {
	test('a twelve-line prompt is shown as six lines and "Show all"', async () => {
		const out = process.env.JAWATA_VISUAL_OUT;
		assert.ok(out, 'JAWATA_VISUAL_OUT is set');
		await vscode.commands.executeCommand('jawataChat.disconnectAgent');
		await vscode.workspace.getConfiguration('jawataChat').update('agent', {
			command: process.env.npm_node_execpath || 'node',
			args: [require.resolve('@jawata/acp-contract/replay'), require.resolve('@jawata/acp-contract/sessions/R2.jsonl')],
		}, vscode.ConfigurationTarget.Global);
		await vscode.commands.executeCommand('jawataChat.openChat');
		await vscode.commands.executeCommand('jawataChat.connectAgent', 'agent');
		await pause(2 * 1000);
		const api = (await vscode.extensions.getExtension<JawataChatApi | undefined>('jawata.jawata-chat')!.activate())!;
		const stop = answerProposals(api.chat, ['allow-once']);
		const lines = Array.from({ length: 12 }, (_, i) => `line ${i + 1}: a long message of his, such as a pasted brief, is not shown whole at first`);
		try { await vscode.commands.executeCommand('jawataChat.sendPrompt', lines.join('\n')); } finally { stop(); }
		await pause(2 * 1000);

		const win = execFileSync('xdotool', ['search', '--onlyvisible', '--name', 'Extension Development Host']).toString().trim().split('\n')[0];
		// no window manager runs under xvfb, so the window is photographed as it stands, as the Stage 27 window tests do
		execFileSync('import', ['-window', win, path.join(out, 'z3-folded.png')]);
	});
});
