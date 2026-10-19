import * as assert from 'assert';
import * as vscode from 'vscode';
import type { JawataChatApi } from '../extension';
import { answerProposals, recordedAnswers } from './answering';

/**
 * The extension against the contract's replay agent: for each recorded session, the chat
 * connects, plays it, and its own recording (the traffic tap's) has the session's shape as the
 * contract defines it (shapeOf: directions, methods, update kinds and the fields the contract
 * names, including the key sets of the extension's own requests). Both files are read through the
 * contract package's one reader.
 */
suite('Replay sessions', function () {
	this.timeout(60000);
	// a true dynamic import: the contract package is ESM and this test is compiled to CommonJS
	const importEsm = new Function('p', 'return import(p)') as (p: string) => Promise<any>;
	const contract = () => importEsm(vscode.Uri.file(require.resolve('@jawata/acp-contract')).toString());
	const node = process.env.npm_node_execpath || 'node';
	const api = async () => (await vscode.extensions.getExtension<JawataChatApi | undefined>('jawata.jawata-chat')!.activate())!;

	async function play(name: string, prompt: boolean): Promise<void> {
		const { readSession, shapeOf } = await contract();
		const sessionFile = require.resolve(`@jawata/acp-contract/sessions/${name}.jsonl`);
		await vscode.commands.executeCommand('jawataChat.disconnectAgent');
		const config = vscode.workspace.getConfiguration('jawataChat');
		await config.update('agent', { command: node, args: [require.resolve('@jawata/acp-contract/replay'), sessionFile] }, vscode.ConfigurationTarget.Global);
		await config.update('recordSessions', true, vscode.ConfigurationTarget.Global);
		await vscode.commands.executeCommand('jawataChat.openChat');
		await vscode.commands.executeCommand('jawataChat.connectAgent', 'agent');
		if (prompt) {
			// the person answers the proposals as the recording says they did
			const stop = answerProposals((await api()).chat, recordedAnswers(sessionFile));
			try { await vscode.commands.executeCommand('jawataChat.sendPrompt', 'replay'); } finally { stop(); }
		}
		await new Promise(r => setTimeout(r, 500));
		await vscode.commands.executeCommand('jawataChat.openRecording');
		const recording = vscode.window.activeTextEditor!.document.uri.fsPath;
		// the agent's messages and the client's other requests keep their order exactly; the person's answers are an ordered
		// list of their own: where an answer falls among the agent's messages is the person's timing, not the extension's
		const apart = (shape: string[]) => ({ rest: shape.filter(l => !l.startsWith('send response')), answers: shape.filter(l => l.startsWith('send response')) });
		assert.deepStrictEqual(apart(shapeOf(readSession(recording))), apart(shapeOf(readSession(sessionFile))));
	}

	test('R1: prompt and streamed answer', () => play('R1', true));
	test('R2: tool call and its permission request', () => play('R2', true));
	test('R3: the grouped command list', () => play('R3', true));
	test('R9: a thought before the answer (derived, shape only)', () => play('R9', true));
	test('R10: a plan update during the turn (derived, shape only)', () => play('R10', true));
});
