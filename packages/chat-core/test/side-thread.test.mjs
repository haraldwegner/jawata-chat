// CR3, the side thread: a short side question goes out as a prompt of a second session with the same agent and is answered apart from the
// main thread, which meanwhile may be in the middle of a turn. The agent is a small fake whose main turn does not end until released.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AgentSideConnection, ndJsonStream } from '@agentclientprotocol/sdk';
import { chatWith } from '../dist/test-support.js';

function agentWithASide(over = {}) {
  const log = [];
  const waiting = [];
  let sessions = 0;
  const run = (input, output) => {
    const conn = new AgentSideConnection(() => ({
      async initialize() { return { protocolVersion: 1, agentCapabilities: {}, agentInfo: { name: 'two', version: '1' } }; },
      async newSession(params) { log.push(['new', params._meta ?? null]); sessions++; return { sessionId: `s${sessions}` }; },
      async prompt({ sessionId, prompt }) {
        const text = prompt[0].text;
        log.push(['prompt', sessionId, text]);
        if (sessionId === 's1') { return new Promise(resolve => { waiting.push(resolve); }); }
        if (over.failSide) { throw new Error('the side is down'); }
        await conn.sessionUpdate({ sessionId, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: `answer to ${text}` } } });
        return { stopReason: 'end_turn' };
      },
      async cancel() { /* not used */ },
    }), ndJsonStream(output, input));
  };
  return { run, log, release: () => waiting.shift()?.({ stopReason: 'end_turn' }) };
}

const tick = () => new Promise(r => setTimeout(r, 30));
/** A step that must finish soon: a side question sent to the held main session would wait for ever, and that is a failure, not a hang. */
const within = (ms, what, work) => Promise.race([work, new Promise((_, no) => setTimeout(() => no(new Error(`${what} did not finish in ${ms} ms`)), ms))]);
const mainOf = (state) => { const { side, ...main } = state; return JSON.stringify(main); };

async function connected(over) {
  const agent = agentWithASide(over);
  const c = chatWith(agent.run);
  await c.sessions.connectToAgent('agent');
  return { agent, c };
}

test('a side question asked while the main turn runs is answered in the side thread, and the main thread does not change', async () => {
  const { agent, c } = await connected();
  try {
    const turn = c.chat.sendPrompt('the long step');
    await tick();
    const before = mainOf(c.chat.snapshot());
    assert.equal(c.chat.snapshot().processing, true, 'the main turn is open');
    await within(1500, 'the side question', c.port.deliver({ type: 'askSide', text: 'what is the time' }));
    await tick();
    const state = c.chat.snapshot();
    assert.deepEqual(state.side.entries.map(e => e.kind), ['user', 'turn']);
    assert.equal(state.side.entries[0].text, 'what is the time');
    assert.deepEqual(state.side.entries[1].turn.parts, [{ kind: 'text', text: 'answer to what is the time' }]);
    assert.equal(state.side.processing, false);
    assert.equal(mainOf(state), before, 'the main thread has no new turn and no changed state');
    assert.deepEqual(agent.log.filter(e => e[0] === 'prompt'), [['prompt', 's1', 'the long step'], ['prompt', 's2', 'what is the time']]);
    assert.deepEqual(agent.log.filter(e => e[0] === 'new').map(e => e[1]), [null, { 'jawata/side': true }], 'only the second session says it is a side thread');
    agent.release();
    await turn;
  } finally { c.dispose(); }
});

test('the side session is opened once and kept for the next side question; closing it makes the next question open another', async () => {
  const { agent, c } = await connected();
  try {
    await c.port.deliver({ type: 'askSide', text: 'one' });
    await c.port.deliver({ type: 'askSide', text: 'two' });
    assert.equal(agent.log.filter(e => e[0] === 'new').length, 2, 'the main session and one side session');
    assert.deepEqual(c.chat.snapshot().side.entries.map(e => e.kind), ['user', 'turn', 'user', 'turn']);
    await c.port.deliver({ type: 'closeSide' });
    assert.equal(c.chat.snapshot().side, null);
    await c.port.deliver({ type: 'askSide', text: 'three' });
    assert.equal(agent.log.filter(e => e[0] === 'new').length, 3);
    assert.deepEqual(c.chat.snapshot().side.entries.map(e => e.kind), ['user', 'turn'], 'a fresh thread');
  } finally { c.dispose(); }
});

test('a side question that cannot be answered shows an error in the side thread and nowhere else', async () => {
  const { c } = await connected({ failSide: true });
  try {
    const before = mainOf(c.chat.snapshot());
    await c.port.deliver({ type: 'askSide', text: 'will fail' });
    const state = c.chat.snapshot();
    assert.deepEqual(state.side.entries.map(e => e.kind), ['user', 'error']);
    assert.equal(state.side.processing, false);
    assert.equal(mainOf(state), before);
  } finally { c.dispose(); }
});

test('an empty side question is not sent, and the thread belongs to the conversation: a new conversation has none', async () => {
  const { agent, c } = await connected();
  try {
    await c.port.deliver({ type: 'askSide', text: '   ' });
    assert.equal(c.chat.snapshot().side, null);
    assert.equal(agent.log.filter(e => e[0] === 'new').length, 1, 'no side session was opened');
    await c.port.deliver({ type: 'askSide', text: 'one' });
    assert.notEqual(c.chat.snapshot().side, null);
    await c.sessions.newConversation();
    await tick();
    assert.equal(c.chat.snapshot().side, null);
  } finally { c.dispose(); }
});
