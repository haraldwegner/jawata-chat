// The hired agents (R4): each hire is a tool call carrying _meta["jawata/hire"], kept by plan; stopping one and reading its
// transcript are the extension requests the contract names, sent by intent. R4 is derived (shape only) from a real Claude turn.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hireFromEntry, initialViewState, isWorking, reduce, workingTree } from '../dist/view-state.js';
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
    assert.deepEqual({ ...architect }, { planId: 'p-architect', seat: 'architect', seatCommand: '/refactor', task: 'Review the design of the change against the target architecture.', brain: 'claude', model: 'sonnet', state: 'done', elapsedMs: 9000, tokens: 15000, costUsd: 0.03, brainSessionId: 'brain-session-1' });
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

// --- the Agent Control tree (R12: a pm, a chief engineer under it, a dev under that) ---

async function playedTree() {
  const c = chatOn('R12');
  await c.chat.flow.connect();
  await c.chat.sendPrompt('replay');
  await new Promise(r => setTimeout(r, 300));
  c.sent = (method) => c.host.traffic.filter(t => t.direction === 'send' && t.message.method === method).map(t => t.message.params);
  return c;
}
const shape = (state) => workingTree(state.hires).map(r => `${r.depth}:${r.hire.seat}`);

test('R12: the working agents are a tree by parent, the pm at the root; a hire that has ended drops out, and the tree keeps its shape while something under it works', async () => {
  const c = await playedTree();
  try {
    let state = initialViewState();
    const seen = [];
    for (const m of c.port.toView) { state = reduce(state, m); seen.push(shape(state).join(' ')); }
    assert.ok(seen.includes('0:pm 1:chief-engineer 2:dev'), 'three levels at once');
    assert.equal(seen.at(-1), '0:pm', 'at the end only the pm works: the chief engineer and the dev are done and are not shown');
    assert.equal(workingTree([]).length, 0);
  } finally { c.dispose(); }
});

test('the tree: a hire whose parent is not known is a root; a done parent stays while a child under it works; a loop of parents does not hang', () => {
  const h = (planId, state, parentPlanId) => ({ planId, seat: planId, seatCommand: '', task: '', brain: 'b', model: 'm', state, elapsedMs: 0, tokens: 0, ...(parentPlanId ? { parentPlanId } : {}) });
  assert.deepEqual(workingTree([h('a', 'running', 'gone')]).map(r => r.depth), [0]);
  assert.deepEqual(workingTree([h('a', 'done'), h('b', 'running', 'a')]).map(r => `${r.depth}:${r.hire.planId}`), ['0:a', '1:b']);
  assert.deepEqual(workingTree([h('a', 'done'), h('b', 'done', 'a')]), []);
  assert.ok(workingTree([h('a', 'running', 'b'), h('b', 'running', 'a')]).length <= 2, 'a loop is cut');
  assert.deepEqual(workingTree([h('a', 'running', 'a')]).map(r => r.depth), [0], 'a hire that names itself as parent is a root');
});

test('the tree: two sprints, each a pm with its own chief engineer and developers, stand in the order they began, each under its own parent; a failed agent is not shown, unless something under it works', () => {
  const h = (planId, state, parentPlanId) => ({ planId, seat: planId, seatCommand: '', task: '', brain: 'b', model: 'm', state, elapsedMs: 0, tokens: 0, ...(parentPlanId ? { parentPlanId } : {}) });
  const hires = [h('pm1', 'running'), h('ce1', 'running', 'pm1'), h('pm2', 'running'), h('ce2', 'running', 'pm2'), h('dev2', 'running', 'ce2'), h('dev1', 'running', 'ce1')];
  assert.deepEqual(workingTree(hires).map(r => `${r.depth}:${r.hire.planId}`), ['0:pm1', '1:ce1', '2:dev1', '0:pm2', '1:ce2', '2:dev2'], 'each child under its own parent, not interleaved');
  assert.deepEqual(workingTree([h('a', 'failed')]), [], 'a failed agent is not shown');
  assert.deepEqual(workingTree([h('a', 'failed'), h('b', 'running', 'a')]).map(r => r.hire.planId), ['a', 'b'], 'but its place in the tree stays while something under it works');
});

test('R12: a page that comes late or reloads is given the agents as they stand (the panel is a fold of what the core keeps)', async () => {
  const c = await playedTree();
  try {
    c.port.toView.length = 0;
    await c.port.deliver({ type: 'ready', contractVersion: 9 });
    const snapshot = c.port.toView.find(m => m.type === 'snapshot');
    assert.deepEqual(snapshot.state.hires.map(x => x.planId), ['p-pm', 'p-ce', 'p-dev']);
    assert.deepEqual(workingTree(snapshot.state.hires).map(r => r.hire.planId), ['p-pm']);
  } finally { c.dispose(); }
});

test('R12: a hire that sent no cost has none (not zero); one that sent a cost has it', async () => {
  const c = await playedTree();
  try {
    const end = c.chat.snapshot();
    assert.equal('costUsd' in end.hires.find(h => h.planId === 'p-pm'), false);
    assert.equal(end.hires.find(h => h.planId === 'p-ce').costUsd, 0.04);
  } finally { c.dispose(); }
});

test('R12: the brains the agent offers are asked for and told to the page; choosing one asks for it by plan and shows the hire as the agent answers', async () => {
  const c = await playedTree();
  try {
    c.port.toView.length = 0;
    await c.port.deliver({ type: 'listBrains' });
    assert.deepEqual(c.port.toView.map(m => m.type), ['brainList']);
    assert.deepEqual(c.port.toView[0].brains.map(b => `${b.brain}/${b.model}`), ['claude/sonnet', 'claude/haiku', 'claude/opus', 'codex/gpt-5']);
    assert.equal(c.chat.snapshot().hires.find(h => h.planId === 'p-pm').brain, 'claude');
    await c.port.deliver({ type: 'chooseBrain', planId: 'p-pm', brain: 'codex', model: 'gpt-5' });
    assert.deepEqual(c.sent('_jawata/hire/brain'), [{ planId: 'p-pm', brain: 'codex', model: 'gpt-5' }]);
    const pm = c.chat.snapshot().hires.find(h => h.planId === 'p-pm');
    assert.equal(`${pm.brain}/${pm.model}`, 'codex/gpt-5', 'the row shows what the agent answered');
    assert.equal(c.chat.snapshot().hires.length, 3, 'one row per hire still');
  } finally { c.dispose(); }
});

test('28h S24 (D55): a hire card with a name keeps it, and a card without one, or with a name that is empty or not text, has none', () => {
  const base = { planId: 'p', seat: 'pm', brain: 'cursor', model: 'm', state: 'running', elapsedMs: 0, tokens: 0, seatCommand: '', task: '' };
  assert.equal(hireFromEntry({ ...base, name: 'Claudia' }).name, 'Claudia');
  for (const card of [base, { ...base, name: '' }, { ...base, name: 5 }]) { assert.equal('name' in hireFromEntry(card), false); }
});
