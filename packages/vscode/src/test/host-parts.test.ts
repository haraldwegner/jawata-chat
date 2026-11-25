import * as assert from 'assert';
import * as vscode from 'vscode';
import { linesOf } from '../host/WorkspaceFiles';
import { OutputTail, TerminalHost } from '../host/TerminalHost';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { InputHistoryFile } from '../host/InputHistoryFile';
import { LastConversationState } from '../host/LastConversationState';
import type { JawataChatApi } from '../extension';

/** The two small pieces of the host that are pure: which lines a read asks for, and what a command's output keeps. */
suite('Host parts', () => {
	test('a read with neither a line nor a limit is the whole text', () => {
		assert.strictEqual(linesOf('a\nb\nc'), 'a\nb\nc');
	});

	test('a line counts from 1 and a limit counts lines', () => {
		assert.strictEqual(linesOf('a\nb\nc\nd', 2, 2), 'b\nc');
		assert.strictEqual(linesOf('a\nb\nc\nd', 3), 'c\nd');
		assert.strictEqual(linesOf('a\nb\nc\nd', null, 1), 'a');
	});

	test('output is kept whole while it fits, and from the newest end when it does not', () => {
		const tail = new OutputTail(5);
		tail.add(Buffer.from('abc'));
		assert.strictEqual(tail.text, 'abc');
		assert.strictEqual(tail.dropped, false);
		tail.add(Buffer.from('defg'));
		assert.strictEqual(tail.text, 'cdefg');
		assert.strictEqual(tail.dropped, true);
	});

	test('output is never cut in the middle of a character', () => {
		const tail = new OutputTail(3);
		tail.add(Buffer.from('aéé')); // 5 bytes, 3 allowed: the cut would fall inside the first é, so the whole first é goes too
		assert.strictEqual(tail.text, 'é');
	});

	// 28h S25 (D56 (g)): what the person typed is kept in a file of the extension's own storage, so it is there after the editor restarts
	test('the input history file: nothing kept yet is an empty history, and what is saved is what a later store on the file loads', async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jawata-input-history-'));
		try {
			const file = path.join(dir, 'not-yet', 'input-history.json');
			const errors: string[] = [];
			const first = new InputHistoryFile(file, m => errors.push(m));
			assert.deepStrictEqual(await first.load(), []);
			first.save(['newest', 'older']);
			first.save(['newer still', 'newest', 'older']);
			// Both saves are written one after the other in the background. Wait until the file holds the later one, for as long as a slow machine
			// needs (the file existing proves only the FIRST write is done), then assert what a later store on the file loads.
			const wanted = ['newer still', 'newest', 'older'];
			let loaded: string[] = [];
			for (let i = 0; i < 500; i++) {
				loaded = fs.existsSync(file) ? await new InputHistoryFile(file, m => errors.push(m)).load() : [];
				if (JSON.stringify(loaded) === JSON.stringify(wanted)) { break; }
				await new Promise(r => setTimeout(r, 20));
			}
			assert.deepStrictEqual(loaded, wanted, 'the last save wins');
			assert.deepStrictEqual(errors, []);
		} finally { fs.rmSync(dir, { recursive: true, force: true }); }
	});

	test('the input history file: a file that is not a list of texts is refused, so the chat begins empty and its log says why', async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jawata-input-history-'));
		try {
			const file = path.join(dir, 'input-history.json');
			fs.writeFileSync(file, '{ not json');
			await assert.rejects(new InputHistoryFile(file, () => {}).load());
			fs.writeFileSync(file, JSON.stringify({ entries: ['x'] }));
			await assert.rejects(new InputHistoryFile(file, () => {}).load(), /list/);
		} finally { fs.rmSync(dir, { recursive: true, force: true }); }
	});

	test('the chat keeps what is typed in the extension\'s storage for this user, beside its recordings', async () => {
		const api = (await vscode.extensions.getExtension<JawataChatApi | undefined>('jawata.jawata-chat')!.activate())!;
		// the extension runs from its bundle and this test from its own build, so the class is told by its shape and not by identity
		const store = api.host.inputHistory as Partial<InputHistoryFile> | undefined;
		assert.ok(store && typeof store.file === 'string', 'the host gives the chat a store kept in a file');
		assert.strictEqual(path.dirname(store.file!), path.dirname(api.recordingsDir), 'beside the recordings, in the extension\'s storage for this user');
		assert.strictEqual(path.basename(store.file!), 'input-history.json');
	});

	// His ruling 2026-11-25: each window remembers its own last conversation, in the extension's storage for the workspace it has open
	test('the last conversation is kept in the window\'s workspace storage, one window apart from another', () => {
		const memento = () => {
			const kept = new Map<string, unknown>();
			return { get: <T>(key: string) => kept.get(key) as T | undefined, update: async (key: string, value: unknown) => { if (value === undefined) { kept.delete(key); } else { kept.set(key, value); } } };
		};
		const left = memento();
		const right = memento();
		const errors: string[] = [];
		const open = (state: ReturnType<typeof memento>) => new LastConversationState(state, () => true, m => errors.push(m));
		assert.strictEqual(open(left).load(), undefined);
		open(left).save({ sessionId: 'one', agent: 'cursor|grok' });
		open(right).save({ sessionId: 'two' });
		assert.deepStrictEqual(open(left).load(), { sessionId: 'one', agent: 'cursor|grok' });
		assert.deepStrictEqual(open(right).load(), { sessionId: 'two' });
		open(left).save(undefined);
		assert.strictEqual(open(left).load(), undefined);
		assert.deepStrictEqual(errors, []);
	});

	test('a window with no folder open remembers nothing and starts new', () => {
		let writes = 0;
		const state = { get: <T>() => ({ sessionId: 'from-before' }) as T, update: async () => { writes++; } };
		const store = new LastConversationState(state, () => false, () => {});
		assert.strictEqual(store.load(), undefined);
		store.save({ sessionId: 'now' });
		assert.strictEqual(writes, 0);
	});

	test('what is stored in another shape is not a conversation to reopen', () => {
		for (const stored of ['text', {}, { sessionId: 5 }, { sessionId: '' }, null]) {
			const state = { get: <T>() => stored as T, update: async () => {} };
			assert.strictEqual(new LastConversationState(state, () => true, () => {}).load(), undefined, JSON.stringify(stored));
		}
	});

	test('the chat gives its core the window\'s memory', async () => {
		const api = (await vscode.extensions.getExtension<JawataChatApi | undefined>('jawata.jawata-chat')!.activate())!;
		assert.ok(api.host.lastConversation, 'the host gives the chat a memory for this window');
	});

	test('disposing the terminals ends the command still running and closes its editor terminal', async function () {
		this.timeout(20000);
		const host = new TerminalHost();
		const { terminalId } = await host.createTerminal({ sessionId: 's', command: 'sleep', args: ['30'] });
		const ended = host.waitForTerminalExit({ sessionId: 's', terminalId });
		const named = () => vscode.window.terminals.filter(t => t.name === 'ACP: sleep').length;
		assert.strictEqual(named(), 1, 'the editor shows the command');
		host.dispose();
		const exit = await ended;
		assert.strictEqual(exit.signal, 'SIGKILL');
		for (let i = 0; i < 50 && named() > 0; i++) { await new Promise(r => setTimeout(r, 100)); }
		assert.strictEqual(named(), 0, 'its editor terminal is closed');
	});
});

