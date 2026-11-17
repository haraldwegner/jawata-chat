import * as assert from 'assert';
import * as os from 'os';
import * as path from 'path';
import { ClientSideConnection, type SessionNotification } from '@agentclientprotocol/sdk';
import { agentHostFailures, notifierFailures, syncReadFailures } from '@jawata/chat-core/test-support';
import { AgentProcesses } from '../host/AgentProcesses';
import { VscodeNotifier } from '../host/VscodeNotifier';
import { createVscodeHost } from '../host/vscodeHost';

/** The extension's real agent host and notifier, held to the one contract every host is held to (the core's port conformance suite). */
suite('The extension\'s host conforms to the ports\' contract', function () {
	this.timeout(30000);
	const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

	test('the agent processes: spawn, kill, onClosed told once, a disposed registration told nothing', async () => {
		const processes = new AgentProcesses();
		try {
			const staysRunning = { command: process.execPath, args: ['-e', 'setInterval(() => {}, 1000)'] };
			assert.deepStrictEqual(await agentHostFailures(processes, staysRunning, sleep, { command: path.join(os.tmpdir(), 'no-such-program-for-jawata') }), []);
		} finally { processes.dispose(); }
	});

	test('S19-1: a long answer of multi-byte characters, written in five-byte pieces by a real program, arrives whole and ends the turn through the host\'s stream', async () => {
		const processes = new AgentProcesses();
		try {
			const long = Array.from({ length: 90 }, (_, i) => `— ${i + 1} · αβγδε — the parsing of dates is harder than it looks, and the formats people use are many.`).join('\n');
			// a program that answers the three requests of a turn by hand, and writes every line in pieces of five bytes
			const program = `
				const long = ${JSON.stringify(long)};
				let chain = Promise.resolve();
				const send = (message) => { chain = chain.then(async () => { const bytes = Buffer.from(JSON.stringify(message) + '\\n'); for (let at = 0; at < bytes.length; at += 5) { process.stdout.write(bytes.subarray(at, at + 5)); await new Promise(r => setTimeout(r, 0)); } }); };
				let pending = '';
				process.stdin.setEncoding('utf8');
				process.stdin.on('data', (text) => {
					pending += text;
					let end;
					while ((end = pending.indexOf('\\n')) >= 0) {
						const request = JSON.parse(pending.slice(0, end)); pending = pending.slice(end + 1);
						if (request.method === 'initialize') { send({ jsonrpc: '2.0', id: request.id, result: { protocolVersion: 1, agentCapabilities: {}, agentInfo: { name: 'pieces', version: '1' } } }); }
						else if (request.method === 'session/new') { send({ jsonrpc: '2.0', id: request.id, result: { sessionId: 's1' } }); }
						else if (request.method === 'session/prompt') {
							send({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: 's1', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: long } } } });
							send({ jsonrpc: '2.0', id: request.id, result: { stopReason: 'end_turn' } });
						}
					}
				});`;
			const handle = processes.spawnAgent('pieces', { command: process.execPath, args: ['-e', program] });
			const heard: string[] = [];
			const connection = new ClientSideConnection(() => ({
				async sessionUpdate(notification: SessionNotification) { const update = notification.update; if (update.sessionUpdate === 'agent_message_chunk' && update.content.type === 'text') { heard.push(update.content.text); } },
				async requestPermission() { return { outcome: { outcome: 'cancelled' as const } }; },
			}), handle.stream);
			await connection.initialize({ protocolVersion: 1, clientCapabilities: {} });
			const session = await connection.newSession({ cwd: os.tmpdir(), mcpServers: [] });
			for (const text of ['first', 'second']) {
				const answer = await Promise.race([
					connection.prompt({ sessionId: session.sessionId, prompt: [{ type: 'text', text }] }),
					sleep(20000).then(() => { throw new Error(`the turn of "${text}" did not end within 20 s`); }),
				]);
				assert.strictEqual(answer.stopReason, 'end_turn');
			}
			assert.strictEqual(heard.join(''), long + long, 'the long answer arrived whole, twice');
		} finally { processes.dispose(); }
	});

	test('the notifier gives back what its job gives and passes on the error its job throws', async () => {
		assert.deepStrictEqual(await notifierFailures(new VscodeNotifier()), []);
	});

	test('the host answers the core\'s synchronous reads at once (ledger 28i-C11-5)', () => {
		const host = createVscodeHost('0.0.0-test');
		try { assert.deepStrictEqual(syncReadFailures(host), []); } finally { host.terminal.dispose(); }
	});
});
