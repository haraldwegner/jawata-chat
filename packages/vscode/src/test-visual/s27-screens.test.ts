import * as assert from 'assert';
import { execFileSync } from 'child_process';
import * as path from 'path';
import * as vscode from 'vscode';

const pause = (milliseconds: number) => new Promise(r => setTimeout(r, milliseconds));

const windowOfTheRun = () => execFileSync('xdotool', ['search', '--onlyvisible', '--name', 'Extension Development Host']).toString().trim().split('\n')[0];
const shoot = (name: string) => execFileSync('import', ['-window', windowOfTheRun(), path.join(process.env.JAWATA_VISUAL_OUT!, name)]);

async function replay(session: string) {
	await vscode.commands.executeCommand('jawataChat.disconnectAgent');
	await vscode.workspace.getConfiguration('jawataChat').update('agent', {
		command: process.env.npm_node_execpath || 'node',
		args: [require.resolve('@jawata/acp-contract/replay'), require.resolve(`@jawata/acp-contract/sessions/${session}.jsonl`)],
	}, vscode.ConfigurationTarget.Global);
	await vscode.commands.executeCommand('jawataChat.openChat');
}

/**
 * Visual, Sprint 28h Stage 27: the History list and the `/` list as the current chat draws them, in the layout the chat has now (the chat in the editor
 * area), screenshotted to JAWATA_VISUAL_OUT for a person to look at: evidence, not a gate. The recorded agent is a replay of a real session.
 */
suite('Visual: Stage 27 screens', () => {
	test('the / list from the chat input', async () => {
		assert.ok(process.env.JAWATA_VISUAL_OUT, 'JAWATA_VISUAL_OUT is set');
		await replay('R3');
		await vscode.commands.executeCommand('jawataChat.connectAgent', 'agent');
		await vscode.commands.executeCommand('jawataChat.sendPrompt', 'list');
		await pause(2000);
		execFileSync('xdotool', ['mousemove', '--window', windowOfTheRun(), '475', '695', 'click', '1']);
		await pause(500);
		execFileSync('xdotool', ['type', '--window', windowOfTheRun(), '/']);
		await pause(1000);
		shoot('s27-slash-list.png');
	});

	test('the History list from the empty state', async () => {
		assert.ok(process.env.JAWATA_VISUAL_OUT, 'JAWATA_VISUAL_OUT is set');
		await replay('R6');
		await pause(1000);
		// the History button of the empty state, in the editor area
		execFileSync('xdotool', ['mousemove', '--window', windowOfTheRun(), '572', '364', 'click', '1']);
		await pause(2000);
		shoot('s27-history-list.png');
	});
});
