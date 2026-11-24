import * as assert from 'assert';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

const pause = (milliseconds: number) => new Promise(r => setTimeout(r, milliseconds));
const windowOfTheRun = () => execFileSync('xdotool', ['search', '--onlyvisible', '--name', 'Extension Development Host']).toString().trim().split('\n')[0];

/** The Chrome DevTools Protocol over the debugging port the window was started with, as far as the check needs it. */
class Devtools {
	private next = 1;
	private readonly waiting = new Map<number, { ok: (value: any) => void; fail: (error: Error) => void }>();
	readonly events: { method: string; params: any; sessionId?: string }[] = [];
	private constructor(private readonly socket: WebSocket) {
		socket.onmessage = event => {
			const message = JSON.parse(String(event.data));
			if (message.id !== undefined) {
				const call = this.waiting.get(message.id);
				this.waiting.delete(message.id);
				if (message.error) { call?.fail(new Error(`${message.error.message}`)); } else { call?.ok(message.result); }
			} else { this.events.push(message); }
		};
	}
	static async open(port: number): Promise<Devtools> {
		const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json() as { webSocketDebuggerUrl: string };
		const socket = new WebSocket(version.webSocketDebuggerUrl);
		await new Promise<void>((ok, fail) => { socket.onopen = () => ok(); socket.onerror = () => fail(new Error('the debugging port did not open')); });
		return new Devtools(socket);
	}
	call(method: string, params: object = {}, sessionId?: string): Promise<any> {
		const id = this.next++;
		return new Promise((ok, fail) => {
			this.waiting.set(id, { ok, fail });
			this.socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
		});
	}
	close() { this.socket.close(); }
}

/** A sentence long enough to wrap over several lines in the chat's field, with ordinary words, so it breaks where a person's text breaks. */
const LONG = 'The principal hires the project manager and the project manager hires the developer, who changes the code and runs the tests that belong to the change, and then reports back what was done and what was not. '.repeat(2).trim();

/**
 * Visual, Sprint 28h Stage 27 (z65): in a real VS Code window, with the real field and its real wrapping, an Up pressed on the second visual line
 * of a text that wraps moves the caret one line and leaves the text; an Up pressed on the first visual line recalls what was sent before. The
 * window is started with a debugging port (`.vscode-test.z65.mjs`); the keys are real (xdotool, on a virtual display) and the field is read
 * through the port. Writes JAWATA_Z65_OUT/z65-<label>.json. Evidence for a person to read; it does nothing when the run does not ask for it.
 */
