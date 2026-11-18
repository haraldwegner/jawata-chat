// His rulings, 2026-11-18, on the History panel: it lists the person's conversations from every client and says which client each came from; the
// next ten come on a "Show more"; Esc closes it (it has its own Close button and is not a dropdown, so a click beside it does not), and Esc closes
// only the topmost open thing, so Esc with the model list open closes the list and leaves History.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { act, closeDom, viewOn } from './dom.mjs';

after(closeDom);

const ROWS = [
  { sessionId: 'a', title: 'Fix the build', updatedAt: '2026-11-18T09:00:00Z', client: 'claude-code', clientName: 'Claude Code' },
  { sessionId: 'b', title: 'Rename the class', updatedAt: '2026-11-18T08:00:00Z', client: 'cursor', clientName: 'Cursor' },
  { sessionId: 'c', title: 'Are you there?', updatedAt: '2026-11-16T19:51:00Z', client: 'jawata-agent', clientName: 'jawata' },
];

async function withHistory(role = 'chat') {
  const v = await viewOn('R5', { role });
  await v.connect();
  await v.settle();
  await act(async () => { v.port.post({ type: 'sessionList', sessions: ROWS, nextCursor: 'cursor-1', append: false, show: true }); });
  return v;
}

const escape = () => act(async () => { document.body.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); });

test('each row says which client the conversation came from', async () => {
  const v = await withHistory();
  try {
    assert.deepEqual(v.$$('.history-item .history-client').map(e => e.textContent), ['Claude Code', 'Cursor', 'jawata']);
  } finally { v.dispose(); }
});

test('a "Show more" asks for the next page with the cursor the agent gave', async () => {
  const v = await withHistory();
  try {
    const intents = [];
    const deliver = v.port.deliver.bind(v.port);
    v.port.deliver = async (intent) => { intents.push(intent); await deliver(intent); };
    const more = v.$('.history-more');
    assert.ok(more, 'the button is there while the agent says there are more');
    assert.match(more.textContent, /Show more/);
    await v.click(more);
    assert.ok(intents.some(i => i.type === 'listSessions' && i.cursor === 'cursor-1'), JSON.stringify(intents));
    await act(async () => { v.port.post({ type: 'sessionList', sessions: [{ sessionId: 'd', title: 'Older', client: 'claude-code' }], nextCursor: null, append: true }); });
    assert.equal(v.$$('.history-item').length, 4, 'the next page is added below');
    assert.ok(!v.$('.history-more'), 'and the button goes when there are no more');
  } finally { v.dispose(); }
});

test('Esc closes the History panel wherever the focus is', async () => {
  const v = await withHistory();
  try {
    assert.ok(v.$('.history'));
    await escape();
    assert.ok(!v.$('.history'), 'Esc closed it');
  } finally { v.dispose(); }
});

test('a click beside the History panel does not close it, and its Close button does', async () => {
  const v = await withHistory();
  try {
    await act(async () => { document.body.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true })); });
    assert.ok(v.$('.history'), 'it is a panel with its own Close, not a dropdown');
    await v.click(v.$('.history-close'));
    assert.ok(!v.$('.history'));
  } finally { v.dispose(); }
});

test('Esc closes only the topmost open thing: the model list first, then History', async () => {
  const v = await withHistory();
  try {
    await v.click(v.$('.input-toolbar .principal-brain'));
    assert.ok(v.$('.brain-menu') && v.$('.history'), 'both are open');
    await escape();
    assert.ok(!v.$('.brain-menu'), 'the model list closed');
    assert.ok(v.$('.history'), 'and History stayed');
    await escape();
    assert.ok(!v.$('.history'), 'the next Esc closed History');
  } finally { v.dispose(); }
});
