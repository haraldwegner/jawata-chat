import * as assert from 'assert';
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

const ID = 'jawata.jawata-chat';
const PREFIX = 'jawataChat.';

/**
 * The extension's own shape: our id and prefix on every contribution, one agent setting, and no
 * registry browser, preset agents or add/remove agent commands.
 */
suite('Extension shape', () => {
	const pkg = () => vscode.extensions.getExtension(ID)!.packageJSON;

	test('every contributed command carries our prefix', () => {
		const commands: { command: string }[] = pkg().contributes.commands;
		const foreign = commands.map(c => c.command).filter(c => !c.startsWith(PREFIX));
		assert.deepStrictEqual(foreign, []);
	});

	test('every contributed setting carries our prefix', () => {
		const keys = Object.keys(pkg().contributes.configuration.properties);
		assert.deepStrictEqual(keys.filter(k => !k.startsWith(PREFIX)), []);
	});

	test('there is no registry browser and no add or remove agent command', async () => {
		await vscode.extensions.getExtension(ID)!.activate();
		const registered = await vscode.commands.getCommands(true);
		for (const gone of ['browseRegistry', 'removeAgent', 'addAgent']) {
			assert.ok(!registered.includes(PREFIX + gone), `${PREFIX + gone} is still registered`);
		}
		assert.ok(registered.includes(PREFIX + 'configureAgent'));
	});

	test('the chat is the only view (once for each place); there is no Agents tree and no command that served one', async () => {
		const views = Object.values(pkg().contributes.views as Record<string, { id: string }[]>).flat().map(v => v.id);
		assert.deepStrictEqual(views, ['jawata-chat-view', 'jawata-chat-view-right', 'jawata-chat-view-bottom'], 'one chat view for each place that is a view; the editor area is a panel');
		await vscode.extensions.getExtension(ID)!.activate();
		const registered = await vscode.commands.getCommands(true);
		for (const gone of ['refreshAgents', 'refreshSessions', 'loadMoreSessions', 'copySessionId']) {
			assert.ok(!registered.includes(PREFIX + gone), `${PREFIX + gone} is still registered`);
		}
		assert.ok(!registered.includes(PREFIX + 'openSession'), 'past sessions are opened from the chat\'s History, not by a command');
		assert.strictEqual(pkg().contributes.viewsWelcome, undefined, 'a welcome text belongs to a tree, and there is none');
	});

	test('no setting decides permissions: the quick pick and autoApprovePermissions are gone, proposals are answered in the chat', () => {
		const props = pkg().contributes.configuration.properties;
		assert.strictEqual(props[PREFIX + 'autoApprovePermissions'], undefined, 'the setting is back');
		assert.ok(!Object.keys(props).some(k => /permission/i.test(k)), 'a permission setting is back');
	});

	test('one agent setting, no preset agents', () => {
		const props = pkg().contributes.configuration.properties;
		assert.ok(props[PREFIX + 'agent'], 'the one agent setting exists');
		assert.strictEqual(props[PREFIX + 'agents'], undefined, 'the agents map is gone');
		assert.deepStrictEqual(props[PREFIX + 'agent'].default, {});
		// sessions and history are keyed by a constant, so no editable label may name the agent
		assert.deepStrictEqual(Object.keys(props[PREFIX + 'agent'].properties).sort(), ['args', 'command', 'env']);
	});

	test('no telemetry dependency', () => {
		assert.strictEqual(pkg().dependencies['@vscode/extension-telemetry'], undefined);
	});

	test('no when clause or keybinding reads an acp. context key', () => {
		const c = pkg().contributes;
		const whens: string[] = [
			...Object.values(c.menus as Record<string, { when?: string }[]>).flat().map(m => m.when ?? ''),
			...(c.keybindings as { when?: string }[]).map(k => k.when ?? ''),
		];
		assert.deepStrictEqual(whens.filter(w => /\bacp\./.test(w)), []);
	});

	test('the built bundle carries no telemetry', () => {
		const bundle = fs.readFileSync(path.join(vscode.extensions.getExtension(ID)!.extensionPath, 'dist', 'extension.js'), 'utf8');
		for (const marker of ['InstrumentationKey', 'extension-telemetry', 'TelemetryReporter']) {
			assert.ok(!bundle.includes(marker), `bundle contains ${marker}`);
		}
	});

	test('the contract package is a runtime dependency for its recording format only: the bundle holds none of its replay, derive or promote machinery', () => {
		const p = pkg();
		assert.ok(p.dependencies['@jawata/acp-contract'], 'a runtime dependency');
		assert.strictEqual(p.devDependencies['@jawata/acp-contract'], undefined, 'no longer a development dependency');
		const recorder = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'utils', 'SessionRecorder.ts'), 'utf8');
		assert.match(recorder, /formatLine\(/, 'the recorder writes through the contract\'s format');
		assert.doesNotMatch(recorder.replace(/\/\/.*$/gm, ''), /JSON\.stringify/, 'and has no format of its own');
		const bundle = fs.readFileSync(path.join(vscode.extensions.getExtension(ID)!.extensionPath, 'dist', 'extension.js'), 'utf8');
		for (const marker of ['segmentsOf', 'promoteRecording', 'jawata-acp-replay']) {
			assert.ok(!bundle.includes(marker), `bundle contains ${marker}`);
		}
	});
	test('production keeps no test instrumentation: the list of ready places and the api are built for the editor tests only', () => {
		const source = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'extension.ts'), 'utf8');
		assert.strictEqual((source.match(/readyPlaces\.push/g) ?? []).length, 1, 'readyPlaces is written in one place');
		assert.match(source, /testMode \? place => \{ readyPlaces\.push\(place\); \} : undefined/, 'and only in test mode');
		assert.match(source, /return testMode \? \{ chat/, 'the api is handed out in test mode only');
	});
});
