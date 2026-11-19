import * as assert from 'assert';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

const pause = (milliseconds: number) => new Promise(r => setTimeout(r, milliseconds));
const windowOfTheRun = () => execFileSync('xdotool', ['search', '--onlyvisible', '--name', 'Extension Development Host']).toString().trim().split('\n')[0];
const shoot = (name: string) => execFileSync('import', ['-window', windowOfTheRun(), path.join(process.env.JAWATA_VISUAL_OUT!, name)]);

/**
 * Visual, Sprint 28h Stage 27 (a): the chat in a real VS Code window connected, through the bridge, to a real sandbox engine with real brains
 * (JAWATA_WINDOW_ENGINE names the engine.json that engine-for-window.py wrote); one hire is made by the person's prompt, then History is opened
 * and screenshotted: the hired seat's own session must not be listed among the person's conversations. Evidence for a person to look at, not a gate;
 * it does nothing when JAWATA_WINDOW_ENGINE is not set.
 */
suite('Visual: a real hire, then History', function () {
	this.timeout(360000);
	test('the hire is shown in Agent Control and History lists only the conversations of the person', async function () {
		const descriptor = process.env.JAWATA_WINDOW_ENGINE;
		if (!descriptor) {
			this.skip();
		}
		const engine = JSON.parse(fs.readFileSync(descriptor!, 'utf8'));
		await vscode.commands.executeCommand('jawataChat.disconnectAgent');
		await vscode.workspace.getConfiguration('jawataChat').update('agent', {
			command: engine.bridge[0],
			args: engine.bridge.slice(1),
			env: { JAWATA_URL: engine.url, JAWATA_KEY: engine.key },
		}, vscode.ConfigurationTarget.Global);
		await vscode.commands.executeCommand('jawataChat.openChat');
		const trace = (line: string) => fs.appendFileSync(path.join(process.env.JAWATA_VISUAL_OUT!, 's27-a-trace.txt'), `${new Date().toISOString()} ${line}\n`);
		trace(`agent setting read back: ${JSON.stringify(vscode.workspace.getConfiguration('jawataChat').get('agent'))}`);
		await vscode.commands.executeCommand('jawataChat.connectAgent', 'agent').then(() => trace('connectAgent returned'), error => trace(`connectAgent threw: ${error}`));
		await pause(5000);
		const prompt = fs.readFileSync(process.env.JAWATA_WINDOW_PROMPT!, 'utf8').replace(/\{SEATS\}/g, engine.seats).replace(/\{PROJECT\}/g, engine.project);
		await vscode.commands.executeCommand('jawataChat.sendPrompt', prompt);
		await pause(Number(process.env.JAWATA_WINDOW_WAIT_MS || 120000));
		shoot('s27-a-after-the-hire.png');
		// History, the button in the top bar of a connected chat
		execFileSync('xdotool', ['mousemove', '--window', windowOfTheRun(), '766', '86', 'click', '1']);
		await pause(3000);
		shoot('s27-a-history-after-the-hire.png');
		assert.ok(true);
	});
});
