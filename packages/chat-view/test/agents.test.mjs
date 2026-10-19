// The agents view on R4 (two overlapping hires, one compacting, both ending done; then a stop and a transcript request).
// R4 is derived (shape only) from a real Claude turn. The hire updates posted here are R4's own, in its order.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { act, closeDom, viewOn, sessionFile } from './dom.mjs';

after(closeDom);

const hireUpdates = readFileSync(sessionFile('R4'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l))
  .filter(l => l.dir === 'recv' && l.msg.method === 'session/update' && ['tool_call', 'tool_call_update'].includes(l.msg.params.update.sessionUpdate))
  .map(l => l.msg.params.update);

const title = (v) => v.$('.agents-title')?.textContent;
const rows = (v) => v.$$('.hire-row');

async function intentsOf(v) {
  const intents = [];
  const deliver = v.port.deliver.bind(v.port);
  v.port.deliver = async (intent) => { intents.push(intent); await deliver(intent); };
  return intents;
}

/** Post R4's updates one at a time, noting the title and the rows after each. */
async function play(v) {
  const seen = [];
  await act(async () => { v.port.post({ type: 'promptStart' }); });
  for (const update of hireUpdates) {
    await act(async () => { v.port.post({ type: 'sessionUpdate', sessionId: v.sessions.getActiveSessionId(), update }); });
    seen.push({ title: title(v), rows: rows(v).length });
  }
  return seen;
}

test('R4: nothing shows before a hire; then the count reads two while both work, one when one has ended, none when both have', async () => {
  const v = await viewOn('R4');
  try {
    await v.connect();
    await v.settle();
    assert.equal(title(v), undefined, 'no agents view without hires');
    const seen = await play(v);
    const titles = [...new Set(seen.map(s => s.title))];
    assert.deepEqual(titles, ['1 agent working', '2 agents working', '1 agent working · 1 finished', '0 agents working · 2 finished']);
    assert.equal(seen.at(-1).rows, 2, 'one row per hire');
  } finally { v.dispose(); }
});

test('R4: a row shows seat, program and model, state, elapsed time, tokens and cost, and a hire that compacts says so', async () => {
  const v = await viewOn('R4');
  try {
    await v.connect();
    await v.settle();
    const states = [];
    const titles = [];
    await act(async () => { v.port.post({ type: 'promptStart' }); });
    for (const update of hireUpdates) {
      await act(async () => { v.port.post({ type: 'sessionUpdate', sessionId: v.sessions.getActiveSessionId(), update }); });
      states.push(v.$('.hire-row[data-plan-id="p-test-writer"] .hire-state')?.textContent);
      titles.push(title(v));
    }
    assert.ok(states.includes('compacting'), 'the row says compacting and not running');
    assert.equal(titles[states.indexOf('compacting')], '2 agents working', 'a hire that compacts still works: the count has it');
    const row = v.$('.hire-row[data-plan-id="p-architect"]');
    assert.equal(row.querySelector('.hire-seat').textContent, 'architect');
    assert.equal(row.querySelector('.hire-who').textContent, 'claude · sonnet');
    assert.equal(row.querySelector('.hire-state').textContent, 'done');
    assert.equal(row.querySelector('.hire-time').textContent, '9s');
    assert.equal(row.querySelector('.hire-tokens').textContent, '15.0k tokens');
    assert.equal(row.querySelector('.hire-cost').textContent, '$0.03');
    for (const el of row.querySelectorAll('span')) { assert.ok(el.getAttribute('title'), `${el.className} has a mouseover`); }
  } finally { v.dispose(); }
});

test('R4: Stop is on a working hire only and asks for that hire, by plan, and for no other', async () => {
  const v = await viewOn('R4');
  try {
    await v.connect();
    await v.settle();
    const intents = await intentsOf(v);
    await act(async () => { v.port.post({ type: 'promptStart' }); });
    // the point where both work: after the second hire began
    const both = hireUpdates.findIndex(u => u.sessionUpdate === 'tool_call' && u._meta['jawata/hire'].planId === 'p-test-writer') + 1;
    for (const update of hireUpdates.slice(0, both)) { await act(async () => { v.port.post({ type: 'sessionUpdate', sessionId: v.sessions.getActiveSessionId(), update }); }); }
    assert.equal(title(v), '2 agents working');
    assert.equal(v.$$('.hire-stop').length, 2);
    await v.click(v.$('.hire-row[data-plan-id="p-test-writer"] .hire-stop'));
    assert.deepEqual(intents.filter(i => i.type === 'stopHire'), [{ type: 'stopHire', planId: 'p-test-writer' }]);
    assert.equal(rows(v).length, 2, 'the rows stay until the agent says otherwise');
    for (const update of hireUpdates.slice(both)) { await act(async () => { v.port.post({ type: 'sessionUpdate', sessionId: v.sessions.getActiveSessionId(), update }); }); }
    assert.equal(v.$$('.hire-stop').length, 0, 'a finished hire has nothing to stop');
  } finally { v.dispose(); }
});

test('R4: a transcript opens read-only: turns to read, no field to type into', async () => {
  const v = await viewOn('R4');
  try {
    await v.connect();
    await v.settle();
    await play(v);
    await v.click(v.$('.hire-row[data-plan-id="p-architect"] .hire-transcript-btn'));
    await v.settle(() => v.$('.hire-turn'));
    const pane = v.$('.hire-transcript');
    assert.ok(pane, 'the transcript is shown');
    assert.deepEqual(v.$$('.hire-turn').map(e => e.textContent.replace(/\s+/g, ' ').trim()), ['user Reply done', 'assistant done']);
    assert.equal(pane.querySelectorAll('input, textarea, select, button, [contenteditable]').length, 0, 'nothing in it can be typed into');
    assert.equal(pane.getAttribute('role'), 'log');
    await v.click(v.$('.hire-row[data-plan-id="p-architect"] .hire-transcript-btn'));
    assert.ok(!v.$('.hire-transcript'), 'it closes');
  } finally { v.dispose(); }
});
