// The hired agents (R4): each hire is a tool call carrying _meta["jawata/hire"], kept by plan; stopping one and reading its
// transcript are the extension requests the contract names, sent by intent. R4 is derived (shape only) from a real Claude turn.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initialViewState, isWorking, reduce } from '../dist/view-state.js';
import { chatOn } from './play.mjs';

const working = (s) => s.hires.filter(isWorking).length;

/** R4 played: connected, one prompt sent, the turn over. */
async function played() {
  const c = chatOn('R4');
  await c.chat.flow.connect();
  await c.chat.sendPrompt('replay');
  await new Promise(r => setTimeout(r, 200));
  c.sent = (method) => c.host.traffic.filter(t => t.direction === 'send' && t.message.method === method).map(t => t.message.params);
  return c;
}

test('R4: the count of hires working reads two while both run, one when one ends, none when both have', async () => {
  const c = await played();
  try {
    let state = initialViewState();
    const counts = [];
    for (const m of c.port.toView) { state = reduce(state, m); counts.push(working(state)); }
    assert.ok(counts.includes(2), 'two at once');
    const firstTwo = counts.indexOf(2);
    assert.ok(counts.slice(firstTwo).includes(1), 'one when one has ended');
    assert.equal(counts.at(-1), 0, 'none when both have');
    assert.deepEqual(state.hires.map(h => h.seat), ['architect', 'test-writer'], 'one row per hire, in the order they began');
  } finally { c.dispose(); }
});

test('R4: a row holds seat, brain, model, state, elapsed time, tokens and cost as the agent sent them, and takes later updates by plan', async () => {
  const c = await played();
  try {
    const end = c.chat.snapshot();
    const architect = end.hires.find(h => h.planId === 'p-architect');
    assert.deepEqual({ ...architect }, { planId: 'p-architect', seat: 'architect', brain: 'claude', model: 'sonnet', state: 'done', elapsedMs: 9000, tokens: 15000, costUsd: 0.03, brainSessionId: 'brain-session-1' });
    let state = initialViewState();
    const states = [];
    for (const m of c.port.toView) { state = reduce(state, m); states.push(state.hires.find(h => h.planId === 'p-test-writer')?.state); }
    assert.ok(states.includes('compacting'), 'a hire that compacts says so on its row');
  } finally { c.dispose(); }
});

test('R4: stopping one hire sends _jawata/hire/stop with its plan and nothing else; the other row is untouched', async () => {
  const c = await played();
  try {
    const before = c.chat.snapshot().hires;
    await c.port.deliver({ type: 'stopHire', planId: 'p-test-writer' });
    assert.deepEqual(c.sent('_jawata/hire/stop'), [{ planId: 'p-test-writer' }]);
    assert.deepEqual(c.chat.snapshot().hires, before, 'rows change only when the agent says so');
  } finally { c.dispose(); }
});

test('R4: a transcript is asked for by plan and arrives as turns to show read-only', async () => {
  const c = await played();
  try {
    await c.port.deliver({ type: 'openTranscript', planId: 'p-architect' });
    assert.deepEqual(c.sent('_jawata/hire/transcript'), [{ planId: 'p-architect' }]);
    assert.deepEqual(c.chat.snapshot().transcripts['p-architect'], [{ role: 'user', text: 'Reply done' }, { role: 'assistant', text: 'done' }]);
  } finally { c.dispose(); }
});

test('hires end with the conversation: a clear or a load takes the rows and transcripts with it', async () => {
  const c = await played();
  try {
    await c.port.deliver({ type: 'openTranscript', planId: 'p-architect' });
    c.chat.clearChat();
    assert.deepEqual(c.chat.snapshot().hires, []);
    assert.deepEqual(c.chat.snapshot().transcripts, {});
  } finally { c.dispose(); }
});

test('an update without hire fields leaves the hire as it was; one with unusable fields adds none', () => {
  const tool = (extra) => ({ type: 'sessionUpdate', sessionId: 's', update: { sessionUpdate: 'tool_call', toolCallId: 't', title: 'x', ...extra } });
  const first = reduce(initialViewState(), tool({ _meta: { 'jawata/hire': { planId: 'p', seat: 's', brain: 'b', model: 'm', state: 'running', elapsedMs: 1, tokens: 2, costUsd: 3 } } }));
  const next = reduce(first, { type: 'sessionUpdate', sessionId: 's', update: { sessionUpdate: 'tool_call_update', toolCallId: 't', title: 'y' } });
  assert.deepEqual(next.hires, first.hires);
  assert.deepEqual(reduce(initialViewState(), tool({ _meta: { 'jawata/hire': { seat: 'no plan' } } })).hires, []);
});
