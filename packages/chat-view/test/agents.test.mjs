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

test('R12: the working agents stand as a tree, the pm at the root; the agents of the latest team stay shown after they end (Stage 27 (u)), and the count says how many ended', async () => {
  const v = await viewOn('R12', { role: 'agents' });
  try {
    await ready(v);
    const seen = [];
    for (const update of hireUpdates) { await post(v, update); seen.push({ title: title(v), shape: shape(v).join(' ') }); }
    assert.ok(seen.some(s => s.shape === '2:pm 3:chief-engineer 4:dev'), 'three levels at once');
    assert.ok(seen.some(s => s.title === '3 agents working'));
    assert.equal(seen.at(-1).shape, '2:pm 3:chief-engineer 4:dev', 'at the end only the pm works, and the chief engineer and the dev that ended stay under it, being of the latest team');
    assert.equal(seen.at(-1).title, '2 agents working · 2 finished', 'the pm and the principal');
    assert.equal(v.$('.hire[data-depth="0"]').style.marginLeft, '0px');
    const all = seen.find(s => s.shape === '2:pm 3:chief-engineer 4:dev');
    assert.ok(all);
  } finally { v.dispose(); }
});

test('28h S24 (D55): a hire that carries a name shows it beside its role, as `Claudia · pm`, and one without a name shows the role alone', async () => {
  const v = await viewOn('R12', { role: 'agents' });
  try {
    await ready(v);
    const first = structuredClone(hireUpdates.find(u => u.sessionUpdate === 'tool_call' && u._meta['jawata/hire'].planId === 'p-pm'));
    await post(v, first);
    const label = () => v.$('.hire[data-plan-id="p-pm"] .hire-seat').textContent.replace(/\s+/g, ' ').trim();
    assert.equal(label(), 'pm (/pm)', 'no name: the role alone');
    first._meta['jawata/hire'].name = 'Claudia';
    await post(v, { ...first, sessionUpdate: 'tool_call_update' });
    assert.equal(label(), 'Claudia · pm (/pm)');
  } finally { v.dispose(); }
});

