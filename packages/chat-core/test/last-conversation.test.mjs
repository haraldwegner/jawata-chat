// His ruling, 2026-11-25: each window reopens, after a restart, the conversation it was showing, with the agent that conversation was held
// with; a window with nothing remembered starts a new one on the default agent. A "window" here is one memory (the port a host keeps per
// window); a restart is a second chat built on the same memory.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AgentSideConnection, RequestError, ndJsonStream } from '@agentclientprotocol/sdk';
import { chatWith, RecordingPort } from '../dist/test-support.js';

const BRAINS = ['claude-code|opus', 'claude-code|sonnet', 'cursor|grok'];
const row = (value) => ({
  id: 'principal-brain', name: 'Brain of the principal', category: 'model', type: 'select', currentValue: value,
  options: BRAINS.map(v => ({ value: v, name: v })),
});

/**
 * An agent as the jawata agent behaves: it starts every process on its default brain, loads a session on that brain, and takes a pick of
 * the principal's brain through the session's option. `log` keeps what it was asked.
 */
function agent({ start = 'claude-code|opus', ids = 's', load = true, resume = false, gone = false, offered = BRAINS, nameOnly = false, gate } = {}) {
  const log = [];
  let brain = start;
  let count = 0;
  let connection;
  const shown = () => row(nameOnly ? brain.split('|')[0] : brain);
  const run = (input, output) => {
    new AgentSideConnection((conn) => {
      connection = conn;
      return {
        async initialize() {
          return { protocolVersion: 1, agentCapabilities: { loadSession: load, sessionCapabilities: resume ? { resume: {} } : {} }, agentInfo: { name: 'fake', version: '1' } };
        },
        async newSession() { log.push('new'); return { sessionId: `${ids}${++count}`, configOptions: [row(brain)] }; },
        async loadSession({ sessionId }) {
          log.push(`load ${sessionId}`);
          await gate;
          if (gone) { throw new RequestError(-32602, `No recorded session:\n${sessionId}`); }
          await conn.sessionUpdate({ sessionId, update: { sessionUpdate: 'user_message_chunk', content: { type: 'text', text: `earlier in ${sessionId}` } } });
          return { configOptions: [shown()] };
        },
        async resumeSession({ sessionId }) { log.push(`resume ${sessionId}`); return { configOptions: [shown()] }; },
        async setSessionConfigOption({ value }) {
          log.push(`brain ${value}`);
          if (!offered.includes(value)) { throw new RequestError(-32602, `A brain the registry offers, not: ${value}`); }
          brain = value;
          return { configOptions: [shown()] };
        },
        async prompt() { log.push('prompt'); return { stopReason: 'end_turn' }; },
        async cancel() { /* nothing runs */ },
      };
    }, ndJsonStream(output, input));
  };
  return { run, log, say: (sessionId, update) => connection.sessionUpdate({ sessionId, update }) };
}

/** What a host keeps for one window. */
function windowMemory(value) {
  const memory = { value, load: () => memory.value, save: (next) => { memory.value = next; } };
  return memory;
}

/** The window as it starts: a chat on the window's memory, with its agent. */
function openWindow(memory, a) {
  return chatWith(a.run, new RecordingPort(), { lastConversation: memory });
}

const errorsIn = (c) => c.chat.snapshot().entries.filter(e => e.kind === 'error').map(e => e.message);
const brainShown = (c) => c.chat.snapshot().session?.configOptions?.find(o => o.id === 'principal-brain')?.currentValue;
const userTexts = (c) => JSON.stringify(c.chat.snapshot().entries);
const tick = () => new Promise(r => setTimeout(r, 40));

/** One run of a window: connect, do what the person does, close. */
async function oneRun(memory, a, does) {
  const c = openWindow(memory, a);
  try {
    await c.chat.flow.connect();
    await does(c);
    await tick();
  } finally { c.dispose(); }
}

