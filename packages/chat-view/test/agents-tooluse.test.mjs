// Stage 27 (o), his words 2026-11-18: Agent Control shows whether the agent used jawata. Each agent's row says how its calls split into
// a mark only for what is wrong: shell commands on a Java file, failed calls, open steps; unfolded, the shell commands come first, each with the reason it declared.
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

test('an agent row marks shell commands on a Java file in words, one command or several, counted from the figures the engine sent', async () => {
  const v = await viewOn('R12', { role: 'agents' });
  try {
    await ready(v);
    await post(v, card('dev', 'done', { toolUse: used }));
    assert.equal(useOf(v, 'dev'), '2 shell commands on a Java file', 'THE CLAIM: a run that worked on Java through the shell was not marked');
    assert.doesNotMatch(v.$('.hire[data-plan-id="dev"]').textContent, /\d+ calls? ·/, 'the split sentence is no longer drawn');
    assert.doesNotMatch(v.$('.hire[data-plan-id="dev"]').textContent, / jawata · /);
    assert.doesNotMatch(v.$('.hire[data-plan-id="dev"]').textContent, /shell on Java/, 'the old wording is gone');
    await post(v, card('one', 'done', { toolUse: { observed: true, jawata: 3, other: 0, shellOnJava: [used.shellOnJava[0]], failed: [] } }));
    assert.equal(useOf(v, 'one'), '1 shell command on a Java file', 'one command is singular');
    assert.match(v.$('.hire[data-plan-id="one"] .hire-use').className, /\bshell\b/, 'and still marked');
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
    assert.equal(useOf(v, 'dev'), '2 failed', 'THE CLAIM: the failed calls were shown nowhere');
    assert.equal(useOf(v, 'ok'), undefined, 'CONTROL: a run with no failures was given a mark');
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

test('a run with steps whose gate did not pass says how many in its row and, unfolded, as an exception; a run with none says nothing of it', async () => {
  const v = await viewOn('R12', { role: 'agents' });
  try {
    await ready(v);
    await post(v, card('dev', 'done', { toolUse: { observed: true, jawata: 4, other: 0, shellOnJava: [], failed: [], stepsOpen: 2 } }));
    await post(v, card('ok', 'done', { toolUse: { observed: true, jawata: 4, other: 0, shellOnJava: [], failed: [] } }));
    assert.equal(useOf(v, 'dev'), '2 steps with no passed gate', 'THE CLAIM: a run whose steps were called done with no passing gate looked like any other');
    assert.equal(useOf(v, 'ok'), undefined, 'CONTROL: a run whose gates passed was given a mark');
    await v.click(v.$('.hire[data-plan-id="dev"] .hire-fold'));
    const rows = v.$$('.hire[data-plan-id="dev"] .hire-exception').map(r => r.textContent);
    assert.equal(rows.length, 1);
    assert.match(rows[0], /2 steps/);
    assert.match(rows[0], /no gate passed/);
  } finally { v.dispose(); }
});

test('theCardCarriesNoFullCallLogAndNoSplitSentence', async () => {
  const v = await viewOn('R12', { role: 'agents' });
  try {
    await ready(v);
    for (let i = 0; i < 3; i++) {
      await post(v, { sessionUpdate: 'tool_call', toolCallId: 'p' + i, title: 'Read', kind: 'read', status: 'completed' });
      await act(async () => { v.port.post({ type: 'promptStart' }); });
    }
    await post(v, card('dev', 'done', { task: 'FIRST LINE of the brief\nsecond line of the brief\nthird line', toolUse: used }));
    const row = v.$('.hire[data-plan-id="dev"]').textContent;
    const all = v.$('.agents-panel')?.textContent ?? row;
    assert.doesNotMatch(all, /\d+ calls? ·/, 'no split sentence');
    assert.doesNotMatch(all, / jawata · /);
    assert.doesNotMatch(all, /shell on Java/);
    assert.equal(v.$$('.principal-calls-earlier').length, 0, 'no earlier-calls fold');
    assert.doesNotMatch(v.$('.principal-calls')?.textContent ?? '', /Earlier:/, 'no word of earlier calls');
    assert.equal(v.$$('.hire-task-full').length, 0, 'no full brief');
    assert.match(row, /FIRST LINE of the brief/, 'the brief shows its first line');
    assert.doesNotMatch(row, /second line|third line/, 'and only the first');
    assert.equal(useOf(v, 'dev'), '2 shell commands on a Java file', 'the one mark');
    assert.equal(v.$$('.hire[data-plan-id="dev"] .hire-use').length, 1, 'one mark and no more');
  } finally { v.dispose(); }
});
