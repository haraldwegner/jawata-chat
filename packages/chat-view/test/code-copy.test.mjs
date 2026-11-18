// Stage 27 (y), his words 2026-11-18: "The prompt is separate. I need a copy button". Every code block in an answer carries a copy button at its
// top right; a click copies the block's exact text (no fence lines, nothing added or trimmed) and shows "Copied" briefly. One button per block.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { act, closeDom, viewOn } from './dom.mjs';
import { renderMarkdown } from '../dist/markdown.js';
import { addCopyButtons } from '../dist/copy.js';

after(closeDom);

const clipboard = () => {
  const copied = [];
  Object.defineProperty(globalThis.navigator, 'clipboard', { value: { writeText: async (text) => { copied.push(text); } }, configurable: true });
  return copied;
};

test('one button per block, and a block that itself contains backticks and indentation is copied exactly, with no fence lines', async () => {
  const copied = clipboard();
  const root = document.createElement('div');
  document.body.appendChild(root);
  root.innerHTML = renderMarkdown('before\n\n````\nline one\n```inner```\n   indented\n````\n\nbetween\n\n```\nsecond\n```\n');
  addCopyButtons(root);
  addCopyButtons(root); // a second pass over the same answer adds nothing
  const buttons = root.querySelectorAll('pre .code-copy');
  assert.equal(buttons.length, 2, 'one button per block, however often the answer is read again');
  await act(async () => { buttons[0].dispatchEvent(new window.MouseEvent('click', { bubbles: true })); });
  assert.deepEqual(copied, ['line one\n```inner```\n   indented'], 'the exact text of the block: no fence lines, nothing added or trimmed, not the button\'s own label');
  assert.match(buttons[0].textContent, /Copied/);
  root.remove();
});

test('R5, its answer holding a block: the view shows the block\'s button, and a click copies the block\'s text', async () => {
  const copied = clipboard();
  // the recorded answer's words are replaced by an answer that holds one block, because no recording of an answer holds one
  const withABlock = lines => lines.map(l => {
    const update = l.msg?.params?.update;
    return update?.sessionUpdate === 'agent_message_chunk'
      ? { ...l, msg: { ...l.msg, params: { ...l.msg.params, update: { ...update, content: { type: 'text', text: 'Take this:\n\n```\nfirst line\nsecond line\n```\n' } } } } }
      : l;
  });
  const v = await viewOn('R5', { reshape: withABlock });
  try {
    await v.connect();
    await v.settle();
    await v.type('go');
    await v.key('Enter');
    await v.settle(() => v.$('.md-rendered pre'));
    const buttons = v.$$('.md-rendered pre .code-copy');
    assert.equal(buttons.length, v.$$('.md-rendered pre').length, 'every block has its button');
    assert.equal(buttons.length, 1, 'the answer holds one block');
    await v.click(buttons[0]);
    assert.equal(copied[0], 'first line\nsecond line');
  } finally { v.dispose(); }
});