suite('Visual: Up and Down in a wrapped text (z65)', function () {
	this.timeout(240000);

	test('Up from a wrapped text', async function () {
		const out = process.env.JAWATA_Z65_OUT;
		if (!out) { this.skip(); }
		const label = process.env.JAWATA_Z65_LABEL ?? 'real-window';
		const port = Number(process.env.JAWATA_Z65_PORT ?? 9333);

		await vscode.commands.executeCommand('jawataChat.disconnectAgent');
		await vscode.workspace.getConfiguration('jawataChat').update('agent', {
			command: process.env.npm_node_execpath || 'node',
			args: [require.resolve('@jawata/acp-contract/replay'), require.resolve('@jawata/acp-contract/sessions/R3.jsonl')],
		}, vscode.ConfigurationTarget.Global);
		await vscode.commands.executeCommand('jawataChat.openChat');
		await vscode.commands.executeCommand('jawataChat.connectAgent', 'agent');
		await pause(15000);

		const devtools = await Devtools.open(port);
		try {
			const { targetInfos } = await devtools.call('Target.getTargets');
			let page: { sessionId: string; contextId: number; url: string } | undefined;
			for (const target of targetInfos.filter((t: any) => String(t.url).startsWith('vscode-webview://'))) {
				const { sessionId } = await devtools.call('Target.attachToTarget', { targetId: target.targetId, flatten: true });
				const before = devtools.events.length;
				await devtools.call('Runtime.enable', {}, sessionId);
				await pause(300);
				const contexts = devtools.events.slice(before).filter(e => e.sessionId === sessionId && e.method === 'Runtime.executionContextCreated').map(e => e.params.context.id as number);
				for (const contextId of contexts) {
					const probe = await devtools.call('Runtime.evaluate', { contextId, returnByValue: true, expression: `document.querySelector('.input-area textarea') ? 1 : -1` }, sessionId).catch(() => undefined);
					if (probe && probe.result?.value === 1) { page = { sessionId, contextId, url: target.url }; }
				}
			}
			assert.ok(page, 'no webview holds the chat input');
			const evaluate = async (expression: string) => {
				const answer = await devtools.call('Runtime.evaluate', { contextId: page!.contextId, returnByValue: true, awaitPromise: true, expression }, page!.sessionId);
				if (answer.exceptionDetails) { throw new Error(JSON.stringify(answer.exceptionDetails)); }
				return answer.result.value;
			};
			const workbench = targetInfos.find((t: any) => t.type === 'page' && String(t.url).includes('workbench'));
			assert.ok(workbench, 'the workbench page was not found');
			const workbenchSession = (await devtools.call('Target.attachToTarget', { targetId: workbench.targetId, flatten: true })).sessionId;
			const frame = (await devtools.call('Runtime.evaluate', { returnByValue: true, expression: `(() => { const f = [...document.querySelectorAll('iframe.webview')].find(f => f.src === ${JSON.stringify(page.url)}); const r = f && f.getBoundingClientRect(); return r ? { x: r.x, y: r.y } : null; })()` }, workbenchSession)).result.value;
			assert.ok(frame, 'the chat webview was not found in the workbench page');
			const field = await evaluate(`(() => { const r = document.querySelector('.input-area textarea').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
			execFileSync('xdotool', ['mousemove', '--window', windowOfTheRun(), String(Math.round(frame.x + field.x)), String(Math.round(frame.y + field.y)), 'click', '1']);
			await pause(1000);
			assert.strictEqual(await evaluate(`document.activeElement && document.activeElement.tagName`), 'TEXTAREA', 'the click did not put the focus in the input field');

			const type = (text: string) => execFileSync('xdotool', ['type', '--window', windowOfTheRun(), '--delay', '8', text]);
			const key = (name: string) => execFileSync('xdotool', ['key', '--window', windowOfTheRun(), name]);
			const state = () => evaluate(`(() => { const t = document.querySelector('.input-area textarea'); return { value: t.value, caret: t.selectionStart, width: t.clientWidth, height: t.clientHeight }; })()`) as Promise<{ value: string; caret: number; width: number; height: number }>;

			// one message sent, so that there is something for an Up on the first line to recall
			type('first message sent before');
			key('Return');
			await pause(2500);
			type(LONG);
			await pause(600);
			const typed = await state();
			assert.strictEqual(typed.value, LONG, 'the long text did not arrive in the field as typed');

			// the lines as the browser lays them out: Home at the end of the text and walking up with the browser's own Up is not possible before the
			// field is told, so the first line's end is read from the text: how many characters fit before the first wrap, found by Home/End from each caret
			const rows: { step: string; before: number; after: number; textKept: boolean; recalled: string | null }[] = [];
			const press = async (step: string, name: string) => {
				const before = await state();
				key(name);
				await pause(400);
				const after = await state();
				rows.push({ step, before: before.caret, after: after.caret, textKept: after.value === LONG, recalled: after.value === LONG ? null : after.value });
			};
			await press('Up from the end (last visual line)', 'Up');
			await press('Up again', 'Up');
			await press('Up again', 'Up');
			const homeCaret = await (async () => { key('ctrl+Home'); await pause(300); return (await state()).caret; })();
			await press('Down from the very start', 'Down');
			await press('Up back to the first line', 'Up');
			await press('Up on the first visual line (should recall)', 'Up');

			// a long message brought back by Up, then Up inside it
			key('ctrl+a');
			key('BackSpace');
			await pause(300);
			type(LONG);
			key('Return');
			await pause(2500);
			const recalledRows: { step: string; before: number; after: number; textKept: boolean; recalled: string | null }[] = [];
			const pressRecalled = async (step: string, name: string) => {
				const before = await state();
				key(name);
				await pause(400);
				const after = await state();
				recalledRows.push({ step, before: before.caret, after: after.caret, textKept: after.value === before.value, recalled: after.value === before.value ? null : after.value.slice(0, 40) });
			};
			await pressRecalled('Up on an empty field (recalls the long message)', 'Up');
			await pressRecalled('Up inside the recalled long message', 'Up');
			await pressRecalled('Up again', 'Up');
			await pressRecalled('Up again', 'Up');
			await pressRecalled('Up on its first line (recalls the one before)', 'Up');

			const result = { label, window: { width: typed.width, height: typed.height }, chars: LONG.length, ctrlHome: homeCaret, rows, recalledRows };
			fs.mkdirSync(out, { recursive: true });
			fs.writeFileSync(path.join(out, `z65-${label}.json`), JSON.stringify(result, null, 1));
			console.log(JSON.stringify(result, null, 1));
		} finally {
			devtools.close();
		}
	});
});
