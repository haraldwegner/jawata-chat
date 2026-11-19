// Stage 27 (z3), his words 2026-11-19: "my replies can be long as well. So this should be foldable." A message of his longer than 6 lines is shown
// folded: its first 6 lines, a fade and "Show all (N lines)"; a click opens it and it stays open; the whole text is always there to copy. A message
// of 6 lines or fewer shows no button. The agent's answers are not folded.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { closeDom, viewOn } from './dom.mjs';

after(closeDom);

const lines = (n) => Array.from({ length: n }, (_, i) => `line ${i + 1}`).join('\n');

async function send(v, text) {
  await v.type(text);
  await v.key('Enter');
  await v.settle(() => v.$$('.message.user').length > 0);
}

test('a message of his of 20 lines is folded with the number of its lines on the button, and the whole text is still there to copy', async () => {
  const v = await viewOn('R5');
  try {
    await v.connect();
    await v.settle();
    await send(v, lines(20));
    const message = v.$('.message.user');
    const button = message.querySelector('button.user-more');
    assert.ok(message.querySelector('.user-text.folded'), 'a 20-line message is not folded');
    assert.ok(button, 'a folded message has no button to open it');
    assert.equal(button.textContent, 'Show all (20 lines)');
    assert.ok(message.textContent.includes('line 20'), 'the folded message does not hold its whole text for a copy');
    assert.equal(message.querySelector('.user-text').textContent, lines(20), 'what is there to copy is his text exactly');
  } finally { v.dispose(); }
});

test('a click on the button opens the message, and it stays open when more is said after it', async () => {
  const v = await viewOn('R5');
  try {
    await v.connect();
    await v.settle();
    await send(v, lines(12));
    await v.click(v.$('.message.user button.user-more'));
    assert.equal(v.$$('.message.user .user-text.folded').length, 0, 'the message is still folded after the click');
    assert.equal(v.$$('.message.user button.user-more').length, 0, 'the button is still there after the click');
    await send(v, 'and one more thing');
    assert.equal(v.$$('.message.user .user-text.folded').length, 0, 'the opened message was folded again by the next message');
  } finally { v.dispose(); }
});

test('a message of 6 lines shows no button and is not folded, and 7 lines is the first that is', async () => {
  const v = await viewOn('R5');
  try {
    await v.connect();
    await v.settle();
    await send(v, lines(6));
    assert.equal(v.$$('.message.user button.user-more').length, 0, 'six lines were folded');
    assert.equal(v.$$('.message.user .user-text.folded').length, 0);
    await send(v, lines(7));
    assert.equal(v.$$('.message.user button.user-more').length, 1, 'seven lines were not folded');
  } finally { v.dispose(); }
});

test('the agent\'s answer is not folded however long it is', async () => {
  const long = lines(30);
  const v = await viewOn('R5', {
    reshape: all => all.map(l => {
      const update = l.msg?.params?.update;
      return update?.sessionUpdate === 'agent_message_chunk'
        ? { ...l, msg: { ...l.msg, params: { ...l.msg.params, update: { ...update, content: { type: 'text', text: long } } } } }
        : l;
    }),
  });
  try {
    await v.connect();
    await v.settle();
    await send(v, 'go');
    await v.settle(() => v.$('.message.assistant'));
    assert.equal(v.$$('.message.assistant button.user-more').length, 0, 'an answer of the agent was given a fold button');
    assert.equal(v.$$('.message.assistant .folded').length, 0, 'an answer of the agent was folded');
  } finally { v.dispose(); }
});
