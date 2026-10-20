import * as assert from 'assert';
import type { ChatController } from '@jawata/chat-core';
import { RecordingPort, chatWith } from '@jawata/chat-core/test-support';
import type { PageHost } from '../ui/chatPage';
import { PageSwitch } from '../ui/PageSwitch';

/** One page at a time: a page that mounts takes the chat from the page of another place, and the old page is told nothing more. */
suite('Switching the place of the chat', () => {
	/** A page in a place: what it was told, and a way to make it say something. */
	function page() {
		const told: unknown[] = [];
		let heard: ((m: unknown) => void) | undefined;
		const gone: (() => void)[] = [];
		const shown: (() => void)[] = [];
		const host: PageHost = {
			webview: {
				postMessage: (m: unknown) => { told.push(m); return Promise.resolve(true); },
				onDidReceiveMessage: (h: (m: unknown) => void) => { heard = h; return { dispose() { heard = undefined; } }; },
			} as unknown as PageHost['webview'],
			onDidDispose: ((h: () => void) => { gone.push(h); return { dispose() { /* none */ } }; }) as PageHost['onDidDispose'],
			onDidShow: (h: () => void) => { shown.push(h); return { dispose() { /* none */ } }; },
		};
		return { host, told, say: (m: unknown) => heard?.(m), close: () => gone.forEach(h => h()), show: () => shown.forEach(h => h()) };
	}
	const chatOf = () => {
		const c = chatWith(() => undefined, new RecordingPort());
		c.chat.attach({ post() { /* none */ }, onMessage: () => ({ dispose() { /* none */ } }), onDispose: () => ({ dispose() { /* none */ } }) }).dispose(); // no port attached: the pages are the ones that serve
		return c;
	};

	test('the second place takes over: the chat tells it, and the first hears nothing more', () => {
		const c = chatOf();
		try {
			const ready: string[] = [];
			const pages = new PageSwitch(c.chat as ChatController, place => ready.push(place));
			const left = page(), right = page();
			pages.mount('left', left.host);
			c.chat.clearChat();
			assert.ok(left.told.length > 0, 'the first page is told');
			pages.mount('right', right.host);
			const leftHeard = left.told.length;
			c.chat.clearChat();
			assert.ok(right.told.length > 0, 'the second page is told');
			assert.strictEqual(left.told.length, leftHeard, 'the first page is told nothing more');
			right.say({ type: 'ready' });
			assert.deepStrictEqual(ready, ['right'], 'a page says ready under its own place');
		} finally { c.dispose(); }
	});

	test('a page that was closed leaves the chat free for the next one to mount, which is served again', () => {
		const c = chatOf();
		try {
			const pages = new PageSwitch(c.chat as ChatController, () => undefined);
			const first = page(), second = page();
			pages.mount('bottom', first.host);
			first.close();
			pages.mount('bottom', second.host);
			c.chat.clearChat();
			assert.ok(second.told.length > 0, 'the page that mounted after is served');
		} finally { c.dispose(); }
	});
	test('a page shown again takes the chat back and is given its state; the page that had it hears nothing more', async () => {
		const c = chatOf();
		try {
			const pages = new PageSwitch(c.chat as ChatController, () => undefined);
			const left = page(), right = page();
			pages.mount('left', left.host);
			pages.mount('right', right.host);
			const leftBefore = left.told.length, rightBefore = right.told.length;
			left.show(); // the person chose the left place again
			for (let i = 0; i < 50 && left.told.length === leftBefore; i++) { await new Promise(r => setTimeout(r, 20)); }
			assert.deepStrictEqual(left.told.slice(leftBefore).map(m => (m as { type: string }).type), ['state', 'snapshot'], 'the page is given the state and the snapshot');
			c.chat.clearChat();
			assert.ok(left.told.length > leftBefore + 2, 'and is served from then on');
			assert.strictEqual(right.told.length, rightBefore, 'the page that had the chat hears nothing more');
			right.show();
			await new Promise(r => setTimeout(r, 100));
			assert.ok(right.told.length > rightBefore, 'and shown again it takes the chat back');
		} finally { c.dispose(); }
	});
	test('a page shown while a port that is not a page has the chat does not take it, and a page that has the chat is not seated again when shown', async () => {
		const c = chatOf();
		try {
			const pages = new PageSwitch(c.chat as ChatController, () => undefined);
			const left = page();
			pages.mount('left', left.host);
			const holder = left.told.length;
			left.show(); // shown while it already holds the chat: nothing is sent
			await new Promise(r => setTimeout(r, 100));
			assert.strictEqual(left.told.length, holder, 'a page that has the chat is not given the state again');
			const test = new RecordingPort();
			c.chat.attach(test); // a port that is not a page takes the chat
			const right = page();
			pages.mount('right', right.host);
			right.show();
			await new Promise(r => setTimeout(r, 100));
			c.chat.clearChat();
			assert.ok(test.toView.length > 0, 'the port that is not a page is served');
			assert.strictEqual(right.told.length, 0, 'the page did not take the chat from it');
		} finally { c.dispose(); }
	});
});