test('R12: a row shows the seat with its command, the brain, state, time, tokens, the first line of the brief and a cost only when the agent sent one; every part has a mouseover', async () => {
  const v = await viewOn('R12', { role: 'agents' });
  try {
    await ready(v);
    const upTo = hireUpdates.findIndex(u => u.sessionUpdate === 'tool_call' && u._meta['jawata/hire'].planId === 'p-dev') + 1;
    for (const update of hireUpdates.slice(0, upTo)) { await post(v, update); }
    const pm = v.$('.hire[data-plan-id="p-pm"]');
    assert.equal(pm.querySelector('.hire-seat').textContent.replace(/\s+/g, ' ').trim(), 'pm (/pm)');
    assert.equal(pm.querySelector('.brain-btn').textContent, 'claude · sonnet ▾');
    assert.equal(pm.querySelector('.hire-state').textContent, 'running');
    assert.equal(pm.querySelector('.hire-task').textContent, 'Brief: Run sprint 28i: keep the plan\'s stages moving and report at each checkpoint.');
    assert.equal(pm.querySelector('.hire-task').getAttribute('title'), 'The first line of what this agent was asked to do', 'the mouseover explains the line and does not carry the brief');
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
    // The recording has no transcript to give, so the core would answer "missing" at once; here the core is slow, so the page is seen while it waits.
    const deliver = v.port.deliver.bind(v.port);
    v.port.deliver = async (intent) => { if (intent.type === 'openTranscript') { return; } await deliver(intent); };
    const intents = await intentsOf(v);
    await post(v, hireUpdates[0]);
    assert.ok(!v.$('.hire-transcript'), 'folded by default');
    assert.equal(v.$('.hire-fold').getAttribute('aria-expanded'), 'false');
    await v.click(v.$('.hire-fold'));
    assert.deepEqual(intents.filter(i => i.type === 'openTranscript'), [{ type: 'openTranscript', planId: 'p-pm' }]);
    assert.ok(v.$('.hire-transcript-wait'), 'it says it is loading');
    await act(async () => { v.port.post({ type: 'hireTranscript', planId: 'p-pm', turns: [{ role: 'user', text: 'Run the sprint' }, { role: 'tool', text: 'Read Foo.java' }, { role: 'assistant', text: 'Starting with S22' }, { role: 'tool', text: 'Edit Foo.java' }] }); });
    const pane = v.$('.hire-transcript');
    assert.deepEqual(v.$$('.hire-turn').map(e => e.textContent.replace(/\s+/g, ' ').trim()), ['Read Foo.java', 'Edit Foo.java'], 'only the calls');
    assert.doesNotMatch(pane.textContent, /Run the sprint/, 'the brief is not in the fold');
    assert.doesNotMatch(pane.textContent, /Starting with S22/, 'nor are the words of the agent');
    assert.equal(pane.querySelectorAll('input, textarea, select, button, [contenteditable]').length, 0, 'nothing in it can be typed into');
    assert.equal(pane.getAttribute('role'), 'log');
    await v.click(v.$('.hire-fold'));
    assert.ok(!v.$('.hire-transcript'), 'it folds again');
    await act(async () => { v.port.post({ type: 'hireTranscript', planId: 'p-pm', turns: [] }); });
    await v.click(v.$('.hire-fold'));
    assert.equal(v.$('.hire-transcript-empty').textContent, 'No calls recorded for this agent.');
    await v.click(v.$('.hire-fold'));
    await act(async () => { v.port.post({ type: 'hireTranscript', planId: 'p-pm', turns: [{ role: 'user', text: 'Run the sprint' }, { role: 'assistant', text: 'Starting with S22' }] }); });
    await v.click(v.$('.hire-fold'));
    assert.equal(v.$('.hire-transcript-empty').textContent, 'No calls recorded for this agent.', 'a brief and words alone are no calls');
    assert.equal(v.$$('.hire-turn').length, 0);
  } finally { v.dispose(); }
});

test('aHiresFoldListsItsCallsAndNotTheAssistantsWords', async () => {
  const v = await viewOn('R12', { role: 'agents' });
  try {
    await ready(v);
    const deliver = v.port.deliver.bind(v.port);
    v.port.deliver = async (intent) => { if (intent.type === 'openTranscript') { return; } await deliver(intent); };
    const hire = (planId) => ({ sessionUpdate: 'tool_call', toolCallId: 't-' + planId, title: 'dev', kind: 'execute', status: 'in_progress',
      _meta: { 'jawata/hire': { planId, seat: 'developer', seatCommand: '/developer', task: 'the brief of ' + planId, brain: 'claude', model: 'sonnet', state: 'running', elapsedMs: 1000, tokens: 10 } } });
    await post(v, hire('h1'));
    await post(v, hire('h2'));
    const fold = (id) => v.$(`.hire[data-plan-id="${id}"] .hire-fold`);
    assert.ok(fold('h1') && fold('h2'), 'each hire has the same fold');
    await v.click(fold('h1'));
    await act(async () => { v.port.post({ type: 'hireTranscript', planId: 'h1', turns: [
      { role: 'user', text: 'the brief of h1, in full words' }, { role: 'tool', text: 'Read A.java' }, { role: 'tool', text: 'Edit A.java' }, { role: 'assistant', text: 'I changed the file as asked' }] }); });
    const lines = (id) => v.$$(`.hire[data-plan-id="${id}"] .hire-transcript .hire-turn`).map(e => e.textContent.replace(/\s+/g, ' ').trim());
    assert.deepEqual(lines('h1'), ['Read A.java', 'Edit A.java'], 'exactly the two calls');
    const pane = v.$('.hire[data-plan-id="h1"] .hire-transcript');
    assert.doesNotMatch(pane.textContent, /in full words/, 'not the brief');
    assert.doesNotMatch(pane.textContent, /I changed the file/, 'not the assistant\'s words');
    await v.click(fold('h2'));
    await act(async () => { v.port.post({ type: 'hireTranscript', planId: 'h2', turns: [{ role: 'tool', text: 'Write B.java' }, { role: 'assistant', text: 'finished B' }] }); });
    assert.deepEqual(lines('h2'), ['Write B.java'], 'the same fold on the second hire lists its calls only');
    assert.doesNotMatch(v.$('.hire[data-plan-id="h2"] .hire-transcript').textContent, /finished B/);
  } finally { v.dispose(); }
});

