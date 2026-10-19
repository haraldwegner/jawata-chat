// The in-process link: the line between a core and a page that run in the same process (Theia's native mount, the Eclipse relay).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createInProcessLink } from '../dist/in-process-link.js';
import { ChatController } from '../dist/chat-controller.js';
import { chatWith } from '../dist/test-support.js';
import { replayAgent, readSession } from '@jawata/acp-contract';
import { sessionFile } from './play.mjs';

test('what the core posts reaches every handler of the page, in order, until it is disposed', () => {
  const link = createInProcessLink();
  const heard = [];
  const a = link.page.onMessage(m => heard.push(['a', m.type]));
  link.page.onMessage(m => heard.push(['b', m.type]));
  link.port.post({ type: 'promptStart' });
  a.dispose();
  link.port.post({ type: 'clearChat' });
  assert.deepEqual(heard, [['a', 'promptStart'], ['b', 'promptStart'], ['b', 'clearChat']]);
});

test('what the page sends reaches the core\'s handler, and a handler that went is not called', async () => {
  const link = createInProcessLink();
  const got = [];
  const sub = link.port.onMessage(m => { got.push(m); });
  link.page.send({ type: 'ready' });
  await link.deliver({ not: 'an intent' });
  sub.dispose();
  link.page.send({ type: 'cancelTurn' });
  assert.deepEqual(got, [{ type: 'ready' }, { not: 'an intent' }]);
});

test('a whole chat runs over it: a page that says ready is told the state, and a prompt sent from the page is answered into the page', async () => {
  const session = readSession(sessionFile('R1'));
  const link = createInProcessLink();
  const c = chatWith((input, output) => replayAgent(session, output, input));
  const chat = new ChatController(c.sessions, c.updates, c.host, c.chat.flow);
  chat.attach(link.port);
  try {
    const seen = [];
    link.page.onMessage(m => seen.push(m.type));
    await c.sessions.connectToAgent('agent');
    link.page.send({ type: 'ready' });
    await link.deliver({ type: 'sendPrompt', text: 'hello' });
    assert.ok(['state', 'snapshot', 'userPrompt', 'promptStart', 'sessionUpdate', 'promptEnd'].every(t => seen.includes(t)), seen.join(','));
  } finally { chat.dispose(); c.dispose(); }
});
