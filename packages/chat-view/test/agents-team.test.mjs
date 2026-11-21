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
    assert.equal(v.$('.agents-earlier-run summary')?.textContent, 'task of old · 1 agent · cost not reported', 'with no message of the person to name the run, the first hire\'s brief names it');
  } finally { v.dispose(); }
});

const said = (text) => ({ sessionUpdate: 'user_message_chunk', content: { type: 'text', text } });

test('28h z17: each earlier run is one line, newest first, naming its task, its agents and its cost, and unfolds into its team; a cost nobody reported is said, not shown as zero', async () => {
  const v = await viewOn('R12', { role: 'agents' });
  try {
    await ready(v);
    await post(v, said('First task: tidy the notes'));
    await post(v, card('f1', 'dev', 'done'));
    await post(v, said('Check the jawata version and dogfood, then report in the usual way\nsecond line'));
    await post(v, card('old1', 'pm', 'done', { costUsd: 0.2 }));
    await post(v, card('old2', 'dev', 'done', { parentPlanId: 'old1', costUsd: 0.24 }));
    await post(v, said('Third task'));
    await post(v, card('new', 'dev', 'running'));
    assert.deepEqual(v.$$('.hire[data-plan-id]').map(r => r.getAttribute('data-plan-id')), ['new'], 'only the latest team is listed');
    const lines = v.$$('.agents-earlier-run > summary').map(e => e.textContent);
    assert.deepEqual(lines, [
      'Check the jawata version and dogfood, then report in the… · 2 agents · $0.44',
      'First task: tidy the notes · 1 agent · cost not reported',
    ], 'newest first, the task as the first words of the message, the number of agents, the summed cost');
    await v.click(v.$$('.agents-earlier-run > summary')[0]);
    await v.settle(() => v.$$('.agents-earlier-run')[0].querySelector('.hire[data-plan-id]'));
    const run = v.$$('.agents-earlier-run')[0];
    assert.deepEqual([...run.querySelectorAll('.hire[data-plan-id]')].map(r => r.getAttribute('data-plan-id')), ['old1', 'old2'], 'opened, a run holds its team');
    assert.equal(run.querySelector('.hire[data-plan-id="old2"]').getAttribute('data-depth'), '3', 'the agents of the run are indented as a team');
    assert.equal(v.$$('.hire[data-plan-id]').length, 3, 'the other earlier run stays folded');
  } finally { v.dispose(); }
});
