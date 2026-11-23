// 28h z58, his word: "Yes, button for /btw only". The button captures what is in the field as `/btw <thought>`, sent to the agent as a
// prompt; typed `/btw` stays the side discussion. With nothing in the field it says what to do and sends nothing.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { closeDom, viewOn } from './dom.mjs';

after(closeDom);

const button = v => v.$('.capture-btn');

test('the btw button sends the thought in the field as /btw and empties the field', async () => {
  const v = await viewOn('R1');
  try {
    await v.connect();
    await v.settle();
    assert.ok(button(v), 'there is a btw button');
    await v.type('the slot guard may be redundant');
    await v.click(button(v));
    await v.settle(() => v.chat.snapshot().entries.some(e => /\/btw the slot guard may be redundant/.test(JSON.stringify(e))));
    assert.equal(v.$('textarea').value, '');
  } finally { v.dispose(); }
});

test('with nothing in the field the button says what to do and sends nothing', async () => {
  const v = await viewOn('R1');
  try {
    await v.connect();
    await v.settle();
    const before = v.chat.snapshot().entries.length;
    await v.click(button(v));
    assert.match(v.$('textarea').placeholder, /thought you want to capture/);
    assert.equal(v.chat.snapshot().entries.length, before);
  } finally { v.dispose(); }
});
