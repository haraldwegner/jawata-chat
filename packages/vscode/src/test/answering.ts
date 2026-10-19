import * as fs from 'fs';
import type { ChatController } from '@jawata/chat-core';

/** The choices a recorded session's person made to the agent's permission requests, in order. */
export function recordedAnswers(sessionFile: string): string[] {
	return fs.readFileSync(sessionFile, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l))
		.filter(l => l.dir === 'send' && l.msg.result?.outcome?.optionId).map(l => l.msg.result.outcome.optionId as string);
}

/**
 * The person answering the chat's proposals, for a test: whenever one waits, answer it with the next of these choices
 * (the last again once they are used up). Call the result to stop.
 */
export function answerProposals(chat: ChatController, optionIds: string[]): () => void {
	let next = 0;
	const seenAt = new Map<string, number>();
	const timer = setInterval(() => {
		for (const proposal of chat.snapshot().proposals) {
			// a person takes a moment: what the agent sends right after its request arrives first, as it did in the recording
			const since = seenAt.get(proposal.requestId) ?? Date.now();
			seenAt.set(proposal.requestId, since);
			if (Date.now() - since < 300) { continue; }
			seenAt.delete(proposal.requestId);
			void chat.handle({ type: 'answerPermission', requestId: proposal.requestId, optionId: optionIds[Math.min(next++, optionIds.length - 1)] });
		}
	}, 50);
	return () => clearInterval(timer);
}
