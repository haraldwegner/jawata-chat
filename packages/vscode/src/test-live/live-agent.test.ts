import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import type { JawataChatApi } from '../extension';
import { answerProposals } from '../test/answering';

const DEFAULT_AGENT = { command: 'npx', args: ['-y', '@agentclientprotocol/claude-agent-acp@0.93.0'] };

/**
 * One real turn through the chat's own commands: the agent is set, connected, prompted, and its
 * recording opened with the Open Session Recording command and copied to JAWATA_LIVE_OUT.
 * A permission request, if the agent asks one, is answered by accepting the quick pick's first
 * option, as a person pressing Enter would.
 */
suite('Live agent turn', () => {
	test('one prompt is sent, answered and recorded', async () => {
		const out = process.env.JAWATA_LIVE_OUT;
		const prompt = process.env.JAWATA_LIVE_PROMPT;
		assert.ok(out && prompt, 'JAWATA_LIVE_OUT and JAWATA_LIVE_PROMPT are set');
		const agent = process.env.JAWATA_LIVE_AGENT ? JSON.parse(process.env.JAWATA_LIVE_AGENT) : DEFAULT_AGENT;

		const config = vscode.workspace.getConfiguration('jawataChat');
		await config.update('agent', agent, vscode.ConfigurationTarget.Global);
		await config.update('recordSessions', true, vscode.ConfigurationTarget.Global);
		await vscode.commands.executeCommand('jawataChat.openChat');
		await vscode.commands.executeCommand('jawataChat.connectAgent', 'agent');

		// the person accepts every proposal
		const stop = answerProposals((await vscode.extensions.getExtension<JawataChatApi | undefined>('jawata.jawata-chat')!.activate())!.chat, ['allow-once']);
		try {
			await vscode.commands.executeCommand('jawataChat.sendPrompt', prompt);
		} finally {
			stop();
		}

		await vscode.commands.executeCommand('jawataChat.openRecording');
		const recording = vscode.window.activeTextEditor?.document.uri.fsPath;
		assert.ok(recording && recording.endsWith('.jsonl'), `the recording opened: ${recording}`);
		fs.mkdirSync(out, { recursive: true });
		fs.copyFileSync(recording, path.join(out, path.basename(recording)));

		const lines = fs.readFileSync(recording, 'utf8').trimEnd().split('\n').map(l => JSON.parse(l));
		for (const l of lines) {
			assert.ok(l.dir === 'send' || l.dir === 'recv', 'every line has a direction');
			assert.ok(l.msg && typeof l.msg === 'object', 'every line has a message');
		}
		assert.ok(lines.some(l => l.dir === 'send' && l.msg.method === 'session/prompt'), 'the prompt was sent');
		assert.ok(lines.some(l => l.dir === 'recv' && l.msg.params?.update?.sessionUpdate === 'agent_message_chunk'), 'an answer streamed');
	});
});
