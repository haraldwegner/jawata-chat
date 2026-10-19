import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import type { JawataChatApi } from '../extension';
import { RecordingPort, answerProposals, goldenBody } from '@jawata/chat-core/test-support';
import { recordedAnswers } from './answering';

/**
 * What the chat tells its page, for each recorded session, against the goldens that chat-core owns.
 * The page is a port that records instead of drawing: the real controller, wired as in production, posts
 * through it. chat-core's own tests play the same sessions on an in-memory host against the same files,
 * so a difference between the real host and the fake shows as a red test on one side. The goldens are
 * regenerated from chat-core (JAWATA_UPDATE_GOLDENS=1 npm test there), never here.
 */
suite('View goldens', function () {
	this.timeout(60000);
	const node = process.env.npm_node_execpath || 'node';
	
	async function api(): Promise<JawataChatApi> {
		return (await vscode.extensions.getExtension<JawataChatApi | undefined>('jawata.jawata-chat')!.activate())!;
	}
	async function chatView(): Promise<JawataChatApi['chat']> { return (await api()).chat; }

	async function played(name: string): Promise<unknown[]> {
		await vscode.commands.executeCommand('jawataChat.disconnectAgent');
		const port = new RecordingPort();
		(await chatView()).attach(port);
		const config = vscode.workspace.getConfiguration('jawataChat');
		await config.update('agent', { command: node, args: [require.resolve('@jawata/acp-contract/replay'), require.resolve(`@jawata/acp-contract/sessions/${name}.jsonl`)] }, vscode.ConfigurationTarget.Global);
		await vscode.commands.executeCommand('jawataChat.connectAgent', 'agent');
		// the person answers the proposals as the recording says they did
		answerProposals(await chatView(), port, recordedAnswers(require.resolve(`@jawata/acp-contract/sessions/${name}.jsonl`)));
		await vscode.commands.executeCommand('jawataChat.sendPrompt', 'replay');
		await new Promise(r => setTimeout(r, 200));
		return port.toView;
	}

	async function checkGolden(name: string): Promise<void> {
		compareToGolden(name, await played(name));
	}

	function compareToGolden(name: string, actual: unknown[]): void {
		const golden = JSON.parse(fs.readFileSync(require.resolve(`@jawata/chat-core/goldens/view-${name}.json`), 'utf8'));
		assert.deepStrictEqual(goldenBody(actual), golden);
		assert.ok(actual.length > 0, 'the page was told something');
	}

	test('R6: the page is told a loaded session replayed, between its load start and its load end', async () => {
		// opening a session focuses the chat view, and VS Code resolves a view the first time it is focused;
		// the view's own port is attached only if no port is, so ours is not replaced either way
		await vscode.commands.executeCommand('jawata-chat-view.focus');
		await new Promise(r => setTimeout(r, 500));
		const port = new RecordingPort();
		const view = await chatView();
		view.clearChat(); // an earlier test left chat content, and opening a session would ask before replacing it
		await vscode.commands.executeCommand('jawataChat.disconnectAgent');
		view.attach(port);
		const sessionFile = require.resolve('@jawata/acp-contract/sessions/R6.jsonl');
		const sessionId = fs.readFileSync(sessionFile, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)).find(l => l.msg.method === 'session/load').msg.params.sessionId;
		const config = vscode.workspace.getConfiguration('jawataChat');
		await config.update('agent', { command: node, args: [require.resolve('@jawata/acp-contract/replay'), sessionFile] }, vscode.ConfigurationTarget.Global);
		// the tree lists first, which also learns what the agent can do; opening a session needs that
		await (await api()).sessionManager.listSessions('agent');
		await view.handle({ type: 'openSession', sessionId });
		// the replay finishes when it finishes: wait for the end of the load, not for a time
		for (let i = 0; i < 100 && !port.toView.some((m: any) => m.type === 'loadSessionEnd'); i++) { await new Promise(r => setTimeout(r, 100)); }
		await new Promise(r => setTimeout(r, 200));
		const actual = port.toView;
		const types = actual.map((m: any) => m.type);
		assert.ok(types.indexOf('loadSessionStart') !== -1 && types.indexOf('loadSessionEnd') > types.indexOf('loadSessionStart'), `load start and end: ${types.join(',')}`);
		compareToGolden('R6', actual);
	});

	test('a page that says ready is told the state', async () => {
		const port = new RecordingPort();
		(await chatView()).attach(port);
		await port.deliver({ type: 'ready' });
		assert.ok(port.toView.some((m: any) => m.type === 'state'), 'a state message');
	});

	test('attaching a file tells the page and brings it into view', async () => {
		const port = new RecordingPort();
		const view = await chatView();
		view.attach(port);
		view.attachFile(path.join('x', 'notes.txt'));
		assert.deepStrictEqual(port.toView.map((m: any) => [m.type, m.name]), [['file-attached', 'notes.txt']]);
		assert.strictEqual(port.revealed, 1);
	});

	test('a prompt sent with the sendPrompt command reaches the page as the page\'s own send does', async () => {
		const sentBy = async (how: (port: RecordingPort) => Promise<void>): Promise<unknown> => {
			await vscode.commands.executeCommand('jawataChat.disconnectAgent');
			const port = new RecordingPort();
			(await chatView()).attach(port);
			const config = vscode.workspace.getConfiguration('jawataChat');
			await config.update('agent', { command: node, args: [require.resolve('@jawata/acp-contract/replay'), require.resolve('@jawata/acp-contract/sessions/R1.jsonl')] }, vscode.ConfigurationTarget.Global);
			await vscode.commands.executeCommand('jawataChat.connectAgent', 'agent');
			await how(port);
			await new Promise(r => setTimeout(r, 200));
			return goldenBody(port.toView);
		};
		const byCommand = await sentBy(async () => { await vscode.commands.executeCommand('jawataChat.sendPrompt', 'x'); });
		const byPage = await sentBy(async port => { await port.deliver({ type: 'sendPrompt', text: 'x' }); });
		assert.deepStrictEqual(byCommand, byPage);
		assert.ok(JSON.stringify(byCommand).includes('promptStart'), 'the turn began on the page');
	});

	test('R1: the page is told a prompt and a streamed answer', () => checkGolden('R1'));
	test('R2: the page is told a tool call and its outcome', () => checkGolden('R2'));
	test('R3: the page is told the grouped command list', () => checkGolden('R3'));
	test('R7: the page is told two proposals, one allowed and one failed', () => checkGolden('R7'));
});
