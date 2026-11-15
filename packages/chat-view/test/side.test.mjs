// CR3, the side thread (R13: after the first turn a second session is opened beside the first and asked one question). The thread is the
// view of `state.side`: a button opens its composer, the answer shows in the thread, and the conversation above does not change.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { act, closeDom, viewOn } from './dom.mjs';

after(closeDom);

const sent = (v, method) => v.host.traffic.filter(t => t.direction === 'send' && t.message.method === method).map(t => t.message.params);
/** Type into the side composer (the harness types into the first text field, which is this one once the thread is open). */
async function typeSide(v, value) {
  const el = v.$('.side-composer textarea');
  const win = el.ownerDocument.defaultView;
  await act(async () => {
    Object.getOwnPropertyDescriptor(win.HTMLTextAreaElement.prototype, 'value').set.call(el, value);
    el.dispatchEvent(new win.Event('input', { bubbles: true }));
  });
}
async function enterSide(v) {
  const el = v.$('.side-composer textarea');
  const win = el.ownerDocument.defaultView;
  await act(async () => { el.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); });
}

test('R13: the side panel answers in a session of its own, and the conversation is told nothing', async () => {
  const v = await viewOn('R13', { role: 'side' });
  try {
    await v.connect();
    await v.settle();
    await act(async () => { await v.chat.handle({ type: 'sendPrompt', text: 'first question' }); });
    await v.settle();
    await typeSide(v, 'How many files did you just read?');
    await enterSide(v);
    await v.settle(() => v.$('.side-thread .turn'));
    assert.match(v.$('.side-thread .side-entries').textContent, /How many files did you just read\?/);
    assert.match(v.$('.side-thread .turn').textContent, /None\. This answer comes from the side thread\./);
    assert.equal(sent(v, 'session/new').length, 2, 'a second session was opened');
    const prompts = sent(v, 'session/prompt');
    assert.equal(prompts.at(-1).prompt[0].text, 'How many files did you just read?');
    assert.notEqual(prompts.at(-1).sessionId, prompts[0].sessionId, 'the side question went to the second session, not the first');
  } finally { v.dispose(); }
});

test('the chat is not told /btw: it opens the side panel and its text is the side question', async () => {
  const v = await viewOn('R13');
  try {
    await v.connect();
    await v.settle();
    await v.type('/btw does this work?');
    await v.key('Enter');
    await v.settle(() => v.host.asked.includes('showSide'));
    assert.ok(v.host.asked.includes('showSide'), 'the panel is asked for');
    await v.settle(() => sent(v, 'session/prompt').length > 0);
    assert.equal(sent(v, 'session/prompt').at(-1).prompt[0].text, 'does this work?');
    assert.equal(v.$$('.messages .message.user').length, 0, 'nothing of it stands in the conversation');
  } finally { v.dispose(); }
});

test('D53 (b): the shortcut sends what is in the field as the side question and empties it', async () => {
  const v = await viewOn('R13');
  try {
    await v.connect();
    await v.settle();
    await v.type('what stands in the field');
    await v.key('s', { ctrlKey: true, altKey: true });
    await v.settle(() => sent(v, 'session/prompt').length > 0);
    assert.ok(v.host.asked.includes('showSide'), 'the panel is asked for');
    assert.equal(sent(v, 'session/prompt').at(-1).prompt[0].text, 'what stands in the field');
    assert.equal(v.$('textarea').value, '', 'the question stayed in the field');
    assert.equal(v.$$('.messages .message.user').length, 0, 'nothing of it stands in the conversation');
  } finally { v.dispose(); }
});

test('the Side question button opens the panel, and an empty field asks nothing', async () => {
  const v = await viewOn('R13');
  try {
    await v.connect();
    await v.settle();
    await v.click(v.$$('.tool-btn').find(b => b.textContent === 'Side question'));
    await v.settle(() => v.host.asked.includes('showSide'));
    assert.deepEqual(v.host.asked.filter(a => a === 'showSide'), ['showSide']);
    assert.equal(sent(v, 'session/prompt').length, 0);
  } finally { v.dispose(); }
});