test('28h z36: a hire whose transcript is missing says so on its own row, draws no call line and sends the chat no error', async () => {
  const v = await viewOn('R12', { role: 'agents' });
  try {
    await ready(v);
    const posted = [];
    const post0 = v.port.post.bind(v.port);
    v.port.post = (m) => { posted.push(m); return post0(m); };
    await post(v, hireUpdates[0]);
    await v.click(v.$('.hire-fold'));
    await act(async () => { v.port.post({ type: 'hireTranscript', planId: 'p-pm', turns: [{ role: 'missing', text: 'no hire p-pm was seen by this agent' }] }); });
    const missing = v.$('.hire[data-plan-id="p-pm"] .hire-transcript-missing');
    assert.ok(missing, 'the row says it');
    assert.equal(missing.textContent, 'This agent has no transcript for this hire.');
    assert.equal(missing.getAttribute('title'), 'no hire p-pm was seen by this agent');
    assert.equal(v.$$('.hire-turn').length, 0, 'no call line');
    assert.equal(posted.filter(m => m.type === 'error').length, 0, 'no error message reached the page');
    assert.ok(!v.$('.message.error'), 'and none is drawn');
  } finally { v.dispose(); }
});

test('two sprints: each pm stands at the root with its own agents under it, in the order they began; a failed agent of the latest team stays a row under its parent', async () => {
  const v = await viewOn('R12', { role: 'agents' });
  try {
    await ready(v);
    const hire = (planId, seat, state, parentPlanId) => ({ sessionUpdate: 'tool_call', toolCallId: 't-' + planId, title: seat, kind: 'execute', status: 'in_progress',
      _meta: { 'jawata/hire': { planId, seat, seatCommand: '/' + seat, task: 'task of ' + planId, brain: 'claude', model: 'sonnet', state, elapsedMs: 1000, tokens: 10, ...(parentPlanId ? { parentPlanId } : {}) } } });
    for (const h of [hire('pm1', 'pm', 'running'), hire('ce1', 'chief-engineer', 'running', 'pm1'), hire('pm2', 'pm', 'running'), hire('ce2', 'chief-engineer', 'running', 'pm2'),
      hire('dev2', 'dev', 'running', 'ce2'), hire('dev1', 'dev', 'running', 'ce1'), hire('bad', 'dev', 'failed', 'ce1')]) { await post(v, h); }
    assert.deepEqual(shape(v), ['2:pm', '3:chief-engineer', '4:dev', '4:dev', '2:pm', '3:chief-engineer', '4:dev']);
    assert.deepEqual(rowsOf(v).map(r => r.getAttribute('data-plan-id')), ['pm1', 'ce1', 'dev1', 'bad', 'pm2', 'ce2', 'dev2'], 'each under its own parent, the failed one among them');
    assert.equal(title(v), '7 agents working · 1 finished');
  } finally { v.dispose(); }
});

