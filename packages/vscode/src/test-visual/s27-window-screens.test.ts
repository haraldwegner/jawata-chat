import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

const pause = (milliseconds: number) => new Promise(r => setTimeout(r, milliseconds));
const windowOfTheRun = () => execFileSync('xdotool', ['search', '--onlyvisible', '--name', 'Extension Development Host']).toString().trim().split('\n')[0];
const shoot = (name: string) => execFileSync('import', ['-window', windowOfTheRun(), path.join(process.env.JAWATA_VISUAL_OUT!, name)]);
const click = (x: number, y: number) => execFileSync('xdotool', ['mousemove', '--window', windowOfTheRun(), String(x), String(y), 'click', '1']);

async function connectToTheEngine(): Promise<void> {
	const engine = JSON.parse(fs.readFileSync(process.env.JAWATA_WINDOW_ENGINE!, 'utf8'));
	await vscode.commands.executeCommand('jawataChat.disconnectAgent');
	await vscode.workspace.getConfiguration('jawataChat').update('agent', {
		command: engine.bridge[0],
		args: engine.bridge.slice(1),
		env: { JAWATA_URL: engine.url, JAWATA_KEY: engine.key },
	}, vscode.ConfigurationTarget.Global);
	await vscode.commands.executeCommand('jawataChat.openChat');
	await vscode.commands.executeCommand('jawataChat.connectAgent', 'agent');
	await pause(5000);
}

/**
 * Visual, Sprint 28h Stage 27, rows (m), (i) and (h): the chat in a real VS Code window connected through the bridge to a sandbox engine with
 * real brains (JAWATA_WINDOW_ENGINE names the engine.json engine-for-window.py wrote). Run one (JAWATA_WINDOW_STEP=1) shows the autocontinue
 * button before and after a click and after a typed "Fix", and the working line and Agent Control during and after one real hire. Run two
 * (JAWATA_WINDOW_STEP=2), against the same engine restarted, opens the session of run one from History and types `/`. Evidence for a person
 * to look at, not a gate; each does nothing when its step is not asked for.
 */
