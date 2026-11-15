// 28h S25 (D56 (g)): the arrows in the chat's input walk what the person typed before, newest first, and the text brought back can be
// changed before it is sent. Up recalls only with the caret on the first line and down only on the last, so moving through a text of
// several lines still works. Nothing outside the input sees the keys it used. The History button (the agent's past sessions) is another thing.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { act, closeDom, viewOn } from './dom.mjs';

after(closeDom);

const field = (v) => v.$('textarea');
/** Press a key in the field with the caret where `caret` says (an offset, or 'end'); true when the field kept the key for itself. */
async function press(v, key, caret = 'end') {
  const el = field(v);
  const at = caret === 'end' ? el.value.length : caret;
  el.setSelectionRange(at, at);
  let kept = false;
  await act(async () => { kept = !el.dispatchEvent(new window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })); });
  return kept;
}

/** A connected chat whose person has sent `sent`, in order, through the field. */
async function afterSending(sent) {
  const v = await viewOn('R1');
  await v.connect();
  await v.settle();
  for (const text of sent) {
    await v.type(text);
    await v.key('Enter');
    await v.settle(() => v.chat.snapshot().inputHistory[0] === text);
  }
  return v;
}

test('up brings back the earlier messages, newest first, and stops at the oldest; down walks back to what was being typed', async () => {
  const v = await afterSending(['one', 'two']);
  try {
    await v.type('half typed');
    assert.equal(await press(v, 'ArrowUp'), true);
    assert.equal(field(v).value, 'two');
    await press(v, 'ArrowUp');
    assert.equal(field(v).value, 'one');
    assert.equal(await press(v, 'ArrowUp'), false, 'at the oldest the key is left to the field');
    assert.equal(field(v).value, 'one');
    await press(v, 'ArrowDown');
    assert.equal(field(v).value, 'two');
    await press(v, 'ArrowDown');
    assert.equal(field(v).value, 'half typed', 'what was being typed is back');
    assert.equal(await press(v, 'ArrowDown'), false, 'below it there is nothing more, and the key is the field\'s');
  } finally { v.dispose(); }
});

test('the text brought back can be changed, and what is sent is the changed text', async () => {
  const v = await afterSending(['run the tests']);
  try {
    const intents = [];
    const deliver = v.port.deliver.bind(v.port);
    v.port.deliver = async (intent) => { intents.push(intent); await deliver(intent); };
    await press(v, 'ArrowUp');
    assert.equal(field(v).value, 'run the tests');
    await v.type('run the tests again');
    await v.key('Enter');
    assert.deepEqual(intents.filter(i => i.type === 'sendPrompt').map(i => i.text), ['run the tests again']);
    await v.settle(() => v.chat.snapshot().inputHistory[0] === 'run the tests again');
    assert.equal(field(v).value, '');
    await press(v, 'ArrowUp');
    assert.equal(field(v).value, 'run the tests again', 'and it is the newest from then on');
  } finally { v.dispose(); }
});

test('in a text of several lines, up moves the caret unless it is on the first line, and down unless it is on the last', async () => {
  const v = await afterSending(['earlier']);
  try {
    await v.type('line one\nline two');
    assert.equal(await press(v, 'ArrowUp', 'end'), false, 'the caret on the second line: the field moves it');
    assert.equal(field(v).value, 'line one\nline two');
    assert.equal(await press(v, 'ArrowUp', 3), true, 'on the first line: the history');
    assert.equal(field(v).value, 'earlier');
    await press(v, 'ArrowDown');
    assert.equal(field(v).value, 'line one\nline two');
    assert.equal(await press(v, 'ArrowDown', 3), false, 'the caret on the first of two lines: the field moves it');
  } finally { v.dispose(); }
});

test('what the person typed in earlier conversations, as the core keeps it, is what the arrows walk', async () => {
  const v = await viewOn('R1');
  try {
    await v.connect();
    await v.settle();
    await act(async () => { v.port.post({ type: 'inputHistory', entries: ['yesterday\'s last', 'yesterday\'s first'] }); });
    await press(v, 'ArrowUp');
    assert.equal(field(v).value, 'yesterday\'s last');
    await press(v, 'ArrowUp');
    assert.equal(field(v).value, 'yesterday\'s first');
  } finally { v.dispose(); }
});

test('nothing outside the input sees the keys the history used; with nothing typed before, the keys are the field\'s', async () => {
  const v = await afterSending(['only']);
  const seen = [];
  const listener = (e) => seen.push(e.key);
  document.addEventListener('keydown', listener);
  try {
    await press(v, 'ArrowUp');
    await press(v, 'ArrowDown');
    assert.deepEqual(seen, []);
  } finally { document.removeEventListener('keydown', listener); v.dispose(); }
  const fresh = await viewOn('R1');
  try {
    await fresh.connect();
    await fresh.settle();
    assert.equal(await press(fresh, 'ArrowUp'), false);
    assert.equal(field(fresh).value, '');
  } finally { fresh.dispose(); }
});

test('with the list of commands open, the arrows move in the list and not through the history', async () => {
  const v = await viewOn('R3');
  try {
    await v.connect();
    await v.settle();
    await v.type('earlier');
    await v.key('Enter');
    await v.settle(() => v.chat.snapshot().inputHistory[0] === 'earlier');
    await v.type('/');
    assert.ok(v.$('.slash-popup.open'), 'the command list is open');
    await press(v, 'ArrowDown');
    await press(v, 'ArrowUp');
    assert.equal(field(v).value, '/');
  } finally { v.dispose(); }
});
