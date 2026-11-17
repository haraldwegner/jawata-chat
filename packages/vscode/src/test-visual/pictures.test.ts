import * as assert from 'assert';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import type { JawataChatApi } from '../extension';

const pause = (milliseconds: number) => new Promise(r => setTimeout(r, milliseconds));

/**
 * Visual (28h D57 (b)): replay R1, paste a picture (the extension's own icon) as the page does, screenshot its chip above the input, send it,
 * and screenshot the message that sent it, to JAWATA_VISUAL_OUT for a person to look at: evidence, not a gate.
 */
suite('Visual: a pasted picture', () => {
	test('R1: the picture shows on its chip before it is sent and in the message after', async () => {
		const out = process.env.JAWATA_VISUAL_OUT;
		assert.ok(out, 'JAWATA_VISUAL_OUT is set');
		await vscode.commands.executeCommand('jawataChat.disconnectAgent');
		const config = vscode.workspace.getConfiguration('jawataChat');
		await config.update('agent', {
			command: process.env.npm_node_execpath || 'node',
			args: [require.resolve('@jawata/acp-contract/replay'), require.resolve('@jawata/acp-contract/sessions/R1.jsonl')],
		}, vscode.ConfigurationTarget.Global);
		await vscode.commands.executeCommand('jawataChat.openChat');
		await vscode.commands.executeCommand('jawataChat.connectAgent', 'agent');
		await pause(2 * 1000);
		const api = (await vscode.extensions.getExtension<JawataChatApi | undefined>('jawata.jawata-chat')!.activate())!;
		const icon = fs.readFileSync(path.join(__dirname, '..', '..', 'resources', 'icon.png')).toString('base64');
		await api.chat.handle({ type: 'attachPasted', name: 'screenshot.png', mimeType: 'image/png', data: icon });
		await pause(3 * 1000);

		const win = execFileSync('xdotool', ['search', '--onlyvisible', '--name', 'Extension Development Host']).toString().trim().split('\n')[0];
		execFileSync('xdotool', ['windowactivate', '--sync', win]);
		execFileSync('import', ['-window', win, path.join(out, 'picture-chip.png')]);

		// sent as the page sends it: with the attachments it shows
		await api.chat.handle({ type: 'sendPrompt', text: 'what is in this picture?', files: api.chat.snapshot().attachments.map(a => a.path) });
		await pause(5 * 1000);
		execFileSync('import', ['-window', win, path.join(out, 'picture-sent.png')]);
		// what the core holds beside what the screenshot shows, so a page that did not draw it can be told from a core that did not hold it
		fs.writeFileSync(path.join(out, 'picture-sent-state.json'), JSON.stringify(api.chat.snapshot().entries.map(e => e.kind === 'user'
			? { kind: e.kind, text: e.text, files: e.files, images: (e.images ?? []).map(i => i.slice(0, 40)) } : { kind: e.kind }), null, 1));
	});
});
