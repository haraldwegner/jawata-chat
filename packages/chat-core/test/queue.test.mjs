// Queue and steer: a prompt typed during a turn waits and is sent when the turn ends; "send now" cancels the turn first.
// Files go with a prompt as links the agent can read. The agent is a small fake over the SDK whose turns end when told to.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AgentSideConnection, ndJsonStream } from '@agentclientprotocol/sdk';
import { chatWith } from '../dist/test-support.js';

/** An agent whose `session/prompt` does not answer until released, and whose `session/cancel` releases it as cancelled. */
function slowAgent() {
  const log = [];
  const waiting = [];
  const run = (input, output) => {
    new AgentSideConnection(() => ({
      async initialize() { return { protocolVersion: 1, agentCapabilities: {}, agentInfo: { name: 'slow', version: '1' } }; },
      async newSession() { return { sessionId: 's1' }; },
      async prompt({ prompt }) {
        log.push(['prompt', prompt.map(b => b.type === 'text' ? b.text : `${b.type}:${b.name}:${b.uri}`)]);
        return new Promise(resolve => { waiting.push(resolve); });
      },
      async cancel() { log.push(['cancel']); waiting.shift()?.({ stopReason: 'cancelled' }); },
    }), ndJsonStream(output, input));
  };
  return { run, log, release: () => waiting.shift()?.({ stopReason: 'end_turn' }) };
}

const tick = () => new Promise(r => setTimeout(r, 30));
const sentTexts = (log) => log.filter(e => e[0] === 'prompt').map(e => e[1][0]);

async function connected() {
  const agent = slowAgent();
  const c = chatWith(agent.run);
  await c.sessions.connectToAgent('agent');
  c.port.toView.length = 0;
  return { agent, c };
}

test('a prompt typed during a turn is queued and not sent; it is sent, in the order typed, when the turn ends', async () => {
  const { agent, c } = await connected();
  try {
    const first = c.chat.sendPrompt('one');
    await tick();
    await c.port.deliver({ type: 'sendPrompt', text: 'two' });
    await c.port.deliver({ type: 'sendPrompt', text: 'three' });
    assert.deepEqual(sentTexts(agent.log), ['one'], 'nothing is sent while the turn runs');
    assert.deepEqual(c.chat.snapshot().queued.map(q => q.text), ['two', 'three']);
    assert.deepEqual(c.port.toView.filter(m => m.type === 'promptQueued').map(m => m.text), ['two', 'three']);
    agent.release();
    await tick();
    assert.deepEqual(sentTexts(agent.log), ['one', 'two'], 'the next is sent when the turn ends');
    agent.release();
    await tick();
    agent.release();
    await first;
    assert.deepEqual(sentTexts(agent.log), ['one', 'two', 'three']);
    assert.equal(c.chat.snapshot().queued.length, 0);
    assert.equal(agent.log.filter(e => e[0] === 'cancel').length, 0, 'nobody was cancelled');
  } finally { c.dispose(); }
});

test('"send now" cancels the running turn first, and then the queued prompt is sent', async () => {
  const { agent, c } = await connected();
  try {
    const first = c.chat.sendPrompt('one');
    await tick();
    await c.port.deliver({ type: 'sendPrompt', text: 'urgent' });
    await c.port.deliver({ type: 'sendNow' });
    await tick();
    assert.deepEqual(agent.log.map(e => e[0]), ['prompt', 'cancel', 'prompt'], 'the cancel comes before the second prompt');
    assert.deepEqual(sentTexts(agent.log), ['one', 'urgent']);
    agent.release();
    await first;
  } finally { c.dispose(); }
});

test('"send now" with nothing running and nothing queued does nothing', async () => {
  const { agent, c } = await connected();
  try {
    await c.port.deliver({ type: 'sendNow' });
    assert.deepEqual(agent.log, []);
  } finally { c.dispose(); }
});

test('files go with the prompt as links the agent can read, and the page is shown their names', async () => {
  const { agent, c } = await connected();
  try {
    const sending = c.port.deliver({ type: 'sendPrompt', text: 'look', files: ['/w/notes one.txt', 'C:\\w\\other.txt'] });
    await tick();
    assert.deepEqual(agent.log[0][1], ['look', 'resource_link:notes one.txt:file:///w/notes%20one.txt', 'resource_link:other.txt:file:///C:/w/other.txt']);
    assert.deepEqual(c.port.toView.find(m => m.type === 'userPrompt').files, ['notes one.txt', 'other.txt']);
    agent.release();
    await sending;
  } finally { c.dispose(); }
});

test('a queued prompt that is cleared away with the chat is not sent', async () => {
  const { agent, c } = await connected();
  try {
    const first = c.chat.sendPrompt('one');
    await tick();
    await c.port.deliver({ type: 'sendPrompt', text: 'two' });
    c.chat.clearChat();
    agent.release();
    await first;
    await tick();
    assert.deepEqual(sentTexts(agent.log), ['one']);
  } finally { c.dispose(); }
});

test('a queued prompt does not outlive the session it was typed in: after the agent is disconnected and connected again it is not sent with the next prompt', async () => {
  const { agent, c } = await connected();
  try {
    void c.chat.sendPrompt('one'); // its agent is ended, so it never answers
    await tick();
    await c.port.deliver({ type: 'sendPrompt', text: 'two' });
    await c.chat.flow.disconnect();
    await c.chat.flow.connect();
    assert.deepEqual(c.chat.snapshot().queued, [], 'the page shows nothing waiting');
    const next = c.chat.sendPrompt('three');
    await tick();
    agent.release(); // the answer the ended agent will never give
    agent.release();
    await next;
    await tick();
    assert.deepEqual(sentTexts(agent.log), ['one', 'three'], 'what was waiting in the old session was not sent to the new one');
  } finally { c.dispose(); }
});

test('a queued prompt is dropped when a session load starts: the page empties its queue then, and what it no longer shows is not sent', async () => {
  const { agent, c } = await connected();
  try {
    const first = c.chat.sendPrompt('one');
    await tick();
    await c.port.deliver({ type: 'sendPrompt', text: 'two' });
    c.sessions.emit('session-load-start', 's1', 'agent');
    agent.release();
    await first;
    await tick();
    assert.deepEqual(sentTexts(agent.log), ['one']);
  } finally { c.dispose(); }
});
