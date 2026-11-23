// The test fakes offsetTop; the mirror's wrapping in the real field has not been tried in a browser (28h z47).
// 28h z47: Up in the chat's input moves the caret one line up, and only an Up pressed with the caret already on the first visual line walks
// the messages the person sent before; Down mirrors it with the last visual line and the newer messages. A draft that wraps over several
// lines, or holds several, is therefore not replaced by the first Up.
//
// A node test has no layout, so `offsetTop` of the spans in the hidden mirror (`[data-line-mirror]`) is faked: the field is ten characters
// wide and a line is 20 px. The fake lays the mirror's text out the way a wrapping textarea would (ten characters, or a hard newline, end a line).
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { act, closeDom, viewOn } from './dom.mjs';

after(closeDom);

const WIDTH = 10;
const LINE = 20;

/** The line of the character at `offset` in `text`, when the field is WIDTH characters wide. */
function lineOf(text, offset) {
  let line = 0;
  let col = 0;
  for (let i = 0; i < offset; i++) {
    if (text[i] === '\n') { line++; col = 0; } else if (++col === WIDTH) { line++; col = 0; }
  }
  return line;
}

const original = Object.getOwnPropertyDescriptor(window.HTMLElement.prototype, 'offsetTop');
Object.defineProperty(window.HTMLElement.prototype, 'offsetTop', {
  configurable: true,
  get() {
    const mirror = this.closest?.('[data-line-mirror]');
    if (!mirror || this === mirror) { return original ? original.get.call(this) : 0; }
    let before = 0;
    for (let n = this.previousSibling; n; n = n.previousSibling) { before += n.textContent.length; }
    return lineOf(mirror.textContent, before) * LINE;
  },
});

const field = (v) => v.$('textarea');
/** Press a key in the field with the caret where `caret` says (an offset, or 'end'); true when the field kept the key for itself (preventDefault). */
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

test('upMovesALineBeforeItWalksMessages', async () => {
  const v = await afterSending(['one', 'two']);
  // 25 characters: three visual lines of a ten-character field, with no newline in them
  const draft = 'aaaaaaaaaabbbbbbbbbbccccc';
  try {
    await v.type(draft);

    // (1) Up inside a draft of more than one line leaves the draft and is the field's own
    assert.equal(await press(v, 'ArrowUp', 15), false, 'caret on the second line: the key is not kept from the field');
    assert.equal(field(v).value, draft, 'the draft is not replaced');
    assert.equal(await press(v, 'ArrowUp', 'end'), false, 'caret on the third line: the key is not kept from the field');
    assert.equal(field(v).value, draft, 'the draft is not replaced');
    assert.equal(document.querySelector('[data-line-mirror]'), null, 'the mirror does not stay in the page');

    // (3) Down inside a multi-line draft leaves the draft
    assert.equal(await press(v, 'ArrowDown', 5), false, 'caret on the first line: the key is not kept from the field');
    assert.equal(field(v).value, draft);
    assert.equal(await press(v, 'ArrowDown', 15), false, 'caret on the second line: the key is not kept from the field');
    assert.equal(field(v).value, draft);

    // (2) Up with the caret at the top loads the previous message
    assert.equal(await press(v, 'ArrowUp', 5), true, 'caret on the first line: the history takes the key');
    assert.equal(field(v).value, 'two');
    assert.equal(await press(v, 'ArrowUp'), true);
    assert.equal(field(v).value, 'one');

    // (4) Down with the caret at the bottom loads the newer message, and at the newest restores the draft
    assert.equal(await press(v, 'ArrowDown'), true);
    assert.equal(field(v).value, 'two');
    assert.equal(await press(v, 'ArrowDown'), true);
    assert.equal(field(v).value, draft, 'what was being typed is back');
  } finally { v.dispose(); }
});
