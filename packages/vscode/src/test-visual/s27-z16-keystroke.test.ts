import * as assert from 'assert';
import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

const pause = (milliseconds: number) => new Promise(r => setTimeout(r, milliseconds));
const windowOfTheRun = () => execFileSync('xdotool', ['search', '--onlyvisible', '--name', 'Extension Development Host']).toString().trim().split('\n')[0];

/** How many keystrokes are measured, and how far apart: 300 ms is longer than the chat's 250 ms pause before it tells the core its draft. */
const KEYS = 20;
const KEY_SPACING_MS = 300;

/** The Chrome DevTools Protocol, over the debugging port the window was started with, as far as the measurement needs it. */
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

/** The page's own side of the measurement: the marks on a real keystroke and on the next frame, the long tasks and the browser's event timing. */
const INSTALL = `(() => {
  const z = window.__z16 = { keys: [], long: [], timing: [] };
  addEventListener('keydown', e => { if (e.isTrusted && e.key.length === 1) { z.keys.push({ down: e.timeStamp, key: e.key }); } }, true);
  addEventListener('input', e => {
    const k = z.keys[z.keys.length - 1];
    if (!k || k.input !== undefined) { return; }
    k.input = performance.now();
    requestAnimationFrame(() => {
      k.raf = performance.now();
      const channel = new MessageChannel();
      channel.port1.onmessage = () => { k.afterFrame = performance.now(); };
      channel.port2.postMessage(0);
    });
  }, true);
  new PerformanceObserver(list => { for (const e of list.getEntries()) { z.long.push({ start: e.startTime, duration: e.duration }); } }).observe({ type: 'longtask', buffered: true });
  new PerformanceObserver(list => { for (const e of list.getEntries()) { z.timing.push({ name: e.name, start: e.startTime, processingStart: e.processingStart, processingEnd: e.processingEnd, duration: e.duration }); } })
    .observe({ type: 'event', durationThreshold: 16, buffered: false });
  return 'installed';
})()`;

