// The profile page renders what a ProfileSource answers, with no editor running: a DOM in node and a source that records what it was asked.
import { JSDOM } from 'jsdom';
import { act } from 'react';
import { after, test } from 'node:test';
import assert from 'node:assert/strict';

const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/', pretendToBeVisual: true });
const { window } = dom;
globalThis.window = window;
globalThis.document = window.document;
Object.defineProperty(globalThis, 'navigator', { value: window.navigator, configurable: true });
for (const key of Object.getOwnPropertyNames(window)) {
  if (!(key in globalThis)) { try { globalThis[key] = window[key]; } catch { /* a read-only global */ } }
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
after(() => window.close());

const { mountProfileView } = await import('../dist/index.js');

const where = { uri: 'file:///w/Target', range: { start: { line: 63, character: 17 }, end: { line: 63, character: 30 } } };
const answer = {
  dimension: 'cpu', totalSamples: 40, totalMethods: 2,
  rows: [
    { symbol: 'com.example.debug.DebugTarget#computeSignal', samples: 30, sharePercent: 75, location: where },
    { symbol: 'java.lang.Thread#sleep', samples: 10, sharePercent: 25 },
  ],
};

async function shown(source) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  let mounted;
  await act(async () => { mounted = mountProfileView(container, source); });
  return {
    container,
    $: (selector) => container.querySelector(selector),
    $$: (selector) => [...container.querySelectorAll(selector)],
    click: async (element) => { await act(async () => { element.dispatchEvent(new window.MouseEvent('click', { bubbles: true })); }); },
    dispose: () => { act(() => mounted.dispose()); container.remove(); },
  };
}

test('before anything is recorded the page says how to start, and nothing is asked of the host', async () => {
  const asked = [];
  const v = await shown({ sample: async r => { asked.push(r); return answer; }, open() {} });
  try {
    assert.match(v.$('.profile-empty').textContent, /Record the running program/);
    assert.equal(v.$$('.profile-row').length, 0);
    assert.deepEqual(asked, []);
  } finally { v.dispose(); }
});

test('Record asks the host for the seconds and measure chosen, and shows the ranking with each method\'s measure and share', async () => {
  const asked = [];
  const v = await shown({ sample: async r => { asked.push(r); return answer; }, open() {} });
  try {
    await v.click(v.$('.profile-record'));
    assert.deepEqual(asked, [{ seconds: 5, dimension: 'cpu' }]);
    const rows = v.$$('.profile-row');
    assert.equal(rows.length, 2);
    assert.match(rows[0].textContent, /computeSignal.*30 samples.*75%/);
    assert.match(rows[1].textContent, /Thread#sleep.*10 samples.*25%/);
  } finally { v.dispose(); }
});

test('a method with a source is a button that opens it, and one without is plain text that says why', async () => {
  const opened = [];
  const v = await shown({ sample: async () => answer, open: l => opened.push(l) });
  try {
    await v.click(v.$('.profile-record'));
    assert.equal(v.$$('.profile-open').length, 1);
    assert.equal(v.$$('.profile-nosource').length, 1);
    assert.match(v.$('.profile-nosource').title, /no source in the workspace/);
    await v.click(v.$('.profile-open'));
    assert.deepEqual(opened, [where], 'the click hands the host the row\'s own location');
  } finally { v.dispose(); }
});

test('a recording that fails shows the reason and offers to record again', async () => {
  const v = await shown({ sample: async () => { throw new Error('no such session'); }, open() {} });
  try {
    await v.click(v.$('.profile-record'));
    assert.match(v.$('.profile-failed').textContent, /no such session/);
    assert.equal(v.$('.profile-record').disabled, false);
  } finally { v.dispose(); }
});

test('elapsed time is shown in milliseconds, and an empty recording says so instead of showing an empty table', async () => {
  const wall = { dimension: 'wall', totalSamples: 0, totalMethods: 1, rows: [{ symbol: 'a.B#c', wallMillis: 1200, sharePercent: 100 }] };
  const v = await shown({ sample: async () => wall, open() {} });
  try {
    await v.click(v.$('.profile-record'));
    assert.match(v.$('.profile-row').textContent, /1200 ms/);
  } finally { v.dispose(); }
  const none = await shown({ sample: async () => ({ dimension: 'cpu', totalSamples: 0, totalMethods: 0, rows: [] }), open() {} });
  try {
    await none.click(none.$('.profile-record'));
    assert.match(none.$('.profile-empty').textContent, /no methods/);
    assert.equal(none.$$('table').length, 0);
  } finally { none.dispose(); }
});