test('R12: the brain control stores the next hire and the row keeps what this run started on', async () => {
  const v = await viewOn('R12', { role: 'agents' });
  try {
    await ready(v);
    const intents = await intentsOf(v);
    await post(v, hireUpdates[0]);
    assert.equal(v.$('.hire[data-plan-id="p-pm"] .brain-btn').textContent, 'claude · sonnet ▾');
    assert.ok(!v.$('.brain-menu'), 'closed until clicked');
    await v.click(v.$('.hire[data-plan-id="p-pm"] .brain-btn'));
    assert.equal(intents.filter(i => i.type === 'listBrains').length, 1, 'the list is asked for when first needed');
    await v.settle(() => v.$$('.brain-item').length > 0);
    // Old assertion: the running brain was marked '✓claude · sonnet' and a pick replaced the row.
    // The mark is the stored choice. Nothing is stored yet, so nothing is marked. The row stays what this run started on.
    assert.equal(v.$('.brain-menu-note').textContent, 'applies from the next hire of this seat');
    assert.deepEqual(v.$$('.brain-item').map(e => e.textContent), ['claude · sonnet', 'claude · haiku', 'claude · opus', 'codex · gpt-5']);
    assert.equal(v.$('.brain-item[aria-selected="true"]'), null, 'nothing is stored yet');
    await act(async () => {
      v.port.post({ type: 'seatChoice', seat: 'pm', brain: 'codex', model: 'gpt-5', applies: 'applies from the next hire of this seat' });
    });
    await v.settle(() => v.$('.brain-item[aria-selected="true"]')?.textContent === '✓codex · gpt-5');
    assert.equal(v.$('.hire[data-plan-id="p-pm"] .brain-btn').textContent, 'claude · sonnet ▾', 'the row still shows what this run started on');
    await v.click(v.$$('.brain-item').find(e => e.textContent.includes('codex')));
    assert.deepEqual(intents.filter(i => i.type === 'chooseBrain'), [], 'the stored choice is not asked for again');
    await v.click(v.$('.hire[data-plan-id="p-pm"] .brain-btn'));
    await v.settle(() => v.$$('.brain-item').length > 0);
    await v.click(v.$$('.brain-item').find(e => e.textContent.includes('haiku')));
    assert.deepEqual(intents.filter(i => i.type === 'chooseBrain'), [{ type: 'chooseBrain', planId: 'p-pm', brain: 'claude', model: 'haiku' }]);
  } finally { v.dispose(); }
});

test('28h z17: the hires stand under the principal in a folded line of their own, "Hires (N)", at the third level; the pm at the root of the team, its agents one step further', async () => {
  const v = await viewOn('R12', { role: 'agents' });
  try {
    await ready(v);
    assert.equal(v.$('details.agents-hires') === null, true, 'control: with no hire there is no Hires line');
    const hire = (planId, seat, parent) => ({ sessionUpdate: 'tool_call', toolCallId: 't-' + planId, title: seat, kind: 'execute', status: 'in_progress',
      _meta: { 'jawata/hire': { planId, seat, seatCommand: '/' + seat, task: 'task of ' + planId, brain: 'claude', model: 'sonnet', state: 'running', elapsedMs: 1000, tokens: 10, ...(parent ? { parentPlanId: parent } : {}) } } });
    await post(v, hire('p-pm', 'pm'));
    await post(v, hire('p-dev', 'developer', 'p-pm'));
    const fold = v.$('details.agents-hires');
    assert.equal(fold?.querySelector('summary').textContent, 'Hires (2)', 'one line that says how many');
    assert.equal(fold?.open, true, 'open while an agent works');
    assert.deepEqual([...fold.querySelectorAll('.hire[data-plan-id]')].map(r => `${r.getAttribute('data-depth')}:${r.getAttribute('data-plan-id')}`), ['2:p-pm', '3:p-dev'], 'the hires are inside it, the pm at the third level');
    assert.equal(v.$('.hire.principal').getAttribute('data-depth'), '0', 'the principal is the root');
  } finally { v.dispose(); }
});

test('28h z17: an agent row and its brief cannot be taken for each other: the brief is labelled "Brief" and the agent\'s own row is not', async () => {
  const v = await viewOn('R12', { role: 'agents' });
  try {
    await ready(v);
    await post(v, { sessionUpdate: 'tool_call', toolCallId: 't-b', title: 'pm', kind: 'execute', status: 'in_progress',
      _meta: { 'jawata/hire': { planId: 'p-b', seat: 'pm', seatCommand: '/pm', task: 'Check the jawata version\nand dogfood', brain: 'claude', model: 'sonnet', state: 'running', elapsedMs: 1000, tokens: 0 } } });
    const row = v.$('.hire[data-plan-id="p-b"]');
    assert.equal(row.querySelector('.hire-task .hire-brief-label')?.textContent, 'Brief:', 'the brief says what it is');
    assert.equal(row.querySelector('.hire-row .hire-brief-label'), null, 'control: the agent\'s own row is not labelled a brief');
  } finally { v.dispose(); }
});

