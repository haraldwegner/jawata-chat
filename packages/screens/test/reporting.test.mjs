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
  assert.notEqual(root.querySelector('summary').title, '', 'the fold has its mouseover');
  assert.match(root.querySelector('label').title, /recording itself keeps running/);
  assert.match(root.querySelector('p[title]').title, /seen 3 or more times/);
  assert.match(root.querySelector('h3').title, /Ranked by repeats/);
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
});