const median = (values: number[]) => {
	const sorted = [...values].sort((a, b) => a - b);
	const middle = sorted.length >> 1;
	return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

/** Which part of the render a trace event's own time belongs to. */
const PART: Record<string, 'script' | 'style' | 'layout' | 'paint'> = {
	FunctionCall: 'script', EvaluateScript: 'script', 'v8.callFunction': 'script', 'v8.run': 'script', 'v8.compile': 'script', RunMicrotasks: 'script', TimerFire: 'script',
	FireAnimationFrame: 'script', EventDispatch: 'script', MinorGC: 'script', MajorGC: 'script', 'V8.GC_MC_BACKGROUND_MARKING': 'script',
	UpdateLayoutTree: 'style', RecalcStyle: 'style',
	Layout: 'layout', 'Layout.Block': 'layout',
	PrePaint: 'paint', Paint: 'paint', Layerize: 'paint', Commit: 'paint', UpdateLayer: 'paint', 'Commit.Layer': 'paint', CompositeLayers: 'paint',
};

interface TraceEvent { name: string; ph: string; ts: number; dur?: number; pid: number; tid: number; args?: any }

/** Self time per event name on the webview's main thread: an event's duration less its children's, so the parts add up to the thread's busy time. */
function breakdown(events: TraceEvent[]) {
	const input = events.find(e => e.name === 'EventDispatch' && e.args?.data?.type === 'input');
	assert.ok(input, 'the trace holds no input event');
	const mine = events.filter(e => e.pid === input.pid && e.tid === input.tid && e.ph === 'X' && e.dur !== undefined)
		.sort((a, b) => a.ts - b.ts || (b.dur ?? 0) - (a.dur ?? 0));
	const self = new Map<string, number>();
	const stack: { event: TraceEvent; end: number; children: number }[] = [];
	const close = () => {
		const top = stack.pop()!;
		self.set(top.event.name, (self.get(top.event.name) ?? 0) + (top.event.dur! - top.children));
		if (stack.length) { stack[stack.length - 1].children += top.event.dur!; }
	};
	for (const event of mine) {
		while (stack.length && stack[stack.length - 1].end <= event.ts) { close(); }
		stack.push({ event, end: event.ts + event.dur!, children: 0 });
	}
	while (stack.length) { close(); }
	const parts = { script: 0, style: 0, layout: 0, paint: 0, other: 0 };
	for (const [name, micro] of self) {
		if (name === 'RunTask' || name === 'ThreadControllerImpl::RunTask') { parts.other += micro; continue; }
		parts[PART[name] ?? 'other'] += micro;
	}
	const ms = (micro: number) => Math.round(micro / 100) / 10;
	return {
		partsMs: { script: ms(parts.script), style: ms(parts.style), layout: ms(parts.layout), paint: ms(parts.paint), otherOnTheThread: ms(parts.other) },
		topSelfMs: [...self].sort((a, b) => b[1] - a[1]).slice(0, 12).map(([name, micro]) => ({ name, ms: ms(micro) })),
	};
}

/**
 * Visual, Sprint 28h Stage 27 (z16): how long a real keystroke in the chat's input takes to reach the next frame, in a real VS Code window, with a
 * session of no messages and with a recorded one of 2000 (JAWATA_Z16_SESSION is `empty` or `long`; the window is started with a debugging port,
 * `.vscode-test.z16.mjs`). The page is read through its debugging port: marks on the keystroke and the next frame, the browser's event timing and
 * long tasks, and the browser's own trace of the typing, broken into script, style, layout and paint. Writes JAWATA_Z16_OUT/<label>-<session>.json.
 * Evidence for a person to read, not a gate; it does nothing when the run does not ask for it.
 */
suite('Visual: the chat input keeps up with typing (z16)', function () {
	this.timeout(240000);

	test('twenty real keystrokes: keystroke to next frame', async function () {
		const which = process.env.JAWATA_Z16_SESSION;
		if (which !== 'empty' && which !== 'long') { this.skip(); }
		const out = process.env.JAWATA_Z16_OUT;
		assert.ok(out, 'JAWATA_Z16_OUT is set');
		const label = process.env.JAWATA_Z16_LABEL ?? 'before';
		const port = Number(process.env.JAWATA_Z16_PORT ?? 9333);

		const recording = which === 'long' ? process.env.JAWATA_Z16_LONG! : require.resolve('@jawata/acp-contract/sessions/R3.jsonl');
		assert.ok(recording, 'the long session file is named in JAWATA_Z16_LONG');
		await vscode.commands.executeCommand('jawataChat.disconnectAgent');
		await vscode.workspace.getConfiguration('jawataChat').update('agent', {
			command: process.env.npm_node_execpath || 'node',
			args: [require.resolve('@jawata/acp-contract/replay'), recording],
		}, vscode.ConfigurationTarget.Global);
		await vscode.commands.executeCommand('jawataChat.openChat');
		if (which === 'long') { await vscode.commands.executeCommand('jawataChat.openSession', 'eb4d7d56-b0b4-40d4-998f-2cf1fa3fd890'); } else { await vscode.commands.executeCommand('jawataChat.connectAgent', 'agent'); }
		await pause(which === 'long' ? 20000 : 4000);

		const devtools = await Devtools.open(port);
		try {
			// the chat's page: the webview whose document holds the input field
			const { targetInfos } = await devtools.call('Target.getTargets');
			let page: { sessionId: string; contextId: number; messages: number; url: string } | undefined;
			for (const target of targetInfos.filter((t: any) => String(t.url).startsWith('vscode-webview://'))) {
				const { sessionId } = await devtools.call('Target.attachToTarget', { targetId: target.targetId, flatten: true });
				const before = devtools.events.length;
				await devtools.call('Runtime.enable', {}, sessionId);
				await pause(300);
				const contexts = devtools.events.slice(before).filter(e => e.sessionId === sessionId && e.method === 'Runtime.executionContextCreated').map(e => e.params.context.id as number);
				for (const contextId of contexts) {
					const probe = await devtools.call('Runtime.evaluate', { contextId, returnByValue: true, expression: `document.querySelector('.input-area textarea') ? document.querySelectorAll('.messages > *').length : -1` }, sessionId).catch(() => undefined);
					if (probe && probe.result?.value >= 0) { page = { sessionId, contextId, messages: probe.result.value, url: target.url }; }
				}
			}
			assert.ok(page, 'no webview holds the chat input');
			const evaluate = async (expression: string) => {
				const answer = await devtools.call('Runtime.evaluate', { contextId: page!.contextId, returnByValue: true, awaitPromise: true, expression }, page!.sessionId);
				if (answer.exceptionDetails) { throw new Error(JSON.stringify(answer.exceptionDetails)); }
				return answer.result.value;
			};
			const shown = await evaluate(`({ messages: document.querySelectorAll('.messages > *').length, nodes: document.querySelectorAll('*').length })`);

			// a real click on the field: the field's place in the window is the webview's own plus the field's in it
			const workbench = targetInfos.find((t: any) => t.type === 'page' && String(t.url).includes('workbench'));
			assert.ok(workbench, 'the workbench page was not found');
			const workbenchSession = (await devtools.call('Target.attachToTarget', { targetId: workbench.targetId, flatten: true })).sessionId;
			const frame = (await devtools.call('Runtime.evaluate', { returnByValue: true, expression: `(() => { const f = [...document.querySelectorAll('iframe.webview')].find(f => f.src === ${JSON.stringify(page.url)}); const r = f && f.getBoundingClientRect(); return r ? { x: r.x, y: r.y } : null; })()` }, workbenchSession)).result.value;
			assert.ok(frame, 'the chat webview was not found in the workbench page');
			const field = await evaluate(`(() => { const r = document.querySelector('.input-area textarea').getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`);
			execFileSync('xdotool', ['mousemove', '--window', windowOfTheRun(), String(Math.round(frame.x + field.x)), String(Math.round(frame.y + field.y)), 'click', '1']);
			await pause(1500);
			assert.strictEqual(await evaluate(`document.activeElement && document.activeElement.tagName`), 'TEXTAREA', 'the click did not put the focus in the input field');

			await evaluate(INSTALL);
			devtools.events.length = 0;
			await devtools.call('Tracing.start', { transferMode: 'ReportEvents', traceConfig: { recordMode: 'recordContinuously', includedCategories: ['devtools.timeline', 'disabled-by-default-devtools.timeline', 'v8.execute', 'blink.user_timing'] } });
			await pause(500);
			execFileSync('xdotool', ['type', '--window', windowOfTheRun(), '--delay', String(KEY_SPACING_MS), 'abcdefghijklmnopqrst']);
			await pause(2000);
			const done = new Promise<void>(ok => { const timer = setInterval(() => { if (devtools.events.some(e => e.method === 'Tracing.tracingComplete')) { clearInterval(timer); ok(); } }, 100); });
			await devtools.call('Tracing.end');
			await done;
			const trace = devtools.events.filter(e => e.method === 'Tracing.dataCollected').flatMap(e => e.params.value as TraceEvent[]);

			const marks = await evaluate(`JSON.stringify(window.__z16)`).then(JSON.parse) as { keys: { down: number; input?: number; raf?: number; afterFrame?: number }[]; long: { start: number; duration: number }[]; timing: { name: string; duration: number }[] };
			const complete = marks.keys.filter(k => k.input !== undefined && k.raf !== undefined && k.afterFrame !== undefined);
			assert.ok(complete.length >= KEYS - 2, `only ${complete.length} of ${KEYS} keystrokes were marked`);
			const toFrame = complete.map(k => k.raf! - k.down);
			const toAfterFrame = complete.map(k => k.afterFrame! - k.down);
			const inTheHandlers = complete.map(k => k.input! - k.down);
			const round = (n: number) => Math.round(n * 10) / 10;
			const result = {
				label, session: which, keystrokes: complete.length, keySpacingMs: KEY_SPACING_MS,
				page: { url: page.url.replace(/id=.*/, 'id=…'), ...shown },
				keystrokeToNextFrameMs: { median: round(median(toFrame)), min: round(Math.min(...toFrame)), max: round(Math.max(...toFrame)), all: toFrame.map(round) },
				keystrokeToAfterTheFrameMs: { median: round(median(toAfterFrame)), max: round(Math.max(...toAfterFrame)) },
				keystrokeToInputEventMs: { median: round(median(inTheHandlers)), max: round(Math.max(...inTheHandlers)) },
				browserEventTiming: { entriesOver16ms: marks.timing.length, durations: marks.timing.map(t => t.duration) },
				longTasks: { count: marks.long.length, durationsMs: marks.long.map(l => round(l.duration)) },
				trace: { events: trace.length, ...breakdown(trace) },
			};
			fs.writeFileSync(path.join(out, `${label}-${which}.json`), JSON.stringify(result, null, 1));
			console.log(`z16 ${label} ${which}: median keystroke to next frame ${result.keystrokeToNextFrameMs.median} ms (${shown.messages} messages shown)`);
		} finally { devtools.close(); }
	});
});
