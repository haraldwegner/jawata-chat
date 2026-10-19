import * as assert from 'assert';
import type * as vscode from 'vscode';
import { VIEW_CONTRACT_VERSION, type ViewMessage } from '@jawata/chat-core';
import { WebviewViewPort } from '../ui/ViewPort';

/** The Escape key and the cancel button read `jawataChat.turnInProgress`; the page port is what sets it. */
suite('The turn-in-progress key', () => {
	const session = { sessionId: 's', agentName: 'A', title: null, cwd: '/w', modes: null, models: null, configOptions: null, availableCommands: [] };
	const state = (withSession: boolean): ViewMessage => ({ type: 'state', contractVersion: VIEW_CONTRACT_VERSION, activeSessionId: withSession ? 's' : null, session: withSession ? session : null });

	/** The announcements a port makes for these messages, and how many it posted. */
	function announcedFor(...messages: ViewMessage[]): { announced: boolean[]; posted: number } {
		const posted: unknown[] = [];
		const announced: boolean[] = [];
		const view = { webview: { postMessage: (m: unknown) => { posted.push(m); return Promise.resolve(true); } } } as unknown as vscode.WebviewView;
		const port = new WebviewViewPort(view, on => announced.push(on));
		for (const m of messages) { port.post(m); }
		return { announced, posted: posted.length };
	}

	test('a turn starting sets it and the turn ending unsets it, once each, and every message is still posted', () => {
		const r = announcedFor(state(true), { type: 'promptStart' }, { type: 'userPrompt', text: 'x' }, { type: 'promptStart' }, { type: 'promptEnd', stopReason: 'end_turn' });
		assert.deepStrictEqual(r.announced, [true, false]);
		assert.strictEqual(r.posted, 5);
	});

	test('a load starting, a clear, or the end of the session unsets it while a turn is running', () => {
		for (const m of [{ type: 'loadSessionStart' }, { type: 'clearChat' }, state(false)] as ViewMessage[]) {
			assert.deepStrictEqual(announcedFor(state(true), { type: 'promptStart' }, m).announced, [true, false], m.type);
		}
	});

	test('messages that change nothing about the turn announce nothing', () => {
		assert.deepStrictEqual(announcedFor(state(true), { type: 'userPrompt', text: 'x' }, { type: 'promptEnd', stopReason: 'end_turn' }).announced, []);
	});

	test('a message of another version of the contract changes nothing', () => {
		assert.deepStrictEqual(announcedFor({ type: 'state', contractVersion: 1, activeSessionId: 's', session }, { type: 'promptStart' }).announced, []);
	});
});
