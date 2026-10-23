import * as assert from 'assert';
import type * as vscode from 'vscode';
import type { ViewMessage } from '@jawata/chat-core';
import { WebviewViewPort } from '../ui/ViewPort';

/**
 * The Escape key and the cancel button read `jawataChat.turnInProgress`. The core says when a turn starts and ends (chat-core's
 * turn-report test holds when it says so); the page port passes that on and no longer folds the messages itself (ledger 28i-C13-6).
 */
suite('The turn-in-progress key', () => {
	function port(): { port: WebviewViewPort; announced: boolean[]; posted: unknown[] } {
		const posted: unknown[] = [];
		const announced: boolean[] = [];
		const view = { webview: { postMessage: (m: unknown) => { posted.push(m); return Promise.resolve(true); } } } as unknown as vscode.WebviewView;
		return { port: new WebviewViewPort(view, on => announced.push(on)), announced, posted };
	}

	test('what the core reports about the turn is what the key is set to', () => {
		const p = port();
		p.port.turnChanged(true);
		p.port.turnChanged(false);
		assert.deepStrictEqual(p.announced, [true, false]);
	});

	test('messages are posted as they are and set nothing: the port does not fold the stream', () => {
		const p = port();
		const messages: ViewMessage[] = [{ type: 'promptStart' }, { type: 'userPrompt', text: 'x' }, { type: 'promptEnd', stopReason: 'end_turn' }];
		for (const m of messages) { p.port.post(m); }
		assert.deepStrictEqual(p.announced, []);
		assert.deepStrictEqual(p.posted, messages);
	});
});
