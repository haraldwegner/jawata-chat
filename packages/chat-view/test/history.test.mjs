// History in the view (R6): the agent's own list, and a listed session opened into the chat.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { closeDom, viewOn, sessionFile } from './dom.mjs';

after(closeDom);

const recorded = readFileSync(sessionFile('R6'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
const listed = recorded.find(l => l.dir === 'recv' && l.msg.result?.sessions).msg.result.sessions;

test('R6: with no session the empty state offers History; it lists what the agent listed, and a listed session opens and shows its turns', async () => {
  const v = await viewOn('R6');
  try {
    assert.ok(!v.$('.history'), 'closed until asked for');
    await v.click(v.$('.empty-state .history-open'));
    await v.settle(() => v.$('.history-item'));
    const items = v.$$('.history-item');
    assert.equal(items.length, listed.length, 'one row per session the agent lists');
    assert.equal(items[0].querySelector('.history-name').textContent, 'Pong');
    assert.match(items[0].getAttribute('title'), /Open this session/);
    const when = items[0].querySelector('.history-when');
    assert.ok(when && !/T\d\d:\d\d/.test(when.textContent), `the time is read as a date, not as the agent's text: ${when?.textContent}`);
    assert.match(when.getAttribute('title'), /\d{4}-\d\d-\d\dT/, 'the exact value is the mouseover');
    await v.click(items[0]);
    await v.settle(() => v.$('.message.user') && v.$('.turn'));
    assert.ok(v.$('.message.user'), 'the earlier prompt is shown');
    assert.ok(v.$('.turn .message.assistant'), 'and its answer');
    assert.ok(!v.$('.history'), 'the list closes when a session is opened');
    assert.equal(v.sessions.getActiveSessionId(), listed[0].sessionId);
  } finally { v.dispose(); }
});

test('with a session open, the banner offers History too, and the open one is marked', async () => {
  const v = await viewOn('R6');
  try {
    await v.click(v.$('.empty-state .history-open'));
    await v.settle(() => v.$('.history-item'));
    await v.click(v.$('.history-item'));
    await v.settle(() => v.$('.session-banner.visible'));
    await v.click(v.$('.session-banner .history-btn'));
    await v.settle(() => v.$('.history-item.current'));
    assert.equal(v.$$('.history-item.current').length, 1);
    await v.click(v.$('.history-close'));
    assert.ok(!v.$('.history'));
  } finally { v.dispose(); }
});

test('a list the agent cut into pages offers More, which asks for the next page and adds it', async () => {
  const v = await viewOn('R6');
  try {
    await v.click(v.$('.empty-state .history-open'));
    await v.settle(() => v.$('.history-item')); // the agent's own answer has come; what follows replaces it
    const asked = [];
    const deliver = v.port.deliver.bind(v.port);
    v.port.deliver = async (i) => { asked.push(i); };
    await act_post(v, { type: 'sessionList', sessions: [{ sessionId: 'a', title: 'A' }], nextCursor: 'c1', append: false });
    await v.click(v.$('.history-more'));
    assert.deepEqual(asked.filter(i => i.cursor), [{ type: 'listSessions', cursor: 'c1' }]);
    v.port.deliver = deliver;
    await act_post(v, { type: 'sessionList', sessions: [{ sessionId: 'b', title: 'B' }], nextCursor: null, append: true });
    assert.deepEqual(v.$$('.history-name').map(e => e.textContent), ['A', 'B']);
    assert.ok(!v.$('.history-more'), 'no more when the agent has no more');
  } finally { v.dispose(); }
});

async function act_post(v, message) {
  const { act } = await import('./dom.mjs');
  await act(async () => { v.port.post(message); });
}
