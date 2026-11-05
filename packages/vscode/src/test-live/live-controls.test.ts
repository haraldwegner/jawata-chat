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

		await chat.handle({ type: 'chooseBrain', planId: hire.planId, brain: brains[0].brain, model: brains[0].model });
		found.afterChoice = await waitFor('the hire after the choice', () => chat.snapshot().hires.find(h => h.planId === hire.planId && h.brain === brains[0].brain));

		const options = chat.snapshot().session?.configOptions ?? [];
		const seatOption = options.find(o => o.id === `seat-model:${seat}`);
		found.seatOptionBefore = seatOption;
		assert.ok(seatOption, `the session offers a seat-model option for ${seat}`);
		await chat.handle({ type: 'setConfigOption', configId: seatOption.id, value: brains[0].brain });
		found.seatOptionAfter = await waitFor('the seat option changed', () => chat.snapshot().session?.configOptions?.find(o => o.id === seatOption.id && o.currentValue === brains[0].brain));
		await chat.handle({ type: 'setConfigOption', configId: seatOption.id, value: 'seat-file' });

		await chat.handle({ type: 'askSide', text: 'Reply with exactly the one word: side' });
		found.side = await waitFor('the side answer', () => { const s = chat.snapshot().side; return s && s.entries.length > 0 && !s.processing ? s : null; }, 120000);

		fs.mkdirSync(out, { recursive: true });
		fs.writeFileSync(path.join(out, 'controls.json'), JSON.stringify(found, null, 2));
	});
});
