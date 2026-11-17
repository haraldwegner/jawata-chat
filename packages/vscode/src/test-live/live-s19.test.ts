import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import type { JawataChatApi } from '../extension';
import { answerProposals } from '../test/answering';

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

/**
 * 28h dogfood S19-1, S19-2 and S19-4 (2026-11-17), through the real route: the installed chat in an isolated VS Code, the bridge program
 * and the engine of the release his window used, Claude as the principal's brain. A first message, a pick of another model, a message that
 * uses a tool, a hire, Stop in the middle of a long answer and a message after the Stop must each end, and what the chat held is written
 * to JAWATA_LIVE_OUT. Not part of npm test: it needs a real agent.
 *   JAWATA_LIVE_AGENT  JSON {command, args, env} of the bridge, with the engine's address and key
 *   JAWATA_LIVE_OUT    the folder the notes are written to
 *   JAWATA_LIVE_SEATS  the folder of seat files the engine was started with
 *   JAWATA_LIVE_WORKSPACE the folder the agent works in
 */
suite('Live S19 turn, pick, tool, hire, stop', () => {
	test('every turn ends and the controls act', async function () {
		this.timeout(900000);
		const out = process.env.JAWATA_LIVE_OUT;
		const seats = process.env.JAWATA_LIVE_SEATS;
		const workspace = process.env.JAWATA_LIVE_WORKSPACE;
		assert.ok(out && seats && workspace && process.env.JAWATA_LIVE_AGENT, 'the live environment is set');
		fs.mkdirSync(out, { recursive: true });
		const notes: string[] = [];
		const note = (text: string) => { notes.push(`${new Date().toISOString().slice(11, 23)} ${text}`); fs.writeFileSync(path.join(out, 's19-notes.txt'), notes.join('\n') + '\n'); };

		const config = vscode.workspace.getConfiguration('jawataChat');
		await config.update('agent', JSON.parse(process.env.JAWATA_LIVE_AGENT!), vscode.ConfigurationTarget.Global);
		await vscode.commands.executeCommand('jawataChat.openChat');
		await vscode.commands.executeCommand('jawataChat.connectAgent', 'agent');
		const api = (await vscode.extensions.getExtension<JawataChatApi | undefined>('jawata.jawata-chat')!.activate())!;
		const chat = api.chat;
		const stopAnswering = answerProposals(chat, ['allow-once']);
		const row = () => (chat.snapshot().session?.configOptions as { id: string; currentValue?: string }[] | null | undefined)?.find(o => o.id === 'principal-brain')?.currentValue;
		const working = () => chat.snapshot().processing;
		const withinSeconds = async <T>(seconds: number, what: string, work: Promise<T>): Promise<T> => {
			return Promise.race([work, sleep(seconds * 1000).then(() => { throw new Error(`${what} did not end within ${seconds} s; the chat still says working: ${working()}`); })]);
		};
		const turn = async (label: string, text: string, seconds = 150) => {
			const started = Date.now();
			await withinSeconds(seconds, label, Promise.resolve(vscode.commands.executeCommand('jawataChat.sendPrompt', text)));
			note(`${label}: ended after ${((Date.now() - started) / 1000).toFixed(1)} s; the chat says working: ${working()}`);
			assert.strictEqual(working(), false, `${label}: the chat still says working after its turn ended`);
		};

		try {
			note(`row at connect: ${row()}`);
			await turn('first message', 'Say only: ok');
			await chat.handle({ type: 'setConfigOption', configId: 'principal-brain', value: 'claude-code|sonnet' });
			await sleep(1500);
			note(`row after the pick of sonnet: ${row()}`);
			await turn('tool message', 'Which model are you? Then run the shell command `ls` in your working directory with your shell tool and say how many entries it printed.');
			note(`row after the tool message: ${row()}`);

			await turn('hire message', `Call your hire tool exactly once with: hirer main, seat architect, seatFile ${seats}/architect.md, workingDirectory ${workspace}, brief 'Write a 600-line design essay about a library for parsing dates, no tools, no code, just prose.', steps [{tool: health_check, arguments: {}}]. Then say in one line that it started and end your turn.`);
			await turn('a message while the hire runs', 'Say only: ok');

			const long = Promise.resolve(vscode.commands.executeCommand('jawataChat.sendPrompt', 'Write the numbers from 1 to 600, each on its own line, with a one-sentence remark after every tenth number. Do not use any tool.'));
			for (let waited = 0; waited < 30000 && !working(); waited += 200) { await sleep(200); }
			assert.ok(working(), 'the long turn never showed as working');
			await sleep(8000);
			const stopped = Date.now();
			await vscode.commands.executeCommand('jawataChat.cancelTurn');
			await withinSeconds(30, 'the turn after Stop', long);
			note(`Stop: the turn ended ${((Date.now() - stopped) / 1000).toFixed(1)} s after the cancel; the chat says working: ${working()}`);
			assert.strictEqual(working(), false, 'the chat still says working after Stop');

			await turn('a message after Stop', 'Say only: ok');
		} finally {
			stopAnswering();
			note('done');
		}
	});
});
