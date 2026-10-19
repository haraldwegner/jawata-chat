import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { AGENT_KEY, ConnectionManager, SessionManager, AgentUpdates } from '@jawata/chat-core';
import { createVscodeHost } from '../host/vscodeHost';

/**
 * What the chat offers to open is what the agent lists (`session/list`) and nothing the chat kept
 * itself. R6 is the recorded answer of a real Claude to `session/list`, cut to one session.
 */
suite('Session list', function () {
	this.timeout(60000);
	const node = process.env.npm_node_execpath || 'node';
	const src = path.join(__dirname, '..', '..', 'src');

	test('the agent lists one session, titled Pong, and the chat adds none of its own', async () => {
		const config = vscode.workspace.getConfiguration('jawataChat');
		await config.update('agent', { command: node, args: [require.resolve('@jawata/acp-contract/replay'), require.resolve('@jawata/acp-contract/sessions/R6.jsonl')] }, vscode.ConfigurationTarget.Global);
		const handler = new AgentUpdates();
		const host = createVscodeHost('test');
		const sessions = new SessionManager(host, new ConnectionManager(handler, host));
		try {
			const { sessions: listed } = await sessions.listSessions(AGENT_KEY);
			assert.strictEqual(listed.length, 1, 'the one session R6 lists');
			assert.strictEqual(listed[0].title, 'Pong');
		} finally {
			sessions.dispose();
			handler.dispose();
		}
	});

	test('the chat keeps no history of its own: no cache in the source, no command, no menu entry', () => {
		const files = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
			const p = path.join(dir, e.name);
			return e.isDirectory() ? (e.name.startsWith('test') ? [] : files(p)) : (p.endsWith('.ts') ? [p] : []);
		});
		for (const f of files(src)) {
			const text = fs.readFileSync(f, 'utf8');
			assert.ok(!/SessionHistoryStore|historyStore|forgetSession|session-local/.test(text), `${path.relative(src, f)} still refers to the local history cache`);
		}
		const manifest = fs.readFileSync(path.join(src, '..', 'package.json'), 'utf8');
		assert.ok(!/forgetSession|session-local/.test(manifest), 'the manifest still names the forget command or the local session kind');
	});
});
