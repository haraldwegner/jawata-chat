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

	test('window run 6: Stage 19 chat defects in the window (S19-5, 6, 7, 2, 1, 4)', async function () {
		if (process.env.JAWATA_WINDOW_STEP !== '6') { this.skip(); }
		const engine = JSON.parse(fs.readFileSync(process.env.JAWATA_WINDOW_ENGINE!, 'utf8'));
		await vscode.commands.executeCommand('jawataChat.disconnectAgent');
		await vscode.workspace.getConfiguration('jawataChat').update('agent', {
			command: engine.bridge[0], args: engine.bridge.slice(1), env: { JAWATA_URL: engine.url, JAWATA_KEY: engine.key },
		}, vscode.ConfigurationTarget.Global);
		await vscode.commands.executeCommand('jawataChat.openChat');
		await pause(1500);
		shoot('s19-5-0-before-connecting.png');
		// S19-5: the connect screen must not show while the agent starts and loads a session
		const connecting = vscode.commands.executeCommand('jawataChat.connectAgent', 'agent');
		for (let n = 0; n < 6; n++) { await pause(700); shoot(`s19-5-${n + 1}-while-starting.png`); }
		await connecting;
		await pause(3000);
		shoot('s19-5-7-connected.png');
		// S19-6: the model list closes on Esc and on a click beside it; the "/" list closes on Esc when the chat has lost focus
		click(802, 651);
		await pause(800);
		shoot('s19-6-1-model-list-open.png');
		execFileSync('xdotool', ['key', '--window', windowOfTheRun(), 'Escape']);
		await pause(600);
		shoot('s19-6-2-model-list-after-esc.png');
		click(802, 651);
		await pause(600);
		click(450, 300);
		await pause(600);
		shoot('s19-6-3-model-list-after-click-beside.png');
		click(475, 695);
		execFileSync('xdotool', ['type', '--window', windowOfTheRun(), '/']);
		await pause(800);
		shoot('s19-6-4-slash-open.png');
		click(450, 300);
		execFileSync('xdotool', ['key', '--window', windowOfTheRun(), 'Escape']);
		await pause(600);
		shoot('s19-6-5-slash-after-esc-without-focus.png');
		// S19-2 and S19-1: a long turn, Stop during it, then a second message that is answered
		click(475, 695);
		execFileSync('xdotool', ['key', '--window', windowOfTheRun(), 'ctrl+a', 'BackSpace']);
		execFileSync('xdotool', ['type', '--delay', '5', '--window', windowOfTheRun(), 'Count from 1 to 300, one number per line, each followed by a short sentence about it.']);
		execFileSync('xdotool', ['key', '--window', windowOfTheRun(), 'Return']);
		await pause(7000);
		shoot('s19-2-1-long-turn-running.png');
		click(761, 739);
		await pause(3000);
		shoot('s19-2-2-after-stop.png');
		await pause(8000);
		shoot('s19-2-3-ten-seconds-after-stop.png');
		click(475, 695);
		execFileSync('xdotool', ['type', '--delay', '5', '--window', windowOfTheRun(), 'Say hello in one word.']);
		execFileSync('xdotool', ['key', '--window', windowOfTheRun(), 'Return']);
		await pause(20000);
		shoot('s19-1-second-message-answered.png');
		// S19-7: a New session button, and no question
		click(417, 651);
		await pause(3000);
		shoot('s19-7-new-session.png');
	});

	test('window run 8: S19-2 with a hire running (Stop on the main turn, Stop on the hire) and S19-7 (opening a different session from History)', async function () {
		// run 8 sends the hire with no gate, which the engine refuses; run 9 sends it with one gate, so the hire runs and Stop can be tried on it
		if (process.env.JAWATA_WINDOW_STEP !== '8' && process.env.JAWATA_WINDOW_STEP !== '9') { this.skip(); }
		await connectToTheEngine();
		const engine = JSON.parse(fs.readFileSync(process.env.JAWATA_WINDOW_ENGINE!, 'utf8'));
		const gates = process.env.JAWATA_WINDOW_STEP === '9' ? `[{"tool":"files","arguments":{"action":"read","path":"${engine.project}/app.ts"}}]` : '[]';
		const hirePrompt = `Call the jawata hire tool exactly once with exactly these arguments: hirer "main", seat "architect", seatFile "${engine.seats}/architect.md", workingDirectory "${engine.project}", steps ${gates}, and this brief: Read every file under ${engine.project}, then write a design review of 60 numbered points, each a full paragraph, taking your time. Then end your turn without waiting.`;
		await vscode.commands.executeCommand('jawataChat.sendPrompt', hirePrompt);
		await pause(8000);
		shoot('s19-2-h1-hire-running.png');
		// the main turn works too: a long answer, then Stop on it while the hire still runs
		click(475, 695);
		execFileSync('xdotool', ['type', '--delay', '5', '--window', windowOfTheRun(), 'Count from 1 to 300, one number per line, each followed by a short sentence about it.']);
		execFileSync('xdotool', ['key', '--window', windowOfTheRun(), 'Return']);
		await pause(6000);
		shoot('s19-2-h2-main-turn-and-hire-running.png');
		click(761, 739);
		await pause(3000);
		shoot('s19-2-h3-after-stop-on-the-main-turn.png');
		await pause(5000);
		shoot('s19-2-h4-hire-after-main-stop.png');
		// the per-hire Stop, in Agent Control beside the hire's row
		click(1088, 198);
		await pause(4000);
		shoot('s19-2-h5-after-stop-on-the-hire.png');
		await pause(8000);
		shoot('s19-2-h6-hire-eight-seconds-later.png');
		// S19-7: a second session, then the first one opened from History
		click(417, 651);
		await pause(1500);
		shoot('s19-7-h1-new-session-asked.png');
		click(1060, 744);
		await pause(3000);
		click(475, 695);
		execFileSync('xdotool', ['type', '--delay', '5', '--window', windowOfTheRun(), 'Say hi in one word.']);
		execFileSync('xdotool', ['key', '--window', windowOfTheRun(), 'Return']);
		await pause(15000);
		shoot('s19-7-h2-second-session.png');
		click(766, 86);
		await pause(2500);
		shoot('s19-7-h3-history-two-sessions.png');
		click(300, 190);
		await pause(1500);
		shoot('s19-7-h4-opened-the-other-one-asked.png');
		await pause(5000);
		shoot('s19-7-h5-opened-the-other-one.png');
	});

	test('window run 7: S19-4, the model picked in the dropdown is the one the next answer comes from, and the dropdown names it', async function () {
		if (process.env.JAWATA_WINDOW_STEP !== '7') { this.skip(); }
		await connectToTheEngine();
		const ask = async (name: string) => {
			click(475, 695);
			execFileSync('xdotool', ['type', '--delay', '5', '--window', windowOfTheRun(), 'Which model are you? Answer with its name only, one line.']);
			execFileSync('xdotool', ['key', '--window', windowOfTheRun(), 'Return']);
			await pause(25000);
			shoot(name);
		};
		await ask('s19-4-1-first-answer-sonnet.png');
		click(802, 651);
		await pause(800);
		click(703, 300); // claude-code · Opus 5.5
		await pause(1500);
		shoot('s19-4-2-after-picking-opus.png');
		await ask('s19-4-3-answer-after-opus.png');
		click(802, 651);
		await pause(800);
		click(703, 375); // claude-code · Haiku 5.5
		await pause(1500);
		shoot('s19-4-4-after-picking-haiku.png');
		await ask('s19-4-5-answer-after-haiku.png');
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