test('restart: the window reopens the conversation it was typed into, and starts no new one', async () => {
  const memory = windowMemory();
  await oneRun(memory, agent(), c => c.chat.sendPrompt('hello'));
  const a = agent();
  const c = openWindow(memory, a);
  try {
    await c.chat.flow.connect();
    assert.deepEqual(a.log, ['load s1']);
    assert.equal(c.sessions.getActiveSessionId(), 's1');
    assert.match(userTexts(c), /earlier in s1/);
    assert.deepEqual(errorsIn(c), []);
  } finally { c.dispose(); }
});

test('restart: it comes back with the agent it was held with, not the default the new process starts on, and the page shows it', async () => {
  const memory = windowMemory();
  await oneRun(memory, agent(), async c => {
    await c.port.deliver({ type: 'setConfigOption', configId: 'principal-brain', value: 'cursor|grok' });
    await c.chat.sendPrompt('hello');
  });
  const a = agent({ start: 'claude-code|opus' });
  const c = openWindow(memory, a);
  try {
    await c.chat.flow.connect();
    assert.deepEqual(a.log, ['load s1', 'brain cursor|grok']);
    assert.equal(brainShown(c), 'cursor|grok');
  } finally { c.dispose(); }
});

test('restart: an agent that is already the one it was held with is not picked again (a pick also changes the stored default)', async () => {
  const memory = windowMemory();
  await oneRun(memory, agent(), c => c.chat.sendPrompt('hello'));
  const a = agent();
  await oneRun(memory, a, async () => {});
  assert.deepEqual(a.log, ['load s1']);
});

test('the agent naming its brain without the model, before its own session is open, does not erase the remembered model', async () => {
  const memory = windowMemory();
  await oneRun(memory, agent({ start: 'claude-code|sonnet' }), c => c.chat.sendPrompt('hello'));
  const a = agent({ start: 'claude-code|opus', nameOnly: true });
  await oneRun(memory, a, c => c.chat.sendPrompt('again'));
  assert.deepEqual(a.log, ['load s1', 'brain claude-code|sonnet', 'prompt']);
  assert.equal(memory.value.agent, 'claude-code|sonnet');
});

test('a model picked before the new brain has opened its session is remembered with its model', async () => {
  const memory = windowMemory();
  await oneRun(memory, agent({ nameOnly: true, start: 'claude-code' }), async c => {
    await c.chat.sendPrompt('hello');
    await c.port.deliver({ type: 'setConfigOption', configId: 'principal-brain', value: 'cursor|grok' });
  });
  assert.equal(memory.value.agent, 'cursor|grok');
});

test('an agent that changes its own brain row during the conversation is remembered', async () => {
  const memory = windowMemory();
  const a = agent();
  await oneRun(memory, a, async c => {
    await c.chat.sendPrompt('hello');
    await a.say('s1', { sessionUpdate: 'config_option_update', configOptions: [row('claude-code|sonnet')] });
  });
  assert.equal(memory.value.agent, 'claude-code|sonnet');
});

test('two windows have two last conversations: each reopens its own', async () => {
  const left = windowMemory();
  const right = windowMemory();
  await oneRun(left, agent({ ids: 'left-' }), c => c.chat.sendPrompt('hello'));
  await oneRun(right, agent({ ids: 'right-' }), c => c.chat.sendPrompt('hello'));
  const a = agent();
  const b = agent();
  await oneRun(left, a, async () => {});
  await oneRun(right, b, async () => {});
  assert.deepEqual(a.log, ['load left-1']);
  assert.deepEqual(b.log, ['load right-1']);
});

test('nothing remembered: a new conversation on the agent\'s default, no pick and nothing said', async () => {
  const memory = windowMemory();
  const a = agent();
  const c = openWindow(memory, a);
  try {
    await c.chat.flow.connect();
    assert.deepEqual(a.log, ['new']);
    assert.deepEqual(errorsIn(c), []);
    assert.equal(memory.value, undefined, 'a conversation never typed in is not remembered');
  } finally { c.dispose(); }
});

