import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import type { JawataChatApi } from '../extension';
import { KEPT_RECORDINGS, SessionRecorder } from '../utils/SessionRecorder';

/** The recording switch: off as shipped, so a session writes no file; on, one file a session, and the last twenty kept. */
suite('The recording switch', function () {
	this.timeout(60000);
	const config = () => vscode.workspace.getConfiguration('jawataChat');
	const node = process.env.npm_node_execpath || 'node';
	/** Every .jsonl file under these folders: a session file anywhere under the extension's storage or the workspace. */
	const sessionFilesUnder = (roots: string[]): string[] => roots.flatMap(root => {
		if (!fs.existsSync(root)) { return []; }
		return fs.readdirSync(root, { recursive: true, withFileTypes: true })
			.filter(e => e.isFile() && e.name.endsWith('.jsonl')).map(e => path.join(e.parentPath, e.name));
	}).sort();
	const recordings = (dir: string) => (fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.endsWith('.jsonl')).sort() : []);

	teardown(async () => { await config().update('recordSessions', undefined, vscode.ConfigurationTarget.Global); });

	async function aSession(): Promise<JawataChatApi> {
		const api = (await vscode.extensions.getExtension<JawataChatApi | undefined>('jawata.jawata-chat')!.activate())!;
		await vscode.commands.executeCommand('jawataChat.disconnectAgent');
		await config().update('agent', { command: node, args: [require.resolve('@jawata/acp-contract/replay'), require.resolve('@jawata/acp-contract/sessions/R1.jsonl')] }, vscode.ConfigurationTarget.Global);
		await vscode.commands.executeCommand('jawataChat.connectAgent');
		await vscode.commands.executeCommand('jawataChat.sendPrompt', 'hello');
		await new Promise(r => setTimeout(r, 300));
		return api;
	}

	test('with the settings as shipped a session writes no file; with the switch on the same session writes one', async () => {
		await config().update('recordSessions', undefined, vscode.ConfigurationTarget.Global);
		assert.strictEqual(config().inspect('recordSessions')?.defaultValue, false, 'the shipped default is off');
		const dir = (await vscode.extensions.getExtension<JawataChatApi | undefined>('jawata.jawata-chat')!.activate())!.recordingsDir;
		// where a session file could be written: the extension's storage (the folder the recordings folder sits in), and the workspace
		const roots = [path.dirname(dir), ...(vscode.workspace.workspaceFolders ?? []).map(f => f.uri.fsPath)];
		const before = recordings(dir);
		const everywhere = sessionFilesUnder(roots);
		await aSession();
		assert.deepStrictEqual(recordings(dir), before, 'a recording was written with the switch off');
		assert.deepStrictEqual(sessionFilesUnder(roots), everywhere, 'a session file was written somewhere under the extension\'s storage or the workspace with the switch off');
		await config().update('recordSessions', true, vscode.ConfigurationTarget.Global);
		await aSession();
		const after = recordings(dir);
		assert.strictEqual(after.filter(f => !before.includes(f)).length, 1, 'the same session with the switch on writes one (at the cap of twenty, the oldest goes)');
	});

	test('with 21 recordings made, 20 remain, the newest', () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jawata-keep-'));
		const first = Date.UTC(2026, 9, 19, 12, 0, 0);
		const made: string[] = [];
		for (let i = 0; i < KEPT_RECORDINGS + 1; i++) {
			const recorder = new SessionRecorder(dir, 'agent', new Date(first + i * 1000));
			recorder.record('send', { n: i });
			made.push(path.basename(recorder.filePath));
		}
		assert.deepStrictEqual(recordings(dir), made.slice(1), 'the oldest is gone and the other twenty are the newest');
		assert.strictEqual(recordings(dir).length, 20);
	});
});
