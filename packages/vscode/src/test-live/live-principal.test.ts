import * as assert from 'assert';
import { execFile } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import type { JawataChatApi } from '../extension';

/**
 * Sprint 28h, Stage 27 (z60 to z64, z67): the chat window with a real principal. JAWATA_LIVE_AGENT names the agent the chat connects to
 * (the engine's agent face), whose principal brain is set by the engine that is running. The prompt of JAWATA_LIVE_PROMPT is sent, the
 * time its turn took is noted, the hire cards the chat holds are sampled every 200 ms while it runs and afterwards, and then the prompt of
 * JAWATA_LIVE_PROMPT2, if given, is sent while the hires are still shown, and its turn is timed too. What the chat holds is written to
 * JAWATA_LIVE_OUT/principal.json and the recording is copied beside it.
 */
suite('Live principal', () => {
	test('a task and then a second message, with what the chat shows meanwhile', async function () {
		this.timeout(600000);
		const out = process.env.JAWATA_LIVE_OUT;
		const prompt = process.env.JAWATA_LIVE_PROMPT;
		assert.ok(out && prompt && process.env.JAWATA_LIVE_AGENT, 'JAWATA_LIVE_OUT, _PROMPT and _AGENT are set');
		const config = vscode.workspace.getConfiguration('jawataChat');
		await config.update('agent', JSON.parse(process.env.JAWATA_LIVE_AGENT), vscode.ConfigurationTarget.Global);
		await config.update('recordSessions', true, vscode.ConfigurationTarget.Global);
		await vscode.commands.executeCommand('jawataChat.openChat');
		await vscode.commands.executeCommand('jawataChat.connectAgent', 'agent');
		const chat = (await vscode.extensions.getExtension<JawataChatApi | undefined>('jawata.jawata-chat')!.activate())!.chat;
		const found: Record<string, unknown> = {};
		// the whole virtual screen, so what the person would see is kept as a picture; the window runs under xvfb, never on the person's own screen
		const shot = (name: string) => new Promise<void>(resolve => { fs.mkdirSync(out, { recursive: true }); execFile('import', ['-window', 'root', path.join(out, name)], () => resolve()); });
		await vscode.commands.executeCommand('workbench.view.extension.jawata-control');
		const timeline: { ms: number; hires: unknown[] }[] = [];
		const t0 = Date.now();
		const sampler = setInterval(() => { timeline.push({ ms: Date.now() - t0, hires: chat.snapshot().hires.map(h => ({ ...h })) }); }, 200);
		try {
			const sent = Date.now() - t0;
			const cardShot = (async () => { for (let i = 0; i < 6000; i++) { if (chat.snapshot().hires.some(h => h.state !== 'running')) { await new Promise(r => setTimeout(r, 1500)); await shot('card.png'); return; } await new Promise(r => setTimeout(r, 100)); } })();
			if (process.env.JAWATA_LIVE_DURING && process.env.JAWATA_LIVE_PROMPT2) {
				// the second message goes in while a hire still runs and the principal's turn has ended: sendPrompt of the first is not awaited
				const firstTurn = Promise.resolve(vscode.commands.executeCommand('jawataChat.sendPrompt', prompt));
				const deadline = Date.now() + 300000;
				let waiting = false;
				while (Date.now() < deadline) {
					const s = chat.snapshot();
					if (s.hires.some(h => h.state === 'running') && !s.processing) { waiting = true; break; }
					await new Promise(r => setTimeout(r, 50));
				}
				found.duringHire = { principalWaitingWhileAHireRuns: waiting, atMs: Date.now() - t0, hires: chat.snapshot().hires.map(h => ({ ...h })) };
				await shot('during-hire.png');
				const sentDuring = Date.now() - t0;
				const queued = chat.snapshot().entries.length;
				await vscode.commands.executeCommand('jawataChat.sendPrompt', process.env.JAWATA_LIVE_PROMPT2);
				found.messageDuringHire = { sentMs: sentDuring, answeredMs: Date.now() - t0, tookMs: Date.now() - t0 - sentDuring, entriesBefore: queued, hiresAtAnswer: chat.snapshot().hires.map(h => ({ state: h.state, elapsedMs: h.elapsedMs })) };
				await shot('answered-during-hire.png');
				await firstTurn;
				found.firstTurn = { sentMs: sent, endedMs: Date.now() - t0 };
				found.afterFirst = { entries: chat.snapshot().entries, hires: chat.snapshot().hires };
				await new Promise(r => setTimeout(r, Number(process.env.JAWATA_LIVE_LISTEN_MS ?? 20000)));
				await shot('final.png');
				return;
			}
			await vscode.commands.executeCommand('jawataChat.sendPrompt', prompt);
			await cardShot;
			found.firstTurn = { sentMs: sent, endedMs: Date.now() - t0, tookMs: Date.now() - t0 - sent };
			found.afterFirst = { entries: chat.snapshot().entries, hires: chat.snapshot().hires };
			const second = process.env.JAWATA_LIVE_PROMPT2;
			if (second) {
				await new Promise(r => setTimeout(r, Number(process.env.JAWATA_LIVE_GAP_MS ?? 3000)));
				const sent2 = Date.now() - t0;
				found.hiresWhenSecondSent = chat.snapshot().hires.map(h => ({ ...h }));
				await vscode.commands.executeCommand('jawataChat.sendPrompt', second);
				found.secondTurn = { sentMs: sent2, endedMs: Date.now() - t0, tookMs: Date.now() - t0 - sent2 };
			}
			await new Promise(r => setTimeout(r, Number(process.env.JAWATA_LIVE_LISTEN_MS ?? 20000)));
			await shot('final.png');
			// the hires fold of Agent Control, opened by a real click at its place on the virtual screen, so the refused row's reason is in the picture
			await new Promise<void>(resolve => execFile('xdotool', ['mousemove', '1290', '226', 'click', '1'], () => resolve()));
			await new Promise(r => setTimeout(r, 1500));
			await shot('final-hires-open.png');
		} finally {
			clearInterval(sampler);
			found.timeline = timeline;
			found.finalEntries = chat.snapshot().entries;
			found.finalHires = chat.snapshot().hires;
			try {
				await vscode.commands.executeCommand('jawataChat.openRecording');
				const recording = vscode.window.activeTextEditor?.document.uri.fsPath;
				if (recording && recording.endsWith('.jsonl')) { fs.mkdirSync(out, { recursive: true }); fs.copyFileSync(recording, path.join(out, 'principal-recording.jsonl')); }
			} catch (e) { found.recordingError = String(e); }
			fs.mkdirSync(out, { recursive: true });
			fs.writeFileSync(path.join(out, 'principal.json'), JSON.stringify(found, null, 2));
		}
	});
});