suite('Visual: Stage 27 screens against a live engine', function () {
	this.timeout(480000);

	test('window run 1: the autocontinue button, a real hire in flight, then a typed Fix', async function () {
		if (process.env.JAWATA_WINDOW_STEP !== '1') { this.skip(); }
		await connectToTheEngine();
		shoot('s27-m-1-before.png');
		click(130, 651);
		await pause(1500);
		shoot('s27-m-2-after-the-click.png');
		const engine = JSON.parse(fs.readFileSync(process.env.JAWATA_WINDOW_ENGINE!, 'utf8'));
		const prompt = fs.readFileSync(process.env.JAWATA_WINDOW_PROMPT!, 'utf8').replace(/\{SEATS\}/g, engine.seats).replace(/\{PROJECT\}/g, engine.project);
		await vscode.commands.executeCommand('jawataChat.sendPrompt', prompt);
		await pause(9000);
		await pause(70000);
		shoot('s27-i-2-after-the-hire.png');
		// the principal's calls and the hire's card, opened by their own arrows
		click(940, 152);
		await pause(800);
		click(920, 204);
		await pause(1200);
		shoot('s27-i-3-agent-control-opened.png');
		// a typed message ends the autocontinue (his word 2026-11-17): the words "Fix", typed in the input and sent with Return
		click(475, 695);
		execFileSync('xdotool', ['type', '--window', windowOfTheRun(), 'Fix']);
		execFileSync('xdotool', ['key', '--window', windowOfTheRun(), 'Return']);
		await pause(1500);
		shoot('s27-m-3-fix-typed.png');
		await pause(25000);
		shoot('s27-m-4-after-the-answer.png');
	});

	test('window run 2: the slash after an engine restart, from History', async function () {
		if (process.env.JAWATA_WINDOW_STEP !== '2') { this.skip(); }
		await connectToTheEngine();
		shoot('s27-h-1-new-session.png');
		click(766, 86);
		await pause(2500);
		shoot('s27-h-2-history.png');
		// the first row of the list: the session run one made; opening it is `session/load`
		click(300, 162);
		await pause(6000);
		shoot('s27-h-3-opened-from-history.png');
		click(475, 695);
		execFileSync('xdotool', ['type', '--window', windowOfTheRun(), '/']);
		await pause(1500);
		shoot('s27-h-4-slash-after-restart.png');
	});

	test('window run 3: the working line while the principal works, then autocontinue typed and ended by a typed Fix', async function () {
		if (process.env.JAWATA_WINDOW_STEP !== '3') { this.skip(); }
		await connectToTheEngine();
		const engine = JSON.parse(fs.readFileSync(process.env.JAWATA_WINDOW_ENGINE!, 'utf8'));
		const prompt = fs.readFileSync(process.env.JAWATA_WINDOW_PROMPT!, 'utf8').replace(/\{SEATS\}/g, engine.seats).replace(/\{PROJECT\}/g, engine.project);
		await vscode.commands.executeCommand('jawataChat.sendPrompt', prompt);
		// the working line while the turn runs and while the hire is out: one picture every two seconds
		for (let n = 0; n < 24; n++) {
			await pause(2000);
			shoot(`s27-i-w-${String(n).padStart(2, '0')}.png`);
		}
		await pause(20000);
		// `/autocontinue` TYPED (no click), sent with Return: the button must read on, and the typed words stay in the conversation
		click(475, 695);
		execFileSync('xdotool', ['type', '--window', windowOfTheRun(), '/autocontinue']);
		await pause(800);
		shoot('s27-m-5-autocontinue-typed.png');
		execFileSync('xdotool', ['key', '--window', windowOfTheRun(), 'Return']);
		await pause(1500);
		// a list entry taken by the first Return is sent by the second; an empty input sends nothing
		execFileSync('xdotool', ['key', '--window', windowOfTheRun(), 'Return']);
		await pause(15000);
		shoot('s27-m-6-autocontinue-on.png');
		// now a typed `Fix` while the autonomy is still on: it must end it
		click(475, 695);
		execFileSync('xdotool', ['type', '--window', windowOfTheRun(), 'Fix']);
		execFileSync('xdotool', ['key', '--window', windowOfTheRun(), 'Return']);
		await pause(2000);
		shoot('s27-m-7-fix-typed-while-on.png');
		await pause(25000);
		shoot('s27-m-8-after-the-typed-fix.png');
	});

	test('window run 5: the working line while the principal uses a tool, the prompt typed so the turn is still running when the pictures are taken', async function () {
		if (process.env.JAWATA_WINDOW_STEP !== '5') { this.skip(); }
		await connectToTheEngine();
		click(475, 695);
		execFileSync('xdotool', ['type', '--delay', '5', '--window', windowOfTheRun(), 'Read /tmp/m17-win/project/app.ts, then list the files in /tmp/m17-win/project, then say in one line which colour app.ts holds.']);
		execFileSync('xdotool', ['key', '--window', windowOfTheRun(), 'Return']);
		for (let n = 0; n < 30; n++) {
			await pause(1000);
			shoot(`s27-i-t-${String(n).padStart(2, '0')}.png`);
		}
	});

	test('window run 4: /ux typed in a session opened again from History after an engine restart', async function () {
		if (process.env.JAWATA_WINDOW_STEP !== '4') { this.skip(); }
		await connectToTheEngine();
		click(766, 86);
		await pause(2500);
		click(300, 162);
		await pause(6000);
		click(475, 695);
		execFileSync('xdotool', ['type', '--window', windowOfTheRun(), '/ux']);
		await pause(1200);
		shoot('s27-h-5-ux-filtered.png');
		execFileSync('xdotool', ['key', '--window', windowOfTheRun(), 'Return']);
		await pause(1500);
		shoot('s27-h-6-ux-taken.png');
		execFileSync('xdotool', ['key', '--window', windowOfTheRun(), 'Return']);
		await pause(2000);
		shoot('s27-h-6-ux-sent.png');
		await pause(90000);
		shoot('s27-h-7-ux-answered.png');
	});
});