test('the conversation is gone: a new one is started, one plain line says why, and the remembered one is kept until the person types', async () => {
  const memory = windowMemory({ sessionId: 'old', agent: 'claude-code|opus' });
  const a = agent({ gone: true });
  const c = openWindow(memory, a);
  try {
    await c.chat.flow.connect();
    assert.deepEqual(a.log, ['load old', 'new']);
    assert.equal(c.sessions.getActiveSessionId(), 's1');
    const said = errorsIn(c);
    assert.equal(said.length, 1, said.join(' | '));
    assert.match(said[0], /^The last conversation could not be reopened: .*No recorded session: old.* This is a new one\.$/);
    assert.ok(!said[0].includes('\n'), 'one line');
    assert.deepEqual(memory.value, { sessionId: 'old', agent: 'claude-code|opus' });
    await c.chat.sendPrompt('hello');
    assert.equal(memory.value.sessionId, 's1', 'typed into: it is the window\'s conversation now');
  } finally { c.dispose(); }
});

test('its agent is not available: a new conversation, and the line names the agent and the engine\'s reason', async () => {
  const memory = windowMemory({ sessionId: 'old', agent: 'cursor|grok' });
  const a = agent({ offered: ['claude-code|opus'] });
  const c = openWindow(memory, a);
  try {
    await c.chat.flow.connect();
    assert.deepEqual(a.log, ['load old', 'brain cursor|grok', 'new']);
    assert.equal(c.sessions.getActiveSessionId(), 's1');
    assert.doesNotMatch(userTexts(c), /earlier in old/, 'the conversation that could not be reopened is not left on the page');
    const said = errorsIn(c);
    assert.equal(said.length, 1, said.join(' | '));
    assert.match(said[0], /could not be reopened: its agent cursor\|grok is not available \(A brain the registry offers/);
    assert.deepEqual(memory.value, { sessionId: 'old', agent: 'cursor|grok' });
  } finally { c.dispose(); }
});

test('the engine refuses and no new conversation can be started either: the line still says why, and claims no new one', async () => {
  const memory = windowMemory({ sessionId: 'old' });
  const c = chatWith((_input, output) => { void output.getWriter().close(); }, new RecordingPort(), { lastConversation: memory });
  try {
    await c.chat.flow.connect();
    const said = errorsIn(c);
    assert.equal(said.length, 1, said.join(' | '));
    assert.match(said[0], /^The last conversation could not be reopened: /);
    assert.doesNotMatch(said[0], /new one/);
    assert.deepEqual(memory.value, { sessionId: 'old' });
  } finally { c.dispose(); }
});

test('New chat is the person\'s choice: nothing older comes back after a restart, typed into or not', async () => {
  const memory = windowMemory();
  await oneRun(memory, agent(), async c => {
    await c.chat.sendPrompt('hello');
    await c.chat.flow.newConversation();
  });
  const a = agent();
  await oneRun(memory, a, async () => {});
  assert.deepEqual(a.log, ['new']);
});

test('New chat declined at the question keeps what is remembered', async () => {
  const memory = windowMemory();
  await oneRun(memory, agent(), async c => {
    await c.chat.sendPrompt('hello');
    c.host.chooser.answer = false;
    await c.chat.flow.newConversation();
  });
  assert.equal(memory.value.sessionId, 's1');
});

test('New chat with no session open (the start did not connect) starts a new one and does not reopen the older one', async () => {
  const memory = windowMemory({ sessionId: 'old' });
  const a = agent();
  const c = openWindow(memory, a);
  try {
    await c.chat.flow.newConversation();
    assert.deepEqual(a.log, ['new']);
    assert.equal(memory.value, undefined);
  } finally { c.dispose(); }
});

test('Restart agent is a new conversation: nothing older comes back', async () => {
  const memory = windowMemory();
  await oneRun(memory, agent(), async c => {
    await c.chat.sendPrompt('hello');
    await c.chat.flow.restart();
  });
  assert.equal(memory.value, undefined);
});

test('a conversation opened from History is what the window shows by choice: it comes back, typed into or not', async () => {
  const memory = windowMemory({ sessionId: 'old' });
  await oneRun(memory, agent(), c => c.chat.flow.open('picked'));
  const a = agent();
  await oneRun(memory, a, async () => {});
  assert.deepEqual(a.log, ['load picked']);
});

test('a History open that fails leaves what is remembered', async () => {
  const memory = windowMemory({ sessionId: 'old' });
  const c = openWindow(memory, agent({ gone: true }));
  try {
    await c.chat.flow.open('picked');
    assert.deepEqual(memory.value, { sessionId: 'old' });
  } finally { c.dispose(); }
});

test('reopening is for the start only: after a Disconnect, Connect opens a new conversation as before', async () => {
  const memory = windowMemory();
  const a = agent();
  const c = openWindow(memory, a);
  try {
    await c.chat.flow.connect();
    await c.chat.sendPrompt('hello');
    await c.chat.flow.disconnect();
    await c.chat.flow.connect();
    assert.deepEqual(a.log, ['new', 'prompt', 'new']);
  } finally { c.dispose(); }
});

test('an agent that can only resume is asked to resume, and the person is told the earlier messages are not shown', async () => {
  const memory = windowMemory({ sessionId: 'old', agent: 'claude-code|opus' });
  const a = agent({ load: false, resume: true });
  const c = openWindow(memory, a);
  try {
    await c.chat.flow.connect();
    assert.deepEqual(a.log, ['resume old']);
    assert.ok(c.host.notifier.told.includes('info: Resumed the session; its earlier messages are not shown.'), c.host.notifier.told.join(' | '));
  } finally { c.dispose(); }
});

/** A window whose reopen is held in the agent's load until `release`. */
async function heldReopen() {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const memory = windowMemory({ sessionId: 'old' });
  const a = agent({ gate });
  const c = openWindow(memory, a);
  const connecting = c.chat.flow.connect();
  for (let i = 0; i < 100 && !a.log.includes('load old'); i++) { await tick(); }
  return { a, c, memory, connecting, release };
}

test('a second Connect while the reopen is under way is the same reopen', async () => {
  const { a, c, connecting, release } = await heldReopen();
  try {
    const second = c.chat.flow.connect();
    release();
    await Promise.all([connecting, second]);
    assert.deepEqual(a.log, ['load old']);
  } finally { c.dispose(); }
});

test('New chat while the reopen is under way waits for it, then starts the new one, and says nothing of a failure', async () => {
  const { a, c, memory, connecting, release } = await heldReopen();
  try {
    const chosen = c.chat.flow.newConversation();
    await tick();
    release();
    await Promise.all([connecting, chosen]);
    assert.deepEqual(a.log, ['load old', 'new']);
    assert.deepEqual(errorsIn(c), []);
    assert.equal(memory.value, undefined);
  } finally { c.dispose(); }
});

test('Disconnect while the reopen is under way ends it: no new conversation is started behind the person\'s back', async () => {
  const { a, c, memory, connecting, release } = await heldReopen();
  try {
    await c.chat.flow.disconnect();
    release();
    await connecting;
    await tick();
    assert.deepEqual(a.log, ['load old']);
    assert.equal(c.sessions.getActiveSessionId(), null);
    assert.deepEqual(errorsIn(c), []);
    assert.deepEqual(memory.value, { sessionId: 'old' });
  } finally { c.dispose(); }
});

test('a memory that cannot be read starts a new conversation and the log says so', async () => {
  const a = agent();
  const c = openWindow({ load: () => { throw new Error('storage is broken'); }, save: () => {} }, a);
  try {
    await c.chat.flow.connect();
    assert.deepEqual(a.log, ['new']);
    assert.ok(c.host.logged.some(l => /storage is broken/.test(l)), c.host.logged.join(' | '));
  } finally { c.dispose(); }
});
