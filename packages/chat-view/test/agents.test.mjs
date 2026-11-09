// The Agent Control panel on R12 (a pm, a chief engineer under it, a dev under that; the dev and then the chief engineer end; a list of
// brains and the pm's brain replaced). R12 is derived (shape only). The hire updates posted here are R12's own, in its order.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { act, closeDom, viewOn, sessionFile } from './dom.mjs';

after(closeDom);

const hireUpdates = readFileSync(sessionFile('R12'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l))
  .filter(l => l.dir === 'recv' && l.msg.method === 'session/update' && ['tool_call', 'tool_call_update'].includes(l.msg.params.update.sessionUpdate))
  .map(l => l.msg.params.update);

const title = (v) => v.$('.agents-title')?.textContent;
const rowsOf = (v) => v.$$('.hire[data-plan-id]');
const shape = (v) => rowsOf(v).map(r => `${r.getAttribute('data-depth')}:${r.querySelector('.hire-seat').textContent.split(' ')[0]}`);
const post = (v, update) => act(async () => { v.port.post({ type: 'sessionUpdate', sessionId: v.sessions.getActiveSessionId(), update }); });

async function intentsOf(v) {
  const intents = [];
  const deliver = v.port.deliver.bind(v.port);
  v.port.deliver = async (intent) => { intents.push(intent); await deliver(intent); };
  return intents;
}

async function ready(v) {
  await v.connect();
  await v.settle();
  await act(async () => { v.port.post({ type: 'promptStart' }); });
}

test('R12: the panel is there with no agent, and says none works', async () => {
  const v = await viewOn('R12', { role: 'agents' });
  try {
    await v.connect();
    await v.settle();
    assert.equal(title(v), '0 agents working');
    assert.equal(rowsOf(v).length, 0, 'no hired agent is listed');
    assert.match(v.$('.hire.principal').textContent, /waiting for you/, 'between turns the principal stands there, so its brain can be changed');
  } finally { v.dispose(); }
});

test('R12: the working agents stand as a tree, the pm at the root; an agent that has ended is not shown, and the count says how many ended', async () => {
  const v = await viewOn('R12', { role: 'agents' });
  try {
    await ready(v);
    const seen = [];
    for (const update of hireUpdates) { await post(v, update); seen.push({ title: title(v), shape: shape(v).join(' ') }); }
    assert.ok(seen.some(s => s.shape === '0:pm 1:chief-engineer 2:dev'), 'three levels at once');
    assert.ok(seen.some(s => s.title === '3 agents working'));
    assert.equal(seen.at(-1).shape, '0:pm', 'at the end only the pm works');
    assert.equal(seen.at(-1).title, '2 agents working · 2 finished', 'the pm and the principal');
    assert.equal(v.$('.hire[data-depth="0"]').style.marginLeft, '0px');
    const all = seen.find(s => s.shape === '0:pm 1:chief-engineer 2:dev');
    assert.ok(all);
  } finally { v.dispose(); }
});

test('R12: a row shows the seat with its command, the brain, state, time, tokens, the task in full and a cost only when the agent sent one; every part has a mouseover', async () => {
  const v = await viewOn('R12', { role: 'agents' });
  try {
    await ready(v);
    const upTo = hireUpdates.findIndex(u => u.sessionUpdate === 'tool_call' && u._meta['jawata/hire'].planId === 'p-dev') + 1;
    for (const update of hireUpdates.slice(0, upTo)) { await post(v, update); }
    const pm = v.$('.hire[data-plan-id="p-pm"]');
    assert.equal(pm.querySelector('.hire-seat').textContent.replace(/\s+/g, ' ').trim(), 'pm (/pm)');
    assert.equal(pm.querySelector('.brain-btn').textContent, 'claude · sonnet ▾');
    assert.equal(pm.querySelector('.hire-state').textContent, 'running');
    assert.equal(pm.querySelector('.hire-task').textContent, 'Run sprint 28i: keep the plan\'s stages moving and report at each checkpoint.');
    assert.equal(pm.querySelector('.hire-task').getAttribute('title'), pm.querySelector('.hire-task').textContent, 'the task is never cut: the mouseover has it all');
    assert.equal(pm.querySelector('.hire-cost'), null, 'the pm sent no cost: no cost shows, and not $0.000');
    const ce = v.$('.hire[data-plan-id="p-ce"]');
    assert.equal(ce.querySelector('.hire-state').textContent, 'compacting');
    assert.match(ce.querySelector('.hire-cost').textContent, /^\$0\.0\d+$/, 'the chief engineer sent a cost');
    assert.equal(ce.querySelector('.hire-tokens').textContent, '12.0k tokens');
    for (const el of v.$$('.hire-row span:not(.brain-wrap), .hire-row button')) { assert.ok(el.closest('[title], [aria-label]'), `${el.className} has a mouseover, its own or its parent's`); }
  } finally { v.dispose(); }
});

test('R12: Stop is on every working agent and asks for that agent by plan, and for no other', async () => {
  const v = await viewOn('R12', { role: 'agents' });
  try {
    await ready(v);
    const intents = await intentsOf(v);
    const upTo = hireUpdates.findIndex(u => u.sessionUpdate === 'tool_call' && u._meta['jawata/hire'].planId === 'p-dev') + 1;
    for (const update of hireUpdates.slice(0, upTo)) { await post(v, update); }
    assert.equal(v.$$('.hire-stop').length, 3);
    await v.click(v.$('.hire[data-plan-id="p-ce"] .hire-stop'));
    assert.deepEqual(intents.filter(i => i.type === 'stopHire'), [{ type: 'stopHire', planId: 'p-ce' }]);
    assert.equal(rowsOf(v).length, 3, 'the rows stay until the agent says otherwise');
  } finally { v.dispose(); }
});

