// The Seats and Workflow screens: their groups, rows and choices, and what each control asks of a fake host.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', { pretendToBeVisual: true });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.IS_REACT_ACT_ENVIRONMENT = false;

const { brainOptions, canDrop, firstSentence, mountScreen, seatGroups, seatName } = await import('../dist/index.js');

const seat = (name, extra = {}) => ({ name, command: null, purpose: `${name} does one job. And more.`, when: 'when asked', on: true,
  brain: 'claude-code', model: null, customised: false, acceptsUncontainedWrites: false, ...extra });
const brain = (id, extra = {}) => ({ id, label: id.toUpperCase(), installed: true, login: 'loggedIn', reason: null, loginCommand: `${id} login`,
  models: null, hirable: true, takesModel: true, writesHeldByInstruction: false, ...extra });
const seats = [seat('main', { command: 'main' }), seat('architect', { command: 'refactor' }), seat('cataloguer'), seat('spec-editor'), seat('btw')];

test('the seats are in four groups by how a person reaches them, the conversation ones first', () => {
  const groups = seatGroups({ seats, errors: [] });
  assert.deepEqual(groups.map(group => [group.title, group.seats.map(one => one.name)]), [
    ['Who you talk to', ['btw', 'main']], ['You type these', ['architect']], ['Another seat hires these', ['cataloguer']], ['Inside /sprint', ['spec-editor']],
  ]);
});

test('a seat is named with the command a person types, and its row shows the first sentence of what it does', () => {
  assert.equal(seatName(seat('architect', { command: 'refactor' })), 'architect (/refactor)');
  assert.equal(seatName(seat('cataloguer')), 'cataloguer');
  assert.equal(firstSentence('Reviews the design. Proposes refactorings.'), 'Reviews the design.');
});

test('the brain list offers what a hire can start here, with its models, and always the saved choice', () => {
  const options = brainOptions(seat('cataloguer', { brain: 'grok' }), [brain('claude-code', { models: ['opus'] }), brain('codex', { takesModel: false }),
    brain('cursor', { installed: false })]);
  assert.deepEqual(options.map(option => option.value), ['grok|', 'claude-code|', 'claude-code|opus', 'codex|']);
  assert.match(options[0].label, /not available on this machine/);
  assert.match(options[3].label, /chooses its own model/);
});

test('a brain whose writes only an instruction holds is offered only to a seat whose file accepts it, as a hire refuses it elsewhere', () => {
  const roster = [brain('codex'), brain('cursor', { writesHeldByInstruction: true })];
  assert.deepEqual(brainOptions(seat('cataloguer', { brain: 'codex' }), roster).map(option => option.value), ['codex|'], 'cursor is not offered');
  assert.deepEqual(brainOptions(seat('btw', { brain: 'codex', acceptsUncontainedWrites: true }), roster).map(option => option.value), ['codex|', 'cursor|']);
});

/** A host that holds changes as the Eclipse page does, and records what it was asked. */
function fakeHost({ probeOk = true, refuse = '' } = {}) {
  let rows = seats.map(one => ({ ...one }));
  const asked = [];
  return {
    asked,
    theme: () => 'light',
    seatsView: async () => ({ seats: rows, errors: [], refusals: [] }),
    brainsStatus: async () => [brain('claude-code'), brain('codex')],
    brainProbe: async (id, model) => { asked.push(`probe:${id}:${model}`); return { brain: id, ok: probeOk, answer: probeOk ? 'OK' : null, modelsUsed: [], costUsd: null, seconds: 1.2, error: probeOk ? null : 'not logged in', loginCommand: `${id} login` }; },
    seatChange: async (name, change) => {
      asked.push(`change:${name}:${JSON.stringify(change)}`);
      if (refuse) { throw new Error(refuse); }
      rows = rows.map(one => one.name !== name ? one
        : change.setting === 'enabled' ? { ...one, on: change.value, customised: true }
          : change.setting === 'brain' ? { ...one, brain: change.brain, model: change.model, customised: true }
            : change.setting === 'reset' ? { ...seats.find(original => original.name === name) } : one);
      return { seats: rows, errors: [], refusals: [] };
    },
  };
}

