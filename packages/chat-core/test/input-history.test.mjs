// 28h S25 (D56 (g)): what the person typed in the chat is kept, newest first, in the store the host gives, so the page's arrows can bring it
// back in a later conversation and after the editor restarts. It is the person's own input; the agent's past sessions are another thing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { replayAgent, readSession } from '@jawata/acp-contract';
import { chatWith } from '../dist/test-support.js';
import { initialViewState, reduce } from '../dist/view-state.js';
import { READY_INTENT, VIEW_CONTRACT_VERSION } from '../dist/view.js';
import { sessionFile } from './play.mjs';

/** A store in memory, as a host's would be on disk: what was saved last is what a later chat loads. */
function memoryStore(entries = [], { loadAfterMs = 0, failLoad = false } = {}) {
  const store = {
    saved: [...entries],
    saves: 0,
    load: () => new Promise((resolve, reject) => setTimeout(() => (failLoad ? reject(new Error('unreadable')) : resolve([...store.saved])), loadAfterMs)),
    save: (next) => { store.saved = [...next]; store.saves++; },
  };
  return store;
}

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const typed = (c, text) => c.port.deliver({ type: 'sendPrompt', text });

function chatOnStore(store) {
  const session = readSession(sessionFile('R1'));
  return chatWith((input, output) => replayAgent(session, output, input), undefined, { inputHistory: store });
}

test('a message typed in the chat page is kept, newest first; the page is told and the store gets it', async () => {
  const store = memoryStore();
  const c = chatOnStore(store);
  try {
    await sleep(10);
    await typed(c, 'first');
    await typed(c, 'second');
    await sleep(10);
    assert.deepEqual(c.chat.snapshot().inputHistory, ['second', 'first']);
    assert.deepEqual(c.port.toView.filter(m => m.type === 'inputHistory').at(-1), { type: 'inputHistory', entries: ['second', 'first'] });
    assert.deepEqual(store.saved, ['second', 'first']);
  } finally { c.dispose(); }
});

test('kept across conversations and restarts: a later chat on the same store starts with them, and a page that comes is given them', async () => {
  const store = memoryStore();
  const first = chatOnStore(store);
  await sleep(10);
  await typed(first, 'from yesterday');
  first.dispose();
  const later = chatOnStore(store);
  try {
    await sleep(20);
    assert.deepEqual(later.chat.snapshot().inputHistory, ['from yesterday']);
    later.port.toView.length = 0;
    await later.port.deliver(READY_INTENT);
    assert.deepEqual(later.port.toView.find(m => m.type === 'snapshot').state.inputHistory, ['from yesterday']);
  } finally { later.dispose(); }
});

test('a message typed again moves to the front instead of standing twice, an empty one is not kept, and only the newest 100 are kept', async () => {
  const store = memoryStore();
  const c = chatOnStore(store);
  try {
    await sleep(10);
    for (const text of ['a', 'b', 'a', '   ']) { await typed(c, text); }
    assert.deepEqual(c.chat.snapshot().inputHistory, ['a', 'b']);
    for (let i = 0; i < 120; i++) { await typed(c, `m${i}`); }
    assert.equal(c.chat.snapshot().inputHistory.length, 100);
    assert.equal(c.chat.snapshot().inputHistory[0], 'm119');
  } finally { c.dispose(); }
});

test('a prompt the host sends by command is not the person\'s typing and is not kept', async () => {
  const store = memoryStore();
  const c = chatOnStore(store);
  try {
    await sleep(10);
    await c.chat.sendPrompt('sent by another extension');
    assert.deepEqual(c.chat.snapshot().inputHistory, []);
    assert.deepEqual(store.saved, []);
  } finally { c.dispose(); }
});

test('a message typed before the stored ones have loaded is kept in front of them, and the store is given both', async () => {
  const store = memoryStore(['older'], { loadAfterMs: 40 });
  const c = chatOnStore(store);
  try {
    await typed(c, 'quick');
    assert.equal(store.saves, 0, 'nothing is saved over the stored ones before they are read');
    await sleep(80);
    assert.deepEqual(c.chat.snapshot().inputHistory, ['quick', 'older']);
    assert.deepEqual(store.saved, ['quick', 'older']);
  } finally { c.dispose(); }
});

test('a store that cannot be read: the chat goes on with what is typed now, and the log says so', async () => {
  const store = memoryStore([], { failLoad: true });
  const c = chatOnStore(store);
  try {
    await sleep(10);
    await typed(c, 'still works');
    assert.deepEqual(c.chat.snapshot().inputHistory, ['still works']);
    assert.ok(c.host.logged.some(l => /input history/i.test(l) && /unreadable/.test(l)), c.host.logged.join('\n'));
  } finally { c.dispose(); }
});

test('a host with no store: what is typed is kept for as long as the chat runs', async () => {
  const session = readSession(sessionFile('R1'));
  const c = chatWith((input, output) => replayAgent(session, output, input));
  try {
    await typed(c, 'here only');
    assert.deepEqual(c.chat.snapshot().inputHistory, ['here only']);
  } finally { c.dispose(); }
});

test('the reducer: the history is told whole, and a clear, another session or a loaded one leave it as it is', () => {
  const told = reduce(initialViewState(), { type: 'inputHistory', entries: ['b', 'a'] });
  assert.deepEqual(told.inputHistory, ['b', 'a']);
  assert.deepEqual(reduce(told, { type: 'clearChat' }).inputHistory, ['b', 'a']);
  const other = { type: 'state', contractVersion: VIEW_CONTRACT_VERSION, activeSessionId: 'x', session: { sessionId: 'x', agentName: 'A', title: null, cwd: '/w', modes: null, models: null, configOptions: [], availableCommands: [] } };
  assert.deepEqual(reduce(told, other).inputHistory, ['b', 'a']);
  assert.deepEqual(reduce(told, { type: 'loadSessionStart' }).inputHistory, ['b', 'a']);
  assert.deepEqual(initialViewState().inputHistory, []);
});
