import * as assert from 'assert';
import * as vscode from 'vscode';
import { linesOf } from '../host/WorkspaceFiles';
import { OutputTail, TerminalHost } from '../host/TerminalHost';

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