test('R12: what an agent said is folded until asked for; unfolding asks for it, shows it read-only, and folding hides it again; an empty one says so', async () => {
  const v = await viewOn('R12', { role: 'agents' });
  try {
    await ready(v);
    const intents = await intentsOf(v);
    await post(v, hireUpdates[0]);
    assert.ok(!v.$('.hire-transcript'), 'folded by default');
    assert.equal(v.$('.hire-fold').getAttribute('aria-expanded'), 'false');
    await v.click(v.$('.hire-fold'));
    assert.deepEqual(intents.filter(i => i.type === 'openTranscript'), [{ type: 'openTranscript', planId: 'p-pm' }]);
    assert.ok(v.$('.hire-transcript-wait'), 'it says it is loading');
    await act(async () => { v.port.post({ type: 'hireTranscript', planId: 'p-pm', turns: [{ role: 'user', text: 'Run the sprint' }, { role: 'assistant', text: 'Starting with S22' }] }); });
    const pane = v.$('.hire-transcript');
    assert.deepEqual(v.$$('.hire-turn').map(e => e.textContent.replace(/\s+/g, ' ').trim()), ['user Run the sprint', 'assistant Starting with S22']);
    assert.equal(pane.querySelectorAll('input, textarea, select, button, [contenteditable]').length, 0, 'nothing in it can be typed into');
    assert.equal(pane.getAttribute('role'), 'log');
    await v.click(v.$('.hire-fold'));
    assert.ok(!v.$('.hire-transcript'), 'it folds again');
    await act(async () => { v.port.post({ type: 'hireTranscript', planId: 'p-pm', turns: [] }); });
    await v.click(v.$('.hire-fold'));
    assert.equal(v.$('.hire-transcript-empty').textContent, 'No talk recorded for this agent.');
  } finally { v.dispose(); }
});

test('two sprints: each pm stands at the root with its own agents under it, in the order they began; a failed agent is not a row', async () => {
  const v = await viewOn('R12', { role: 'agents' });
  try {
    await ready(v);
    const hire = (planId, seat, state, parentPlanId) => ({ sessionUpdate: 'tool_call', toolCallId: 't-' + planId, title: seat, kind: 'execute', status: 'in_progress',
      _meta: { 'jawata/hire': { planId, seat, seatCommand: '/' + seat, task: 'task of ' + planId, brain: 'claude', model: 'sonnet', state, elapsedMs: 1000, tokens: 10, ...(parentPlanId ? { parentPlanId } : {}) } } });
    for (const h of [hire('pm1', 'pm', 'running'), hire('ce1', 'chief-engineer', 'running', 'pm1'), hire('pm2', 'pm', 'running'), hire('ce2', 'chief-engineer', 'running', 'pm2'),
      hire('dev2', 'dev', 'running', 'ce2'), hire('dev1', 'dev', 'running', 'ce1'), hire('bad', 'dev', 'failed', 'ce1')]) { await post(v, h); }
    assert.deepEqual(shape(v), ['0:pm', '1:chief-engineer', '2:dev', '0:pm', '1:chief-engineer', '2:dev']);
    assert.deepEqual(rowsOf(v).map(r => r.getAttribute('data-plan-id')), ['pm1', 'ce1', 'dev1', 'pm2', 'ce2', 'dev2'], 'each under its own parent');
    assert.equal(title(v), '7 agents working · 1 finished');
  } finally { v.dispose(); }
});

test('R12: the brain is a control: clicking it shows what the agent offers, picking one replaces this agent\'s brain, and the row shows what the agent answered', async () => {
  const v = await viewOn('R12', { role: 'agents' });
  try {
    await ready(v);
    const intents = await intentsOf(v);
    await post(v, hireUpdates[0]);
    assert.ok(!v.$('.brain-menu'), 'closed until clicked');
    await v.click(v.$('.hire[data-plan-id="p-pm"] .brain-btn'));
    assert.equal(intents.filter(i => i.type === 'listBrains').length, 1, 'the list is asked for when first needed');
    await v.settle(() => v.$$('.brain-item').length > 0);
    assert.deepEqual(v.$$('.brain-item').map(e => e.textContent), ['✓claude · sonnet', 'claude · haiku', 'claude · opus', 'codex · gpt-5'].map(t => t.replace('✓', '✓')));
    assert.equal(v.$('.brain-item[aria-selected="true"]').textContent, '✓claude · sonnet', 'the current one is marked');
    const codex = v.$$('.brain-item').find(e => e.textContent.includes('codex'));
    await v.click(codex);
    assert.deepEqual(intents.filter(i => i.type === 'chooseBrain'), [{ type: 'chooseBrain', planId: 'p-pm', brain: 'codex', model: 'gpt-5' }]);
    await v.settle(() => v.$('.hire[data-plan-id="p-pm"] .brain-btn').textContent.startsWith('codex'));
    assert.equal(v.$('.hire[data-plan-id="p-pm"] .brain-btn').textContent, 'codex · gpt-5 ▾');
    assert.ok(!v.$('.brain-menu'), 'the choice closes the list');
    await v.click(v.$('.hire[data-plan-id="p-pm"] .brain-btn'));
    assert.equal(intents.filter(i => i.type === 'listBrains').length, 2, 'the list is asked for each time it opens, so a brain the agent gained since shows');
    await v.click(v.$$('.brain-item').find(e => e.textContent.includes('codex')));
    assert.equal(intents.filter(i => i.type === 'chooseBrain').length, 1, 'choosing the brain it already has asks for nothing');
  } finally { v.dispose(); }
});
