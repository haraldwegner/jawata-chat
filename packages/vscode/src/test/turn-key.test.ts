import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import type * as vscode from 'vscode';
import type { ViewMessage } from '@jawata/chat-core';
import { WebviewViewPort } from '../ui/ViewPort';

/**
 * The Escape key and the cancel button read `jawataChat.turnInProgress`. The chat says when a turn starts and ends (chat-core's
 * turn-report test holds when); the extension's root subscribes once, and the page port only passes messages on (ledger 28i-C13-6).
 */
suite('The turn-in-progress key', () => {
	test('the extension sets the key from the chat\'s own report, once at its root', () => {
		const source = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'extension.ts'), 'utf8');
		assert.match(source, /chat\.onTurnChanged\(on => \{ void vscode\.commands\.executeCommand\('setContext', 'jawataChat\.turnInProgress', on\); \}\)/);
		assert.strictEqual((source.match(/jawataChat\.turnInProgress/g) ?? []).length, 1, 'one place sets the key');
	});

	test('the page port posts messages as they are and folds nothing', () => {
		const posted: unknown[] = [];
		const view = { webview: { postMessage: (m: unknown) => { posted.push(m); return Promise.resolve(true); } } } as unknown as vscode.WebviewView;
		const port = new WebviewViewPort(view);
		const messages: ViewMessage[] = [{ type: 'promptStart' }, { type: 'userPrompt', text: 'x' }, { type: 'promptEnd', stopReason: 'end_turn' }];
		for (const m of messages) { port.post(m); }
		assert.deepStrictEqual(posted, messages);
		assert.strictEqual((port as unknown as { turnChanged?: unknown }).turnChanged, undefined);
	});
});
