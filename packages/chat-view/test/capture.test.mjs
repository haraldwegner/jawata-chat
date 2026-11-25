// 28h z69 (replaces z58), his word 2026-11-25: "SO you only have to replace "btw" withe memorize and wire to the memorize command". The
// button sends `/memorize` to the conversation, with what is in the field after it; there is no btw button, and the side question stays.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { closeDom, viewOn } from './dom.mjs';

after(closeDom);

const button = v => v.$('.memorize-btn');
const sent = (v, text) => v.chat.snapshot().entries.some(e => JSON.stringify(e).includes(JSON.stringify(text)));

test('the Memorize button sends /memorize with the field text and empties the field', async () => {
  const v = await viewOn('R1');
  try {
    await v.connect();
    await v.settle();
    assert.equal(button(v)?.textContent, 'Memorize');
    await v.type('the slot guard may be redundant');
    await v.click(button(v));
    await v.settle(() => sent(v, '/memorize the slot guard may be redundant'));
    assert.equal(v.$('textarea').value, '');
  } finally { v.dispose(); }
});

test('with nothing in the field the button sends /memorize alone', async () => {
  const v = await viewOn('R1');
  try {
    await v.connect();
    await v.settle();
    await v.click(button(v));
    await v.settle(() => sent(v, '/memorize'));
  } finally { v.dispose(); }
});

test('the row has Side question and Memorize and no btw button', async () => {
  const v = await viewOn('R1');
  try {
    await v.connect();
    await v.settle();
    const labels = [...v.$('.picker-row').querySelectorAll('button')].map(b => b.textContent);
    assert.ok(labels.includes('Side question') && labels.includes('Memorize'), labels.join(' | '));
    assert.ok(!labels.includes('btw'), labels.join(' | '));
  } finally { v.dispose(); }
});
