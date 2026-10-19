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

	test('the contract package is a test-time dependency only, and not in the bundle', () => {
		const p = pkg();
		assert.strictEqual(p.dependencies['@jawata/acp-contract'], undefined, 'not a runtime dependency');
		assert.ok(p.devDependencies['@jawata/acp-contract'], 'a development dependency');
		const bundle = fs.readFileSync(path.join(vscode.extensions.getExtension(ID)!.extensionPath, 'dist', 'extension.js'), 'utf8');
		for (const marker of ['segmentsOf', 'promoteRecording', 'jawata-acp-replay']) {
			assert.ok(!bundle.includes(marker), `bundle contains ${marker}`);
		}
	});
});
