import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import type { JawataChatApi } from '../extension';

/**
 * Sprint 28h S17, rows R4, R5, R12 and R13 against a real agent: after one real turn in which the agent hires a seat, the chat's own controls
 * are used the way a person uses them (open the hire's transcript, list the brains, choose a brain for the hire, set a seat's model option,
 * ask a side question) and what the chat then holds is written to JAWATA_LIVE_OUT/controls.json. The prompt and the agent come from the same
 * variables as the one-turn live test; JAWATA_LIVE_SEAT names the seat the prompt makes the agent hire.
 */
suite('Live agent controls', () => {
	test('transcript, brains, brain choice, seat model and side question', async function () {
		this.timeout(400000);
		const out = process.env.JAWATA_LIVE_OUT;
		const prompt = process.env.JAWATA_LIVE_PROMPT;
		const seat = process.env.JAWATA_LIVE_SEAT;
		assert.ok(out && prompt && seat && process.env.JAWATA_LIVE_AGENT, 'JAWATA_LIVE_OUT, _PROMPT, _SEAT and _AGENT are set');
		const config = vscode.workspace.getConfiguration('jawataChat');
		await config.update('agent', JSON.parse(process.env.JAWATA_LIVE_AGENT), vscode.ConfigurationTarget.Global);
		await config.update('recordSessions', true, vscode.ConfigurationTarget.Global);
		await vscode.commands.executeCommand('jawataChat.openChat');
		await vscode.commands.executeCommand('jawataChat.connectAgent', 'agent');
		const chat = (await vscode.extensions.getExtension<JawataChatApi | undefined>('jawata.jawata-chat')!.activate())!.chat;
		const waitFor = async <T>(what: string, read: () => T | null | undefined | false, ms = 30000): Promise<T> => {
			const until = Date.now() + ms;
			for (;;) {
				const value = read();
				if (value) { return value; }
				assert.ok(Date.now() < until, `timed out waiting for ${what}`);
				await new Promise(r => setTimeout(r, 100));
			}
		};
		const found: Record<string, unknown> = {};

		await vscode.commands.executeCommand('jawataChat.sendPrompt', prompt);
		const hire = await waitFor('a finished hire of the seat in the chat', () => chat.snapshot().hires.find(h => h.seat === seat && (h.state === 'done' || h.state === 'failed')), 120000);
		found.hire = hire;

		await chat.handle({ type: 'openTranscript', planId: hire.planId });
		found.transcript = await waitFor('the hire transcript', () => chat.snapshot().transcripts[hire.planId]);

		await chat.handle({ type: 'listBrains' });
		const brains = await waitFor('the brains', () => chat.snapshot().brains);
		found.brains = brains;
		assert.ok(brains.length > 0, 'the agent offers at least one brain');

		// a brain other than the one the hire ran on, so the change is visible in the hire the agent answers with
		const other = brains.find(b => b.brain !== hire.brain) ?? brains[0];
		found.brainChosen = other;
		await chat.handle({ type: 'chooseBrain', planId: hire.planId, brain: other.brain, model: other.model });
		found.afterChoice = await waitFor('the hire after the choice', () => chat.snapshot().hires.find(h => h.planId === hire.planId && h.brain === other.brain));
		assert.notStrictEqual(other.brain, hire.brain, 'the registry offers a second brain, so the choice shows');

		const options = chat.snapshot().session?.configOptions ?? [];
		found.perSeatOptions = options.filter(o => o.id.startsWith('seat-model:')).length;
		assert.strictEqual(found.perSeatOptions, 0, 'no selector per seat is offered any more');
		found.principalBrain = options.find(o => o.id === 'principal-brain');
		assert.ok(found.principalBrain, 'the session offers the principal brain option');

		// the arm switch of plan-execution mode (CR1): the select option `autonomy`, set on and off by the person's channel
		found.autonomyBefore = chat.snapshot().session?.configOptions?.find(o => o.id === 'autonomy');
		assert.ok(found.autonomyBefore, 'the session offers the autonomy option');
		await chat.handle({ type: 'setConfigOption', configId: 'autonomy', value: 'on' });
		found.autonomyOn = await waitFor('autonomy on', () => chat.snapshot().session?.configOptions?.find(o => o.id === 'autonomy' && o.currentValue === 'on'));
		await chat.handle({ type: 'setConfigOption', configId: 'autonomy', value: 'off' });
		found.autonomyOff = await waitFor('autonomy off', () => chat.snapshot().session?.configOptions?.find(o => o.id === 'autonomy' && o.currentValue === 'off'));

		// the agent's list of its sessions (R6): this conversation is among them
		await chat.handle({ type: 'listSessions' });
		const history = await waitFor('the session list', () => chat.snapshot().history);
		found.history = { count: history.sessions.length, first: history.sessions[0] };
		assert.ok(history.sessions.length > 0, 'the agent lists the conversation it holds');

		await chat.handle({ type: 'askSide', text: 'Reply with exactly the one word: side' });
		found.side = await waitFor('the side answer', () => { const s = chat.snapshot().side; return s && s.entries.length > 0 && !s.processing ? s : null; }, 120000);

		fs.mkdirSync(out, { recursive: true });
		fs.writeFileSync(path.join(out, 'controls.json'), JSON.stringify(found, null, 2));
	});
});