test('28h z36: the principal\'s latest turn is one closed fold of its calls and no log of earlier calls exists', async () => {
  const v = await viewOn('R12', { role: 'agents' });
  try {
    await ready(v);
    for (let turn = 0; turn < 3; turn++) {
      for (let i = 0; i < 50; i++) { await post(v, { sessionUpdate: 'tool_call', toolCallId: `c-${turn}-${i}`, title: 'Read', kind: 'read', status: 'completed' }); }
      await act(async () => { v.port.post({ type: 'promptStart' }); });
    }
    await post(v, { sessionUpdate: 'tool_call', toolCallId: 'c-last', title: 'Read', kind: 'read', status: 'completed' });
    assert.ok(!v.$('.principal-calls-earlier'), 'no earlier-calls fold');
    assert.doesNotMatch(v.$('.principal-calls').textContent, /Earlier:/, 'and no word of earlier calls');
    assert.equal(v.$$('details.principal-calls-latest').length, 1, 'one fold of the latest turn');
    const latest = v.$('details.principal-calls-latest');
    assert.equal(latest.open, false, 'closed by default');
    assert.equal(latest.querySelector('summary').textContent, '1 tool call');
    latest.open = true;
    await v.settle(() => latest.querySelectorAll('.tool-call-inline').length > 0);
    assert.equal(latest.querySelectorAll('.tool-call-inline').length, 1, 'opened, it holds the one call');
  } finally { v.dispose(); }
});

test('28h z14: the brain of a hire that has ended is not a menu that looks as if it changes the finished run; it says what the run used and where the next hire of the seat is changed', async () => {
  const v = await viewOn('R12', { role: 'agents' });
  try {
    await ready(v);
    const hire = (planId, state) => ({ sessionUpdate: 'tool_call', toolCallId: 't-' + planId, title: 'developer', kind: 'execute', status: 'in_progress',
      _meta: { 'jawata/hire': { planId, seat: 'developer', seatCommand: '/developer', task: 'task of ' + planId, brain: 'claude-code', model: 'Haiku 5.5', state, elapsedMs: 1000, tokens: 10 } } });
    await post(v, hire('p-live', 'running'));
    await post(v, hire('p-done', 'done'));
    const live = v.$('.hire[data-plan-id="p-live"]');
    const done = v.$('.hire[data-plan-id="p-done"]');
    assert.equal(Boolean(live.querySelector('.brain-btn')), true, 'control: a running hire still has its brain as a menu');
    assert.equal(Boolean(done.querySelector('.brain-btn')), false, 'an ended hire offers no menu of a replacement that cannot run');
    const label = done.querySelector('.brain-fixed');
    assert.equal(label?.textContent, 'claude-code · Haiku 5.5', 'it still says what the run used');
    assert.match(String(label?.getAttribute('title')), /finished/, 'the mouseover says the finished run is not changed');
    assert.match(String(label?.getAttribute('title')), /developer/, 'and names the seat whose next hire is the one to change');
    assert.match(String(label?.getAttribute('title')), /Seats page/, 'and says where');
  } finally { v.dispose(); }
});

