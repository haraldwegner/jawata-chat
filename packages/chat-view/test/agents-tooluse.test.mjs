// Stage 27 (o), his words 2026-11-18: Agent Control shows whether the agent used jawata. Each agent's row says how its calls split into
// jawata calls, other calls and shell calls on Java; unfolded, the shell calls on Java come first, each with the reason it declared.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { act, closeDom, viewOn } from './dom.mjs';

after(closeDom);

const post = (v, update) => act(async () => { v.port.post({ type: 'sessionUpdate', sessionId: v.sessions.getActiveSessionId(), update }); });
const card = (planId, state, extra = {}) => ({ sessionUpdate: 'tool_call', toolCallId: 't-' + planId, title: planId, kind: 'execute', status: 'in_progress',
  _meta: { 'jawata/hire': { planId, seat: 'developer', seatCommand: '/developer', task: 'task of ' + planId, brain: 'claude', model: 'sonnet', state, elapsedMs: 1000, tokens: 10, ...extra } } });

async function ready(v) {
  await v.connect();
  await v.settle();
  await act(async () => { v.port.post({ type: 'promptStart' }); });
}

const used = { observed: true, jawata: 9, other: 2, shellOnJava: [
  { command: 'grep -rn foo src/A.java', declared: 'the symbol tools do not search log strings' },
  { command: 'sed -i s/a/b/ B.java' } ] };
const useOf = (v, id) => v.$(`.hire[data-plan-id="${id}"] .hire-use`)?.textContent;

test('an agent row says how its calls split into jawata, other and shell on Java, counted from the figures the engine sent', async () => {
  const v = await viewOn('R12', { role: 'agents' });
  try {
    await ready(v);
    await post(v, card('dev', 'done', { toolUse: used }));
    assert.equal(useOf(v, 'dev'), '13 calls · 9 jawata · 2 other · 2 shell on Java', 'THE CLAIM: how the run used jawata was visible nowhere');
  } finally { v.dispose(); }
});

test('a run whose calls were counted and not named says so, and a card with no figures shows nothing', async () => {
  const v = await viewOn('R12', { role: 'agents' });
  try {
    await ready(v);
    await post(v, card('blind', 'done', { toolUse: { observed: false } }));
    await post(v, card('plain', 'done'));
    assert.equal(useOf(v, 'blind'), 'calls not observed', 'a zero here would read as a run that never used jawata');
    assert.equal(useOf(v, 'plain'), undefined, 'CONTROL: a card with no figures was given a line');
  } finally { v.dispose(); }
});

test('a run that had jawata calls fail or be refused says how many in its row, and unfolded lists each with its tool and error code; a run with none says nothing of it', async () => {
  const v = await viewOn('R12', { role: 'agents' });
  try {
    await ready(v);
    const withFailures = { observed: true, jawata: 4, other: 0, shellOnJava: [], failed: [{ tool: 'rename_symbol', code: 'REFACTORING_FAILED' }, { tool: 'files', code: 'ACCESS_DENIED' }] };
    await post(v, card('dev', 'done', { toolUse: withFailures }));
    await post(v, card('ok', 'done', { toolUse: { observed: true, jawata: 4, other: 0, shellOnJava: [], failed: [] } }));
    assert.equal(useOf(v, 'dev'), '4 calls · 4 jawata · 0 other · 0 shell on Java · 2 failed', 'THE CLAIM: the failed calls were shown nowhere');
    assert.equal(useOf(v, 'ok'), '4 calls · 4 jawata · 0 other · 0 shell on Java', 'CONTROL: a run with no failures was given a failed count');
    await v.click(v.$('.hire[data-plan-id="dev"] .hire-fold'));
    const rows = v.$$('.hire[data-plan-id="dev"] .hire-exception').map(r => r.textContent);
    assert.equal(rows.length, 2);
    assert.match(rows[0], /rename_symbol/);
    assert.match(rows[0], /REFACTORING_FAILED/);
    assert.match(rows[1], /files/);
    assert.match(rows[1], /ACCESS_DENIED/);
  } finally { v.dispose(); }
});

test('unfolded, the shell calls on Java come first, each with the reason it declared or the words that it declared none', async () => {
  const v = await viewOn('R12', { role: 'agents' });
  try {
    await ready(v);
    await post(v, card('dev', 'done', { toolUse: used }));
    assert.equal(v.$$('.hire[data-plan-id="dev"] .hire-exception').length, 0, 'the list showed before it was asked for');
    await v.click(v.$('.hire[data-plan-id="dev"] .hire-fold'));
    const rows = v.$$('.hire[data-plan-id="dev"] .hire-exception').map(r => r.textContent);
    assert.equal(rows.length, 2);
    assert.match(rows[0], /grep -rn foo src\/A\.java/);
    assert.match(rows[0], /the symbol tools do not search log strings/);
    assert.match(rows[1], /sed -i s\/a\/b\/ B\.java/);
    assert.match(rows[1], /no reason declared/, 'CONTROL: a call with no declaration was given a reason');
    const first = v.$('.hire[data-plan-id="dev"] .hire-transcript, .hire[data-plan-id="dev"] .hire-exceptions');
    assert.ok(first?.classList.contains('hire-exceptions'), 'the exceptions did not come before the transcript');
  } finally { v.dispose(); }
});
