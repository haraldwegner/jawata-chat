import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { createChat, type TrafficDirection } from '@jawata/chat-core';
import { InMemoryAgents } from '@jawata/chat-core/test-support';
import { createVscodeHost } from '../host/vscodeHost';
import { sessionRecordingSink, setRecordingDir } from '../utils/Logger';
import type { RecordedLine } from '../utils/SessionRecorder';

/**
 * The tap is the one recorder: through the real connection the chat opens, whatever passes reaches
 * every sink in the order it passed, so the session recording holds exactly what the other sink saw.
 * (The tap's own rules are chat-core's tests; this is the host's sinks on the production path.)
 */
suite('Traffic tap on the production path', function () {
	this.timeout(30000);

	test('the recording and the other sink hold the same messages in the same order', async () => {
		setRecordingDir(fs.mkdtempSync(path.join(os.tmpdir(), 'jawata-tap-')));
		await vscode.workspace.getConfiguration('jawataChat').update('recordSessions', true, vscode.ConfigurationTarget.Global);
		const recording = sessionRecordingSink('test agent');
		assert.ok(recording, 'the recording is on');
		const seen: RecordedLine[] = [];
		// the agent is the replay of R1 over in-memory streams, started through the chat's own supply; connecting makes the first exchange (initialize)
		const { replayAgent, readSession } = await import('@jawata/acp-contract');
		const session = readSession(require.resolve('@jawata/acp-contract/sessions/R1.jsonl'));
		const real = createVscodeHost('test');
		const host = {
			...real,
			agents: new InMemoryAgents((input, output) => replayAgent(session, output, input)),
			settings: { ...real.settings, agents: () => ({ agent: { command: 'in-memory' } }), workspaceCwd: () => '/workspace' },
			sinks: () => [(dir: TrafficDirection, msg: unknown) => seen.push({ dir, msg }), recording.sink],
		};
		const chat = createChat(host);
		try { await chat.flow.connect(); } finally { chat.dispose(); }

		const recorded: RecordedLine[] = fs.readFileSync(recording.filePath, 'utf8').trimEnd().split('\n').map(l => JSON.parse(l));
		assert.ok(recorded.length >= 2, 'the handshake passed the tap');
		assert.deepStrictEqual(recorded[0].dir, 'send');
		assert.strictEqual((recorded[0].msg as { method?: string }).method, 'initialize');
		assert.deepStrictEqual(recorded, seen, 'the recording holds what the other sink saw');
		// the recorder writes the line format by hand (the contract package is test-time only), so the contract's own parser must read what it wrote
		const { parseSession } = await import('@jawata/acp-contract');
		assert.deepStrictEqual(parseSession(fs.readFileSync(recording.filePath, 'utf8')), recorded);
	});

	teardown(async () => { await vscode.workspace.getConfiguration('jawataChat').update('recordSessions', undefined, vscode.ConfigurationTarget.Global); });
});
