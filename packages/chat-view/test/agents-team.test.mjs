// Stage 27 (u), his words 2026-11-18: after a fold, Agent Control said "8 finished" and showed none, so "done · 0 files changed" was visible
// nowhere. The latest team's agents stay shown after they end with how each ended and how many files it changed.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { act, closeDom, viewOn } from './dom.mjs';

after(closeDom);

const post = (v, update) => act(async () => { v.port.post({ type: 'sessionUpdate', sessionId: v.sessions.getActiveSessionId(), update }); });
const card = (planId, seat, state, extra = {}) => ({ sessionUpdate: 'tool_call', toolCallId: 't-' + planId, title: seat, kind: 'execute', status: 'in_progress',
  _meta: { 'jawata/hire': { planId, seat, seatCommand: '/' + seat, task: 'task of ' + planId, brain: 'claude', model: 'sonnet', state, elapsedMs: 1000, tokens: 10, ...extra } } });

async function ready(v) {
  await v.connect();
  await v.settle();
  await act(async () => { v.port.post({ type: 'promptStart' }); });
}

test('an ended agent of the latest team stays shown and says how many files its run changed, zero included; an agent that sent no count says none', async () => {
  const v = await viewOn('R12', { role: 'agents' });
  try {
    await ready(v);
    await post(v, card('pm', 'pm', 'done', { changedFileCount: 0 }));
    await post(v, card('dev', 'dev', 'done', { parentPlanId: 'pm', changedFileCount: 2 }));
    await post(v, card('qa', 'qa', 'done', { parentPlanId: 'pm' }));
    const files = id => v.$(`.hire[data-plan-id="${id}"] .hire-files`)?.textContent;
    assert.equal(files('pm'), '0 files changed', 'THE CLAIM: "done · 0 files changed" was visible nowhere');
    assert.equal(files('dev'), '2 files changed');
    assert.equal(files('qa'), undefined, 'CONTROL: a card with no count was shown as zero');
    assert.match(v.$('.hire[data-plan-id="pm"] .hire-state').textContent, /done/);
  } finally { v.dispose(); }
});

test('a team hired in an earlier turn is folded into one line, and the latest team is listed', async () => {
  const v = await viewOn('R12', { role: 'agents' });
  try {
    await ready(v);
    await post(v, card('old', 'dev', 'done'));
    await act(async () => { v.port.post({ type: 'promptStart' }); }); // a later turn, which hires again
    await post(v, card('new', 'dev', 'done'));
    const listed = v.$$('.hire[data-plan-id]').map(r => r.getAttribute('data-plan-id'));
    assert.deepEqual(listed, ['new'], 'the earlier team was listed, or the latest was not');
    assert.match(v.$('.agents-earlier')?.textContent ?? '', /Earlier: 1 agent finished/);
  } finally { v.dispose(); }
});
