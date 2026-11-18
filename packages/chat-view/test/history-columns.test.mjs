// Stage 27 (n), his rulings 2026-11-18: the History list is read at a glance. Four columns in this order: the client's full name (one width for
// every row, never wrapped), the title (left-aligned, cut with "…"), the first 8 characters of the session id (quiet), and the date. The hover shows
// the full title, the full id and the exact time. A click on the id copies the full id and says "Copied" without opening the session; a click on
// the rest of the row opens it. The date is chosen by distance, not by calendar year, so a Dec 30 row read on Jan 2 shows no year.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { act, closeDom, viewOn } from './dom.mjs';
import { whenIs } from '../dist/when.js';

after(closeDom);

const ID = '3f9c2a10-5b7e-4d21-9a44-0c1d2e3f4a55';
const ROWS = [
  { sessionId: ID, title: 'Fix the build and then the release notes, which are very long indeed', updatedAt: '2026-11-18T09:00:00Z', client: 'claude-code', clientName: 'Claude Code' },
  { sessionId: 'b1b2b3b4-0000-4000-8000-000000000001', title: 'Short', updatedAt: '2026-11-16T19:51:00Z', client: 'jawata-agent', clientName: 'jawata' },
];

async function withHistory() {
  const v = await viewOn('R5', { role: 'chat' });
  await v.connect();
  await v.settle();
  await act(async () => { v.port.post({ type: 'sessionList', sessions: ROWS, nextCursor: null, append: false, show: true }); });
  return v;
}

test('each row has the four columns in the ruled order, the id cut to its first 8 characters', async () => {
  const v = await withHistory();
  try {
    const first = v.$('.history-item');
    assert.deepEqual([...first.children].map(c => c.className.replace(/ .*/, '')), ['history-client', 'history-name', 'history-id', 'history-when']);
    assert.equal(first.querySelector('.history-id').textContent, '3f9c2a10', 'the id shows its first 8 characters');
  } finally { v.dispose(); }
});

test('the client column is one width for every row, the length of the longest name', async () => {
  const v = await withHistory();
  try {
    const width = v.$('.history').style.getPropertyValue('--history-client-width');
    assert.equal(width, `${'Claude Code'.length}ch`, 'the width is the longest client name, so no name wraps and the titles line up');
  } finally { v.dispose(); }
});

test('the hover of a row shows the full title, the full id and the exact time', async () => {
  const v = await withHistory();
  try {
    const hover = v.$('.history-item').getAttribute('title');
    assert.ok(hover.includes('Fix the build and then the release notes, which are very long indeed'), hover);
    assert.ok(hover.includes(ID), hover);
    assert.ok(hover.includes('2026-11-18T09:00:00Z'), hover);
  } finally { v.dispose(); }
});

test('a click on the id copies the full id, says Copied and does not open the session; a click elsewhere on the row opens it', async () => {
  const v = await withHistory();
  try {
    const copied = [];
    Object.defineProperty(globalThis.navigator, 'clipboard', { value: { writeText: async (text) => { copied.push(text); } }, configurable: true });
    const intents = [];
    const deliver = v.port.deliver.bind(v.port);
    v.port.deliver = async (intent) => { intents.push(intent); await deliver(intent); };
    await v.click(v.$('.history-item .history-id'));
    assert.deepEqual(copied, [ID], 'the full 36-character id was copied');
    assert.match(v.$('.history-item .history-id').textContent, /Copied/);
    assert.ok(!intents.some(i => i.type === 'openSession'), 'the click on the id opened the session');
    await v.click(v.$('.history-item .history-name'));
    assert.ok(intents.some(i => i.type === 'openSession' && i.sessionId === ID), JSON.stringify(intents));
  } finally { v.dispose(); }
});

test('the date is chosen by distance: Today, Yesterday, month and day within about six months, and the year beyond', () => {
  const now = new Date(2026, 0, 2, 14, 0); // Jan 2, 2026, 2 PM, local
  const at = (y, m, d, h, min) => new Date(y, m, d, h, min).toISOString();
  assert.match(whenIs(at(2026, 0, 2, 1, 39), now), /^Today 1:39\s?AM$/);
  assert.match(whenIs(at(2026, 0, 1, 21, 14), now), /^Yesterday 9:14\s?PM$/);
  const dec30 = whenIs(at(2025, 11, 30, 21, 14), now);
  assert.match(dec30, /^Dec 30, 9:14\s?PM$/, `a Dec 30 row read on Jan 2 shows no year: ${dec30}`);
  assert.match(whenIs(at(2025, 3, 1, 9, 0), now), /^Apr 1, 2025$/, 'beyond about six months the year is shown and the time is not');
  assert.equal(whenIs('not a time', now), 'not a time', 'what the agent sent when it is not a time');
});

test('the id hover says what the id identifies: only a Claude Code id is the one claude --resume takes', async () => {
  const v = await withHistory();
  try {
    const [claude, jawata] = v.$$('.history-item .history-id').map(e => e.getAttribute('title'));
    assert.match(claude, /claude --resume/);
    assert.ok(!/claude --resume/.test(jawata) && /may not take it/.test(jawata), jawata);
  } finally { v.dispose(); }
});
