// The controller says when a turn starts and ends (ledger 28i-C13-6): a host learns it from the port's turnChanged, never by folding the
// message stream with the core's reduce, which a relay in another language (Eclipse's Java line) cannot call.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AgentSideConnection, ndJsonStream } from '@agentclientprotocol/sdk';
import { chatWith, RecordingPort } from '../dist/test-support.js';
import { READY_INTENT } from '../dist/view.js';

/** A port that also hears the turn reports. */
class TurnPort extends RecordingPort {
  turns = [];
  turnChanged(inProgress) { this.turns.push(inProgress); }
}

/** An agent whose `session/prompt` does not answer until released. */
function slowAgent() {
  const waiting = [];
  const run = (input, output) => {
    new AgentSideConnection(() => ({
      async initialize() { return { protocolVersion: 1, agentCapabilities: {}, agentInfo: { name: 'slow', version: '1' } }; },
      async newSession() { return { sessionId: 's1' }; },
      async prompt() { return new Promise(resolve => { waiting.push(resolve); }); },
      async cancel() { waiting.shift()?.({ stopReason: 'cancelled' }); },
    }), ndJsonStream(output, input));
  };
  return { run, release: () => waiting.shift()?.({ stopReason: 'end_turn' }) };
}

const tick = () => new Promise(r => setTimeout(r, 30));

async function connected() {
  const agent = slowAgent();
  const c = chatWith(agent.run);
  const port = new TurnPort();
  c.chat.attach(port);
  await c.sessions.connectToAgent('agent');
  return { agent, c, port };
}

test('a turn starting is reported once, and its end once', async () => {
  const { agent, c, port } = await connected();
  try {
    const turn = c.chat.sendPrompt('one');
    await tick();
    assert.deepEqual(port.turns, [true]);
    agent.release();
    await turn;
    assert.deepEqual(port.turns, [true, false]);
  } finally { c.dispose(); }
});

test('a prompt queued during a turn reports nothing new, and the next turn is reported when it starts', async () => {
  const { agent, c, port } = await connected();
  try {
    const turn = c.chat.sendPrompt('one');
    await tick();
    await port.deliver({ type: 'sendPrompt', text: 'two' });
    assert.deepEqual(port.turns, [true], 'queueing is not a turn change');
    agent.release();
    await tick();
    agent.release();
    await turn;
    assert.deepEqual(port.turns, [true, false, true, false]);
  } finally { c.dispose(); }
});

test('clearing the chat during a turn reports the end', async () => {
  const { c, port } = await connected();
  try {
    void c.chat.sendPrompt('one');
    await tick();
    c.chat.clearChat();
    assert.deepEqual(port.turns, [true, false]);
  } finally { c.dispose(); }
});

test('a port seated during a turn is told the turn is running when its page is ready', async () => {
  const { c } = await connected();
  try {
    void c.chat.sendPrompt('one');
    await tick();
    const late = new TurnPort();
    c.chat.attach(late);
    assert.deepEqual(late.turns, [], 'nothing before the page is ready');
    await late.deliver(READY_INTENT);
    assert.deepEqual(late.turns, [true]);
  } finally { c.dispose(); }
});

test('a port seated with no turn running is told nothing at ready', async () => {
  const { c } = await connected();
  try {
    const late = new TurnPort();
    c.chat.attach(late);
    await late.deliver(READY_INTENT);
    assert.deepEqual(late.turns, []);
  } finally { c.dispose(); }
});
