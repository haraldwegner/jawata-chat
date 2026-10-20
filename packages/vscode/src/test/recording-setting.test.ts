import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as vscode from 'vscode';
import { sessionRecordingSink, setRecordingDir } from '../utils/Logger';

/** The recording follows the recordSessions setting: off at connect means no file, off mid-session stops it. */
suite('Recording follows recordSessions', () => {
	const config = () => vscode.workspace.getConfiguration('jawataChat');
	const msg = (id: number) => ({ jsonrpc: '2.0', id, method: 'x' });

	teardown(async () => { await config().update('recordSessions', undefined, vscode.ConfigurationTarget.Global); });

	test('the traffic channel is off as shipped: the editor keeps an output channel in a log file, and the conversation is not to be on disk', () => {
		const traffic = config().inspect<boolean>('logTraffic');
		assert.strictEqual(traffic?.defaultValue, false);
		const manifest = vscode.extensions.getExtension('jawata.jawata-chat')!.packageJSON.contributes.configuration.properties['jawataChat.logTraffic'];
		assert.ok(!/writes no file/i.test(manifest.description), 'the setting says it writes no file; the editor writes its output channels to its log folder');
	});

	test('off at connect: no recording', async () => {
		setRecordingDir(fs.mkdtempSync(path.join(os.tmpdir(), 'jawata-rec-')));
		await config().update('recordSessions', false, vscode.ConfigurationTarget.Global);
		assert.strictEqual(sessionRecordingSink('agent'), undefined);
	});

	test('off mid-session: the file stops growing', async () => {
		setRecordingDir(fs.mkdtempSync(path.join(os.tmpdir(), 'jawata-rec-')));
		await config().update('recordSessions', true, vscode.ConfigurationTarget.Global);
		const rec = sessionRecordingSink('agent');
		assert.ok(rec);
		rec.sink('send', msg(1));
		await config().update('recordSessions', false, vscode.ConfigurationTarget.Global);
		rec.sink('send', msg(2));
		const lines = fs.readFileSync(rec.filePath, 'utf8').trimEnd().split('\n');
		assert.deepStrictEqual(lines.map(l => JSON.parse(l).msg.id), [1]);
	});
});
