import * as assert from 'assert';
import * as os from 'os';
import * as path from 'path';
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

	test('the notifier gives back what its job gives and passes on the error its job throws', async () => {
		assert.deepStrictEqual(await notifierFailures(new VscodeNotifier()), []);
	});

	test('the host answers the core\'s synchronous reads at once (ledger 28i-C11-5)', () => {
		const host = createVscodeHost('0.0.0-test');
		try { assert.deepStrictEqual(syncReadFailures(host), []); } finally { host.terminal.dispose(); }
	});
});