async function until(condition, what) {
  for (let i = 0; i < 300; i++) {
    if (condition()) { return; }
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.fail(`timed out waiting for ${what}`);
}

const rowOf = (root, name) => [...root.querySelectorAll('.seat-line')].find(line => line.querySelector('.seat-name').textContent.startsWith(name));

test('the switch is held through the host and the row shows it, with Reset offered once the seat is changed', async () => {
  const root = document.createElement('div');
  document.body.appendChild(root);
  const host = fakeHost();
  mountScreen(root, host, 'seats');
  await until(() => rowOf(root, 'architect'), 'the seats');
  assert.equal(rowOf(root, 'architect').querySelector('label').title,
    'Ticked: /refactor is offered in the chat\'s / list and the seat can be hired. Unticked: it is not offered and a hire of it is refused. The seat itself is kept. Takes effect on Apply.');
  assert.equal(rowOf(root, 'cataloguer').querySelector('input[type=checkbox]'), null, 'a seat with no command has no switch');
  assert.equal(rowOf(root, 'architect').querySelector('button'), null, 'nothing to reset yet');
  rowOf(root, 'architect').querySelector('input[type=checkbox]').click();
  await until(() => rowOf(root, 'architect').className.includes('seat-off'), 'the switch to be shown off');
  assert.ok(host.asked.includes('change:architect:{"setting":"enabled","value":false}'), host.asked.join());
  rowOf(root, 'architect').querySelector('button').click();
  await until(() => !rowOf(root, 'architect').className.includes('seat-off'), 'Reset to take the change back');
  assert.ok(host.asked.includes('change:architect:{"setting":"reset"}'), host.asked.join());
});

test('each name\'s mouseover says how the person reaches that seat: typed, opened on its own, or hired', async () => {
  const root = document.createElement('div');
  document.body.appendChild(root);
  mountScreen(root, fakeHost(), 'seats');
  await until(() => rowOf(root, 'btw'), 'the seats');
  const title = name => rowOf(root, name).querySelector('.seat-name').title;
  assert.equal(title('architect'), 'Type /refactor in the chat to run this seat.');
  assert.equal(title('btw'), 'Nobody hires it: it starts when asked.', 'the side discussion is not hired');
  assert.equal(title('cataloguer'), 'Has no command. Another seat hires it for a job, gives it a brief, and checks what it returns.');
  root.remove();
});

test('each reading of the page asks the brains again, so a brain installed or logged into meanwhile is offered', async () => {
  const root = document.createElement('div');
  document.body.appendChild(root);
  const host = fakeHost();
  let asked = 0;
  const brains = host.brainsStatus;
  host.brainsStatus = async ids => { asked += 1; return brains(ids); };
  const handle = mountScreen(root, host, 'seats');
  await until(() => asked === 1 && rowOf(root, 'architect'), 'the first reading');
  await handle.refresh();
  assert.equal(asked, 2, 'the refresh the host makes on focus asked the brains again');
  root.remove();
});

test('a brain is kept only after a test run answered; one that did not answer leaves the choice as it was', async () => {
  for (const probeOk of [true, false]) {
    const root = document.createElement('div');
    document.body.appendChild(root);
    const host = fakeHost({ probeOk });
    mountScreen(root, host, 'seats');
    await until(() => rowOf(root, 'cataloguer')?.querySelector('select'), 'the brain list');
    const select = rowOf(root, 'cataloguer').querySelector('select');
    select.value = 'codex|';
    select.dispatchEvent(new window.Event('change', { bubbles: true }));
    await until(() => host.asked.some(one => one.startsWith('probe:codex')) && rowOf(root, 'cataloguer').textContent.match(/Tested|did not answer/), 'the test run');
    assert.equal(host.asked.some(one => one.startsWith('change:cataloguer')), probeOk, host.asked.join());
    if (!probeOk) { assert.match(rowOf(root, 'cataloguer').textContent, /To log in, run codex login in a terminal/); }
  }
});

test('a change the engine refuses shows the engine\'s words', async () => {
  const root = document.createElement('div');
  document.body.appendChild(root);
  mountScreen(root, fakeHost({ refuse: 'no seat named \'architect\'' }), 'seats');
  await until(() => rowOf(root, 'architect'), 'the seats');
  rowOf(root, 'architect').querySelector('input[type=checkbox]').click();
  await until(() => root.textContent.includes('architect: no seat named'), 'the refusal');
});

const place = (name, parent, extra = {}) => ({ name, command: null, parent, role: 'worker', escalatesTo: null, placed: false, helper: null, ...extra });
const tree = [place('main', null, { role: 'lead' }), place('pm', 'main', { role: 'lead' }), place('developer', 'pm'), place('architect', 'main', { command: 'refactor' }),
  place('report', null, { command: 'report', helper: 'Starts when you type /report.' })];

test('a seat cannot be dropped onto itself, where it already is, or under a seat below it', () => {
  assert.equal(canDrop('pm', 'pm', tree), false);
  assert.equal(canDrop('developer', 'pm', tree), false);
  assert.equal(canDrop('pm', 'developer', tree), false);
  assert.equal(canDrop('developer', 'architect', tree), true);
});

test('the chart opens locked, unlocking lets a role change, and a refused move shows the engine\'s reason', async () => {
  const root = document.createElement('div');
  document.body.appendChild(root);
  const asked = [];
  let refuse = '';
  const host = {
    theme: () => 'light',
    workflowView: async () => ({ rows: tree, errors: [], refusals: [] }),
    seatChange: async (name, change) => { asked.push(`${name}:${JSON.stringify(change)}`); if (refuse) { throw new Error(refuse); } return { rows: tree, errors: [], refusals: [] }; },
  };
  mountScreen(root, host, 'workflow');
  await until(() => root.querySelector('.wf-box'), 'the chart');
  assert.match(root.querySelector('.wf-helpers').textContent, /Helpers\/report/);
  // the two lines 28h's studio put under the chart's title (D56), carried over at 28k Stage 25l
  const lines = [...root.querySelectorAll('.screen > p')].map(line => line.textContent);
  assert.ok(lines[0].startsWith('Who hires whom: each seat sits under the seat that hires it'), lines.join(' | '));
  assert.ok(lines[1].startsWith('Unlock to change it: drag a seat onto another'), lines.join(' | '));
  const role = [...root.querySelectorAll('.wf-box')].find(box => box.textContent.startsWith('developer')).querySelector('.wf-role');
  assert.equal(role.disabled, true, 'locked: a role cannot be changed');
  [...root.querySelectorAll('button')].find(button => button.textContent === 'Locked').click();
  await until(() => !role.disabled, 'the unlock');
  refuse = 'the engine would refuse this tree: a worker cannot hire';
  role.click();
  await until(() => root.textContent.includes('the engine would refuse this tree'), 'the refusal');
  assert.deepEqual(asked, ['developer:{"setting":"workflow","parent":"pm","role":"reviewer","escalatesTo":null}']);
});

test('a stored tree the engine refused is said with why the default tree is shown, and a helper that names no start says it starts on its own', async () => {
  const root = document.createElement('div');
  document.body.appendChild(root);
  const rows = [...tree, place('review', null, { command: 'review', helper: '' })];
  mountScreen(root, { theme: () => 'light', workflowView: async () => ({ rows, errors: [], refusals: ['architect: its parent \'nobody\' is no seat'] }) }, 'workflow');
  await until(() => root.querySelector('.wf-box'), 'the chart');
  const refusal = [...root.querySelectorAll('p')].find(line => line.textContent.includes('is no seat'));
  assert.equal(refusal.title, 'The engine refuses a tree that breaks a rule and uses the default one in its place.');
  const review = [...root.querySelectorAll('.wf-helper')].find(helper => helper.textContent === '/review');
  assert.equal(review.title, 'Not hired: it starts on its own.');
  root.remove();
});
