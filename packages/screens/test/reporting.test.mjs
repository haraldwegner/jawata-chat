// The Reporting screen: every sentence it can say, and what it does, on a fake host.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><head></head><body><div id="root"></div></body></html>', { pretendToBeVisual: true });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.IS_REACT_ACT_ENVIRONMENT = false;
// a screen's poll must not keep the test process alive
const realInterval = globalThis.setInterval;
globalThis.setInterval = (...args) => realInterval(...args).unref();

const { reportingView, mountScreen } = await import('../dist/index.js');

const shape = (name, count, posted = false) => ({ shape: name, count, posted });
const healthy = { health: 'healthy', millis: 62 };
const status = (shapes, store = healthy, silenced = false) => ({ pile: { shapes, silenced }, store });

test('with nothing to report the screen says so and gives the store its time', () => {
  const view = reportingView(status([]));
  assert.equal(view.needsALook, false);
  assert.equal(view.verdict, 'Nothing needs a look. Knowledge store answering (62 ms).');
  assert.equal(view.totals, '0 failure shapes recorded · 0 filed · 0 still to report');
});

test('three repeats nobody has filed is worth reporting, two is not, and a filed one is not', () => {
  const view = reportingView(status([shape('a', 3), shape('b', 2), shape('c', 9, true)]));
  assert.equal(view.verdict, 'Needs a look: 1 failure shape worth reporting');
  assert.equal(view.totals, '3 failure shapes recorded · 1 filed · 1 still to report');
});

test('a slow or silent store needs a look, beside the failures', () => {
  assert.equal(reportingView(status([shape('a', 3), shape('b', 4)], { health: 'slow', millis: 1500 })).verdict, 'Needs a look: 2 failure shapes worth reporting · the knowledge store is slow');
  assert.equal(reportingView(status([], { health: 'unavailable', millis: 0 })).verdict, 'Needs a look: the knowledge store is not answering');
});

test('going silent takes failures out of what needs a look, the store still counts, and the totals still say everything', () => {
  const silent = reportingView(status([shape('a', 3), shape('b', 4)], healthy, true));
  assert.equal(silent.needsALook, false);
  assert.equal(silent.verdict, 'Nothing needs a look. Knowledge store answering (62 ms).');
  assert.equal(silent.totals, '2 failure shapes recorded · 0 filed · 2 still to report');
  assert.equal(reportingView(status([shape('a', 3)], { health: 'slow', millis: 1500 }, true)).verdict, 'Needs a look: the knowledge store is slow');
});

test('a store not yet read is said to be so, not called healthy', () => {
  assert.equal(reportingView(status([], { health: 'unknown', millis: 0 })).verdict, 'Nothing needs a look. Knowledge store not checked yet.');
});

test('the list is every shape, most repeated first', () => {
  assert.deepEqual(reportingView(status([shape('less', 1), shape('more', 5)])).shapes.map(one => one.shape), ['more', 'less']);
});

/** A host that answers from the given reading and records what it was asked. */
function fakeHost(reading) {
  const asked = [];
  return {
    asked,
    theme: () => 'dark',
    fieldStatus: async () => { asked.push('fieldStatus'); return reading; },
    fieldSetSilence: async (silenced) => { asked.push(`silence:${silenced}`); return { ...reading, pile: { ...reading.pile, silenced } }; },
  };
}

