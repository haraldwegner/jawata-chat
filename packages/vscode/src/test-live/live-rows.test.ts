import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import type { JawataChatApi } from '../extension';

/**
 * Sprint 28h S17, the rows the controls run left half-run, against a real agent. JAWATA_LIVE_MODE picks one:
 *   two   the prompt makes the agent hire a seat twice (R4: two entries), then the chat lists its sessions and opens the first (R6: load)
 *   stop  the prompt makes the agent hire a seat with a long brief; the chat stops the hire while it runs (R4: stop)
 *   tree  the prompt makes the agent hire a pm, then a chief engineer under it, then a worker under that (R12: parentPlanId)
 * What the chat holds afterwards is written to JAWATA_LIVE_OUT/rows-<mode>.json. The prompt and the agent come from the same variables as
 * the other live runs.
 */
suite('Live agent rows', () => {
	test('the rows the controls run left half-run', async function () {
		this.timeout(500000);
		const out = process.env.JAWATA_LIVE_OUT;
		const prompt = process.env.JAWATA_LIVE_PROMPT;
		const mode = process.env.JAWATA_LIVE_MODE;
		assert.ok(out && prompt && mode && process.env.JAWATA_LIVE_AGENT, 'JAWATA_LIVE_OUT, _PROMPT, _MODE and _AGENT are set');
		const config = vscode.workspace.getConfiguration('jawataChat');
		await config.update('agent', JSON.parse(process.env.JAWATA_LIVE_AGENT), vscode.ConfigurationTarget.Global);
		await config.update('recordSessions', true, vscode.ConfigurationTarget.Global);
		await vscode.commands.executeCommand('jawataChat.openChat');
		await vscode.commands.executeCommand('jawataChat.connectAgent', 'agent');
		const chat = (await vscode.extensions.getExtension<JawataChatApi | undefined>('jawata.jawata-chat')!.activate())!.chat;
		const waitFor = async <T>(what: string, read: () => T | null | undefined | false, ms = 30000): Promise<T> => {
			const until = Date.now() + ms;
			for (;;) {
				const value = read();
				if (value) { return value; }
				assert.ok(Date.now() < until, `timed out waiting for ${what}`);
				await new Promise(r => setTimeout(r, 100));
			}
		};
		const ended = (h: { state: string }) => h.state === 'done' || h.state === 'failed';
		const found: Record<string, unknown> = { mode };
		const write = () => {
			fs.mkdirSync(out, { recursive: true });
			fs.writeFileSync(path.join(out, `rows-${mode}.json`), JSON.stringify(found, null, 2));
		};

		try {
			if (mode === 'stop') {
				await vscode.commands.executeCommand('jawataChat.sendPrompt', prompt);
				const seen = new Set<string>();
				const running = await waitFor('a hire that has not ended', () => { for (const h of chat.snapshot().hires) { seen.add(h.state); } return chat.snapshot().hires.find(h => !ended(h)); }, 120000).catch(e => { found.statesSeen = [...seen]; throw e; });
				found.statesSeen = [...seen];
				found.running = running;
				await chat.handle({ type: 'stopHire', planId: running.planId });
				found.afterStop = await waitFor('the hire ended after the stop', () => chat.snapshot().hires.find(h => h.planId === running.planId && ended(h)), 60000);
			} else if (mode === 'two') {
				await vscode.commands.executeCommand('jawataChat.sendPrompt', prompt);
				const hires = await waitFor('two finished hires', () => { const h = chat.snapshot().hires; return h.length >= 2 && h.every(ended) ? h : null; }, 240000);
				found.hires = hires;
				await chat.handle({ type: 'listSessions' });
				const history = await waitFor('the session list', () => chat.snapshot().history);
				found.history = { count: history.sessions.length, sessions: history.sessions.map(s => ({ sessionId: s.sessionId, title: s.title })) };
				found.beforeDisconnect = { entries: chat.snapshot().entries.length, hires: chat.snapshot().hires.length };
				// opening the session that is already active is a no-op, and a replace asks the person first, so the agent is disconnected
				// and connected again: the new conversation is empty and the old session is one the agent lists
				const oldId = history.sessions[0].sessionId;
				await vscode.commands.executeCommand('jawataChat.disconnectAgent');
				await vscode.commands.executeCommand('jawataChat.connectAgent', 'agent');
				found.afterReconnect = await waitFor('an empty chat on a new session', () => { const s = chat.snapshot(); return s.session && s.session.sessionId !== oldId && s.entries.length === 0 ? { entries: 0, hires: s.hires.length, sessionId: s.session.sessionId } : null; });
				const before = { entries: chat.snapshot().entries.length, hires: chat.snapshot().hires.length };
				await chat.handle({ type: 'openSession', sessionId: oldId });
				let sawLoading = false;
				const loadDeadline = Date.now() + 60000;
				while (Date.now() < loadDeadline) {
					const s = chat.snapshot();
					sawLoading = sawLoading || s.loading;
					if (sawLoading && !s.loading) { break; }
					await new Promise(r => setTimeout(r, 10));
				}
				found.sawLoading = sawLoading;
				const after = chat.snapshot();
				found.afterLoad = { before, entries: after.entries.length, hires: after.hires.length, loading: after.loading, hiresSeen: after.hires };
			} else if (mode === 'tree') {
				await vscode.commands.executeCommand('jawataChat.sendPrompt', prompt);
				const hires = await waitFor('three finished hires', () => { const h = chat.snapshot().hires; return h.length >= 3 && h.every(ended) ? h : null; }, 420000);
				found.hires = hires;
			} else {
				assert.fail(`unknown JAWATA_LIVE_MODE ${mode}`);
			}
		} finally {
			found.finalHires = chat.snapshot().hires;
			write();
		}
	});
});
