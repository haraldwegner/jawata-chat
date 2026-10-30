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

test('R13: the side thread is a button until it is used; a question is answered in the thread and the conversation above is exactly as it was', async () => {
  const v = await viewOn('R13');
  try {
    await v.connect();
    await v.settle();
    assert.ok(v.$('button.side-open-btn'), 'a button offers the side question');
    assert.ok(!v.$('.side-thread'), 'no thread until it is asked for');
    await v.type('first question');
    await v.key('Enter');
    await v.settle(() => v.$('.messages .turn .message.assistant'));
    await v.settle();
    const before = v.$('.messages').innerHTML;
    assert.ok(before.includes('turn'), 'the conversation holds the first turn');

    await v.click(v.$('button.side-open-btn'));
    assert.ok(v.$('.side-thread'), 'the thread opens');
    await typeSide(v, 'How many files did you just read?');
    await enterSide(v);
    await v.settle(() => v.$('.side-thread .turn'));
    assert.match(v.$('.side-thread .side-entries').textContent, /How many files did you just read\?/);
    assert.match(v.$('.side-thread .turn').textContent, /None\. This answer comes from the side thread\./);
    assert.equal(sent(v, 'session/new').length, 2, 'a second session was opened');
    const prompts = sent(v, 'session/prompt');
    assert.equal(prompts.at(-1).prompt[0].text, 'How many files did you just read?');
    assert.notEqual(prompts.at(-1).sessionId, prompts[0].sessionId, 'the side question went to the second session, not the first');
    assert.equal(v.$('.messages').innerHTML, before, 'the conversation shows nothing of the side question or its answer');
  } finally { v.dispose(); }
});

test('R13: closing the thread forgets it and puts the button back', async () => {
  const v = await viewOn('R13');
  try {
    await v.connect();
    await v.settle();
    await v.click(v.$('button.side-open-btn'));
    await typeSide(v, 'a question');
    await enterSide(v);
    await v.settle(() => v.$('.side-thread .turn'));
    await v.click(v.$('.side-close-btn'));
    await v.settle(() => !v.$('.side-thread'));
    assert.ok(!v.$('.side-thread'));
    assert.ok(v.$('button.side-open-btn'), 'the button is back');
    assert.equal(v.$('.side-entries'), null, 'the earlier question is gone');
  } finally { v.dispose(); }
});
