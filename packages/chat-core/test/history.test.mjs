// History in the chat (R6: `session/list`, then `session/load` replaying an earlier turn; real Claude): the agent's own list, and a past
// session loaded into the chat. The chat keeps no list of its own.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { initialViewState, reduce } from '../dist/view-state.js';
import { chatOn, sessionFile } from './play.mjs';
import { RecordingPort } from '../dist/test-support.js';

const recorded = readFileSync(sessionFile('R6'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
const listed = recorded.find(l => l.dir === 'recv' && l.msg.result?.sessions).msg.result.sessions;
const loadedId = recorded.find(l => l.msg.method === 'session/load').msg.params.sessionId;

test('R6: the page asks, and is told the sessions the agent lists, with their titles; the state holds the agent\'s list', async () => {
  const c = chatOn('R6');
  try {
    await c.port.deliver({ type: 'listSessions' });
    const [list] = c.port.toView.filter(m => m.type === 'sessionList');
    assert.deepEqual(list.sessions.map(s => s.sessionId), listed.map(s => s.sessionId));
    assert.equal(list.sessions[0].title, 'Pong');
    assert.equal(list.append, false);
    assert.deepEqual(c.chat.snapshot().history.sessions.map(s => s.sessionId), listed.map(s => s.sessionId), 'a late page is given it');
  } finally { c.dispose(); }
});

test('R6: a listed session opens: its turns arrive as the agent replays them, between a load start and a load end', async () => {
  const c = chatOn('R6');
  try {
    await c.port.deliver({ type: 'listSessions' });
    const id = c.chat.snapshot().history.sessions[0].sessionId;
    assert.equal(id, loadedId);
    await c.port.deliver({ type: 'openSession', sessionId: id });
    for (let i = 0; i < 100 && !c.port.toView.some(m => m.type === 'loadSessionEnd'); i++) { await new Promise(r => setTimeout(r, 20)); }
    const types = c.port.toView.map(m => m.type);
    assert.ok(types.indexOf('loadSessionStart') < types.indexOf('loadSessionEnd'), types.join(','));
    assert.equal(c.sessions.getActiveSessionId(), id);
    assert.ok(c.chat.snapshot().entries.some(e => e.kind === 'user') && c.chat.snapshot().entries.some(e => e.kind === 'turn'), 'the replayed turns are in the chat');
    // the replay is folded in one pass and told once: no message per update between the load's start and its end, one snapshot with the turns
    const between = types.slice(types.indexOf('loadSessionStart') + 1, types.indexOf('loadSessionEnd'));
    assert.deepEqual(between, ['snapshot'], 'what the page was told while the session loaded');
    const [told] = c.port.toView.filter(m => m.type === 'snapshot');
    assert.ok(told.state.entries.some(e => e.kind === 'turn'), 'and the snapshot holds the replayed turns');
  } finally { c.dispose(); }
});

test('a page of the list is appended to the one before it, or replaces it; a failure is told to the person', async () => {
  const one = { type: 'sessionList', sessions: [{ sessionId: 'a' }], nextCursor: 'c1', append: false };
  const two = { type: 'sessionList', sessions: [{ sessionId: 'b' }], nextCursor: null, append: true };
  const s = [one, two].reduce(reduce, initialViewState());
  assert.deepEqual(s.history, { sessions: [{ sessionId: 'a' }, { sessionId: 'b' }], nextCursor: null });
  const c = chatOn('R1'); // R1's agent answers no session/list
  try {
    await c.port.deliver({ type: 'listSessions' });
    assert.ok(c.port.toView.some(m => m.type === 'error' && /Could not list the sessions/.test(m.message)));
  } finally { c.dispose(); }
});

test('showHistory: asked before the page has said ready, the list waits and is shown when it does', async () => {
  const c = chatOn('R6');
  try {
    await c.chat.showHistory();
    assert.deepEqual(c.port.toView.filter(m => m.type === 'sessionList'), [], 'no page has said ready: nothing is told yet');
    await c.port.deliver({ type: 'ready' });
    const lists = c.port.toView.filter(m => m.type === 'sessionList');
    assert.equal(lists.length, 1, 'the list comes with ready');
    assert.equal(lists[0].show, true, 'and asks to be shown');
  } finally { c.dispose(); }
});

test('showHistory: asked after the page said ready, the list is told at once and asks to be shown; the page\'s own request does not', async () => {
  const c = chatOn('R6');
  try {
    await c.port.deliver({ type: 'ready' });
    c.port.toView.length = 0;
    await c.chat.showHistory();
    const lists = c.port.toView.filter(m => m.type === 'sessionList');
    assert.equal(lists.length, 1, 'a page that is ready is told at once');
    assert.equal(lists[0].show, true);
  } finally { c.dispose(); }
});

test('the page\'s own listSessions request is not a request to show the list', async () => {
  const c = chatOn('R6');
  try {
    await c.port.deliver({ type: 'listSessions' });
    assert.equal(c.port.toView.filter(m => m.type === 'sessionList')[0].show, undefined);
  } finally { c.dispose(); }
});

/** A page that can go away, as a webview that is closed does. */
class ClosablePort extends RecordingPort {
  closers = [];
  onDispose(handler) { this.closers.push(handler); return { dispose: () => { /* kept */ } }; }
  close() { this.closers.forEach(h => h()); }
}
/** A chat whose test port is let go of, so that pages are the ones that serve. */
const chatWithPages = () => { const c = chatOn('R6'); c.chat.attach(new RecordingPort()).dispose(); return c; };

test('showHistory: a request that waits for a page is forgotten when that page goes away; a later page is not shown the list unasked (ledger 28i-C21-7)', async () => {
  const c = chatWithPages();
  try {
    const first = new ClosablePort();
    c.chat.attachPage(first);
    await c.chat.showHistory();
    first.close();
    const later = new ClosablePort();
    c.chat.attachPage(later);
    await later.deliver({ type: 'ready' });
    assert.deepEqual(later.toView.filter(m => m.type === 'sessionList'), [], 'the page that came later asked for nothing');
  } finally { c.dispose(); }
});

test('showHistory: a request that waits for a page is forgotten when the page is let go of', async () => {
  const c = chatWithPages();
  try {
    const first = new ClosablePort();
    const handle = c.chat.attachPage(first);
    await c.chat.showHistory();
    handle.dispose();
    const later = new ClosablePort();
    c.chat.attachPage(later);
    await later.deliver({ type: 'ready' });
    assert.deepEqual(later.toView.filter(m => m.type === 'sessionList'), [], 'the page that came later asked for nothing');
  } finally { c.dispose(); }
});

test('showHistory: asked with no page at all, the next page to say ready shows the list: the command opening the chat', async () => {
  const c = chatWithPages();
  try {
    await c.chat.showHistory();
    const later = new ClosablePort();
    c.chat.attachPage(later);
    await later.deliver({ type: 'ready' });
    assert.equal(later.toView.filter(m => m.type === 'sessionList').length, 1);
  } finally { c.dispose(); }
});
