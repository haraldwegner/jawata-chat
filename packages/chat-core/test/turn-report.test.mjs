// The chat says when a turn starts and ends (ledger 28i-C13-6, folded at C12): a host subscribes once at its root with onTurnChanged,
// never by folding the message stream, and the report does not depend on which page is seated, or on any page at all.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AgentSideConnection, ndJsonStream } from '@agentclientprotocol/sdk';
import { chatWith, RecordingPort } from '../dist/test-support.js';

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
  const turns = [];
  c.chat.onTurnChanged(on => turns.push(on));
  await c.sessions.connectToAgent('agent');
  return { agent, c, turns };
}

test('a turn starting is reported once, and its end once', async () => {
  const { agent, c, turns } = await connected();
  try {
    const turn = c.chat.sendPrompt('one');
    await tick();
    assert.deepEqual(turns, [true]);
    agent.release();
    await turn;
    assert.deepEqual(turns, [true, false]);
  } finally { c.dispose(); }
});

test('a prompt queued during a turn reports nothing new, and the next turn is reported when it starts', async () => {
  const { agent, c, turns } = await connected();
  try {
    const turn = c.chat.sendPrompt('one');
    await tick();
    await c.port.deliver({ type: 'sendPrompt', text: 'two' });
    assert.deepEqual(turns, [true], 'queueing is not a turn change');
    agent.release();
    await tick();
    agent.release();
    await turn;
    assert.deepEqual(turns, [true, false, true, false]);
  } finally { c.dispose(); }
});

test('clearing the chat during a turn reports the end', async () => {
  const { c, turns } = await connected();
  try {
    void c.chat.sendPrompt('one');
    await tick();
    c.chat.clearChat();
    assert.deepEqual(turns, [true, false]);
  } finally { c.dispose(); }
});

test('the report does not depend on a page: a page let go of during a turn still sees its end reported', async () => {
  const { agent, c, turns } = await connected();
  try {
    const page = new RecordingPort();
    const seat = c.chat.attach(page);
    const turn = c.chat.sendPrompt('one');
    await tick();
    seat.dispose(); // the page goes away while the turn runs: nothing is seated now
    agent.release();
    await turn;
    assert.deepEqual(turns, [true, false], 'the editor\'s key is not left on');
  } finally { c.dispose(); }
});

test('a listener let go of is told nothing more', async () => {
  const { agent, c } = await connected();
  try {
    const heard = [];
    c.chat.onTurnChanged(on => heard.push(on)).dispose();
    const turn = c.chat.sendPrompt('one');
    await tick();
    agent.release();
    await turn;
    assert.deepEqual(heard, []);
  } finally { c.dispose(); }
});