test('28h z36: a hire\'s brief is one line and the rest of it is not shown', async () => {
  const v = await viewOn('R12', { role: 'agents' });
  try {
    await ready(v);
    const hire = { planId: 'p-x', seat: 'chief-engineer', name: 'Rafael', task: 'INSTRUCTION 1\nTOOL: Edit\nFILE: a.txt', brain: 'claude', model: '', state: 'running', elapsedMs: 0, tokens: 0 };
    await post(v, { sessionUpdate: 'tool_call', toolCallId: 'hx', title: 'hire', status: 'completed', kind: 'other', _meta: { 'jawata/hire': hire } });
    const row = v.$('.hire[data-plan-id="p-x"]');
    const task = row.querySelector('.hire-task');
    assert.equal(task.textContent, 'Brief: INSTRUCTION 1', 'one line, labelled');
    assert.equal(row.querySelector('.hire-task .hire-brief-label')?.textContent, 'Brief:');
    assert.equal(row.querySelector('.hire-row .hire-brief-label'), null, 'the agent\'s own row has no such label');
    assert.doesNotMatch(row.textContent, /TOOL: Edit/);
    assert.doesNotMatch(row.textContent, /FILE: a\.txt/);
    assert.doesNotMatch(task.getAttribute('title') ?? '', /TOOL: Edit|FILE: a\.txt|INSTRUCTION 1/, 'the mouseover does not carry the brief');
    assert.equal(row.querySelector('details.hire-task'), null, 'not a fold');
    assert.equal(row.querySelector('.hire-task-full'), null, 'no full text anywhere in the row');
    assert.equal(row.querySelector('.hire-task pre, .hire-task details, .hire-task summary'), null);
  } finally { v.dispose(); }
});

test('28h D57 (i): an opened agent that still works is asked again for what it said each time its card changes, so its calls so far show', async () => {
  const v = await viewOn('R12', { role: 'agents' });
  try {
    await ready(v);
    const intents = await intentsOf(v);
    const hire = { planId: 'p-y', seat: 'developer', task: 'Edit Foo', brain: 'claude', model: '', state: 'running', elapsedMs: 1000, tokens: 0 };
    await post(v, { sessionUpdate: 'tool_call', toolCallId: 'hy', title: 'hire', status: 'completed', kind: 'other', _meta: { 'jawata/hire': hire } });
    await v.click(v.$('.hire[data-plan-id="p-y"] .hire-fold'));
    await act(async () => { v.port.post({ type: 'hireTranscript', planId: 'p-y', turns: [{ role: 'user', text: 'Edit Foo' }, { role: 'tool', text: 'Read Foo.java' }] }); });
    assert.deepEqual(v.$$('.hire[data-plan-id="p-y"] .hire-turn').map(e => e.textContent.replace(/\s+/g, ' ').trim()), ['Read Foo.java'], 'its calls only');
    const asked = () => intents.filter(i => i.type === 'openTranscript' && i.planId === 'p-y').length;
    assert.equal(asked(), 1);
    await act(async () => { v.port.post({ type: 'hireChanged', hire: { ...hire, elapsedMs: 4000, tokens: 900 } }); });
    assert.equal(asked(), 2, 'asked again when the card changed');
  } finally { v.dispose(); }
});

test('28h Stage 27 (i), the ux look: a hire that has reported no tokens shows no tokens figure (not "0 tokens" beside a cost), and one that has shows it', async () => {
  const v = await viewOn('R12', { role: 'agents' });
  try {
    await ready(v);
    const hire = { planId: 'p-z', seat: 'developer', task: 'Edit Foo', brain: 'claude', model: '', state: 'done', elapsedMs: 10000, tokens: 0, costUsd: 0.12 };
    await post(v, { sessionUpdate: 'tool_call', toolCallId: 'hz', title: 'hire', status: 'completed', kind: 'other', _meta: { 'jawata/hire': hire } });
    assert.ok(!v.$('.hire[data-plan-id="p-z"] .hire-tokens'), 'a figure nobody reported was drawn as 0 tokens');
    assert.match(v.$('.hire[data-plan-id="p-z"] .hire-cost').textContent, /\$0\.12/, 'the cost it did report still shows');
    await act(async () => { v.port.post({ type: 'hireChanged', hire: { ...hire, tokens: 900 } }); });
    assert.equal(v.$('.hire[data-plan-id="p-z"] .hire-tokens').textContent, '900 tokens');
  } finally { v.dispose(); }
});