/** Waits until the condition holds; a render and a promise take their own time on a busy machine. */
async function until(condition, what = 'the screen to settle') {
  for (let i = 0; i < 300; i++) {
    if (condition()) { return; }
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.fail(`timed out waiting for ${what}`);
}

/** Waits until the screen shows more than its first frame. */
const shown = (root) => until(() => root.textContent !== '' && !root.textContent.includes('Reading the recording'));

test('the screen shows the host\'s reading, says nothing leaves the machine, and keeps its detail folded', async () => {
  const root = document.createElement('div');
  document.body.appendChild(root);
  mountScreen(root, fakeHost(status([shape('find_references/references/PROJECT_NOT_LOADED', 4)])), 'reporting');
  await shown(root);
  assert.match(root.textContent, /Needs a look: 1 failure shape worth reporting/);
  assert.match(root.textContent, /Nothing leaves this machine unless you type \/report in the chat to file one from your own GitHub account\./);
  assert.match(root.querySelector('code + span, li code').textContent, /PROJECT_NOT_LOADED/);
  assert.equal(root.querySelector('details').open, false, 'details are closed until opened');
  assert.equal(document.documentElement.dataset.theme, 'dark');
  // the mouseovers, word for word as the ux report's section 5 keeps them
  assert.equal(root.querySelector('summary').title, 'The figures behind the sentence above.');
  assert.equal(root.querySelector('label').title, 'Ticked: failures worth reporting no longer make the first line of this view say that something needs a look. The recording keeps running, and the counts and Details below still show every failure.');
  assert.equal(root.querySelector('p[title]').title, 'A failure shape is a kind of error that repeats: tool, kind of failure and error code, counted per workspace. Worth reporting means seen 3 or more times and not yet filed; type /report in any client to file it.');
  assert.equal(root.querySelector('h3').title, 'Ranked by repeats. Three or more repeats that nobody has filed are what the count in the sentence above counts.');
  assert.equal(root.querySelector('h3').textContent, 'Failure shapes');
  assert.equal(root.querySelector('summary').textContent, 'Details');
  assert.equal(root.querySelector('label').textContent, 'Go silent about failures');
});

test('every failure shape is listed with its count, and a filed one says so', async () => {
  const root = document.createElement('div');
  document.body.appendChild(root);
  mountScreen(root, fakeHost(status([shape('a/b/C', 4), shape('d/e/F', 7, true)])), 'reporting');
  await shown(root);
  const rows = [...root.querySelectorAll('.screen-list li')].map(li => li.textContent);
  assert.deepEqual(rows, ['d/e/F7xfiled', 'a/b/C4x'], 'most repeated first, each with its count, only the filed one flagged');
});

test('with no failure recorded the details say so', async () => {
  const root = document.createElement('div');
  document.body.appendChild(root);
  mountScreen(root, fakeHost(status([])), 'reporting');
  await shown(root);
  assert.equal(root.querySelector('details p').textContent, 'No failures recorded.');
});

test('the switch asks the host and shows what the host then says', async () => {
  const root = document.createElement('div');
  document.body.appendChild(root);
  const host = fakeHost(status([]));
  mountScreen(root, host, 'reporting');
  await shown(root);
  const box = root.querySelector('input[type=checkbox]');
  assert.equal(box.checked, false);
  box.click();
  await until(() => root.querySelector('input[type=checkbox]').checked, 'the switch to show what the host said');
  assert.ok(host.asked.includes('silence:true'), host.asked.join());
  assert.equal(root.querySelector('input[type=checkbox]').checked, true);
});

test('a reading that fails says so instead of showing an empty screen', async () => {
  const root = document.createElement('div');
  document.body.appendChild(root);
  mountScreen(root, { theme: () => 'light', fieldStatus: async () => { throw new Error('no engine'); } }, 'reporting');
  await shown(root);
  assert.match(root.textContent, /Could not read the failure recording: no engine/);
});

test('refresh asks again', async () => {
  const root = document.createElement('div');
  document.body.appendChild(root);
  const host = fakeHost(status([]));
  const handle = mountScreen(root, host, 'reporting');
  await shown(root);
  await handle.refresh();
  assert.equal(host.asked.filter(one => one === 'fieldStatus').length, 2);
});

test('a screen that does not exist says so', async () => {
  const root = document.createElement('div');
  document.body.appendChild(root);
  mountScreen(root, fakeHost(status([])), 'nothing-here');
  await shown(root);
  assert.match(root.textContent, /no screen named nothing-here/);
  // a name an object inherits is not a screen either
  const other = document.createElement('div');
  document.body.appendChild(other);
  mountScreen(other, fakeHost(status([])), 'constructor');
  await shown(other);
  assert.match(other.textContent, /no screen named constructor/);
});

test('a reading that fails after a good one is said, and the old figures are not left saying all is well', async () => {
  const root = document.createElement('div');
  document.body.appendChild(root);
  let fail = false;
  const handle = mountScreen(root, { theme: () => 'light', fieldStatus: async () => { if (fail) { throw new Error('engine stopped'); } return status([]); } }, 'reporting');
  await shown(root);
  fail = true;
  await handle.refresh();
  await until(() => root.textContent.includes('Could not read the failure recording: engine stopped'), 'the failure');
});

test('a slow store says why and above what, a silent one says why, and the switch says when it is off by choice', async () => {
  assert.equal(reportingView(status([], { health: 'slow', millis: 1500, why: 'a recall took 1500 ms', slowAboveMillis: 1200 })).caveat, 'a recall took 1500 ms (over 1200 ms)');
  assert.equal(reportingView(status([], { health: 'unavailable', millis: 0, why: 'the store is locked' })).caveat, 'the store is locked');
  assert.equal(reportingView(status([])).caveat, '');
  const root = document.createElement('div');
  document.body.appendChild(root);
  mountScreen(root, fakeHost(status([], healthy, true)), 'reporting');
  await shown(root);
  assert.match(root.querySelector('label').textContent, /Go silent about failures \(currently off by your choice\)/);
});
