// 28h dogfood S19-3 (his words 2026-11-17: when he has scrolled up and new output arrives, the chat jumps to the last line): the list follows
// the output only while he is at the bottom of it, and his own message always takes him there. A file of its own: render.test.mjs is at its
// budget of time. jsdom lays nothing out, so the list's sizes are given to it here.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { act, closeDom, viewOn, sleep } from './dom.mjs';

after(closeDom);

const turnEnded = (v) => v.$('.turn .message.assistant') && !v.$('.send-stop-btn.stop');

/** The message list with a height of its own: `grow` makes the content taller, `scrollTo` moves the person's position and tells the list. */
function sized(el) {
  const state = { scrollHeight: 1000, scrollTop: 600 };
  Object.defineProperty(el, 'clientHeight', { configurable: true, get: () => 400 });
  Object.defineProperty(el, 'scrollHeight', { configurable: true, get: () => state.scrollHeight });
  Object.defineProperty(el, 'scrollTop', { configurable: true, get: () => state.scrollTop, set: (value) => { state.scrollTop = value; } });
  return {
    state,
    grow: (to) => { state.scrollHeight = to; },
    scrollTo: (top) => { state.scrollTop = top; el.dispatchEvent(new window.Event('scroll')); },
  };
}

const outputArrives = (v, text) => act(async () => {
  v.port.post({ type: 'sessionUpdate', sessionId: 'x', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } } });
  await sleep(20);
});

test('28h S19-3: output that arrives while he has scrolled up leaves the list where it is; at the bottom the list still follows; his own message takes him to the bottom', async () => {
  const v = await viewOn('R1');
  try {
    await v.connect();
    await v.settle();
    await v.type('hello');
    await v.key('Enter');
    await v.settle(() => turnEnded(v));
    const list = sized(v.$('.messages'));

    list.scrollTo(100); // he scrolls up to read something
    list.grow(1400);
    await outputArrives(v, ' more words');
    assert.equal(list.state.scrollTop, 100, 'the list stays where he put it while the output arrives');

    list.scrollTo(1000); // he is back at the bottom (1400 - 1000 - 400 = 0)
    list.grow(1800);
    await outputArrives(v, ' and more');
    assert.equal(list.state.scrollTop, 1800, 'at the bottom the list follows the output');

    list.scrollTo(100); // up again
    await v.type('and now I speak');
    await v.key('Enter');
    await v.settle(() => turnEnded(v));
    assert.equal(list.state.scrollTop, list.state.scrollHeight, 'his own message takes him to the bottom, where the answer comes');
  } finally { v.dispose(); }
});
