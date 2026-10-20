// The operations the person starts, as the core runs them: one principal session, a question before messages are replaced,
// load where the agent can and resume where it can only do that, and what went wrong told to the person.
// The agent is a small fake over the SDK that answers what the flow asks and keeps what it was asked.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AgentSideConnection, RequestError, ndJsonStream } from '@agentclientprotocol/sdk';
import { chatWith } from '../dist/test-support.js';
import { chatOn } from './play.mjs';

/** An agent with the session capabilities given, which keeps every request it is sent. */
function agent({ load = false, resume = false, failLoad = false } = {}) {
  const log = [];
  let ids = 0;
  const run = (input, output) => {
    new AgentSideConnection((conn) => ({
      async initialize() { return { protocolVersion: 1, agentCapabilities: { loadSession: load, sessionCapabilities: resume ? { resume: {} } : {} }, agentInfo: { name: 'fake', version: '1' } }; },
      async newSession() { log.push('session/new'); return { sessionId: `s${++ids}` }; },
      async loadSession({ sessionId }) {
        log.push(`session/load ${sessionId}`);
        if (failLoad) { throw new RequestError(-32002, 'no such session'); }
        await conn.sessionUpdate({ sessionId, update: { sessionUpdate: 'user_message_chunk', content: { type: 'text', text: 'earlier' } } });
        return {};
      },
      async resumeSession({ sessionId }) { log.push(`session/resume ${sessionId}`); return {}; },
      async prompt() { return { stopReason: 'end_turn' }; },
      async cancel() { /* nothing runs */ },
    }), ndJsonStream(output, input));
  };
  return { run, log };
}

const toldOf = (c) => c.host.notifier.told;

test('P15: a second connect opens no second session: one session/new, one agent, the same session', async () => {
  const a = agent();
  const c = chatWith(a.run);
  try {
    await c.chat.flow.connect();
    const first = c.sessions.getActiveSessionId();
    await c.chat.flow.connect();
    await c.port.deliver({ type: 'connectAgent' });
    assert.equal(c.sessions.getActiveSessionId(), first);
    assert.deepEqual(a.log, ['session/new']);
    assert.equal(c.host.agents.spawned, 1);
  } finally { c.dispose(); }
});

test('P15 (recorded): R1 connected twice by the page is one session/new on the wire', async () => {
  const c = chatOn('R1');
  try {
    await c.port.deliver({ type: 'connectAgent' });
    await c.port.deliver({ type: 'connectAgent' });
    assert.equal(c.host.traffic.filter(t => t.direction === 'send' && t.message.method === 'session/new').length, 1);
  } finally { c.dispose(); }
});

test('with no agent set the person is offered the setting; taking the offer opens it, and nothing is started', async () => {
  const a = agent();
  const c = chatWith(a.run);
  try {
    c.host.settings.agents = () => ({});
    c.host.chooser.answer = false;
    await c.chat.flow.connect();
    assert.match(c.host.chooser.questions[0], /^No agent is set\. Name its program in the fake settings\./);
    assert.deepEqual(c.host.asked, [], 'declined: the setting is not opened');
    c.host.chooser.answer = true;
    await c.chat.flow.connect();
    assert.deepEqual(c.host.asked, ['configureAgent']);
    assert.equal(c.host.agents.spawned, 0);
  } finally { c.dispose(); }
});

test('a connect that fails is logged and told to the person, and does not throw', async () => {
  const c = chatWith((input, output) => { new AgentSideConnection(() => ({
    async initialize() { return { protocolVersion: 1, agentCapabilities: {} }; },
    async newSession() { throw new RequestError(-32002, 'out of quota'); },
  }), ndJsonStream(output, input)); });
  try {
    await c.chat.flow.connect();
    assert.deepEqual(toldOf(c).filter(t => t.startsWith('error')), ['error: Failed to connect: out of quota']);
    assert.ok(c.host.logged.some(l => /Failed to connect/.test(l)));
    assert.equal(c.host.agents.alive, 0, 'the agent that could not open a session is ended');
  } finally { c.dispose(); }
});

test('the log says that a prompt was sent and how long it is, never what it says (the editor keeps its log in a file)', async () => {
  const c = chatWith((input, output) => { new AgentSideConnection(() => ({
    async initialize() { return { protocolVersion: 1, agentCapabilities: {} }; },
    async newSession() { return { sessionId: 's1' }; },
    async prompt() { return { stopReason: 'end_turn' }; },
  }), ndJsonStream(output, input)); });
  try {
    await c.chat.flow.connect();
    await c.chat.sendPrompt('a secret sentence the log must not hold');
    assert.ok(c.host.logged.some(l => /sendPrompt: session=s1, 39 characters/.test(l)), c.host.logged.join(' | '));
    assert.ok(!c.host.logged.some(l => l.includes('secret')), 'the log holds words of the prompt');
  } finally { c.dispose(); }
});

test('a disconnect that fails is logged and told to the person, and does not throw', async () => {
  const c = chatWith((input, output) => { new AgentSideConnection(() => ({
    async initialize() { return { protocolVersion: 1, agentCapabilities: {} }; },
    async newSession() { return { sessionId: 's1' }; },
  }), ndJsonStream(output, input)); });
  try {
    await c.chat.flow.connect();
    c.sessions.disconnectAgent = async () => { throw new Error('the process would not end'); };
    await c.chat.flow.disconnect();
    assert.ok(toldOf(c).includes('error: Failed to disconnect: the process would not end'), toldOf(c).join(' | '));
    assert.ok(!toldOf(c).includes('info: Disconnected from the agent.'), 'a disconnect that failed is not announced as done');
    assert.ok(c.host.logged.some(l => /Failed to disconnect/.test(l)));
  } finally { c.dispose(); }
});

test('a new conversation asks first if messages would be lost; declined, nothing changes; accepted, the session is replaced and the page cleared', async () => {
  const a = agent();
  const c = chatWith(a.run);
  try {
    await c.chat.flow.connect();
    const first = c.sessions.getActiveSessionId();
    await c.chat.sendPrompt('hello');
    assert.ok(c.chat.hasChatContent);
    c.host.chooser.answer = false;
    await c.chat.flow.newConversation();
    assert.equal(c.sessions.getActiveSessionId(), first);
    assert.deepEqual(a.log, ['session/new']);
    assert.deepEqual(c.host.chooser.questions, ['Start a new conversation? The messages now shown are cleared.']);
    c.host.chooser.answer = true;
    await c.chat.flow.newConversation();
    assert.notEqual(c.sessions.getActiveSessionId(), first);
    assert.deepEqual(a.log, ['session/new', 'session/new']);
    assert.ok(c.port.toView.some(m => m.type === 'clearChat'));
    assert.ok(!c.chat.hasChatContent);
  } finally { c.dispose(); }
});

test('with no messages nothing is asked; with no session a new conversation is a connect', async () => {
  const a = agent();
  const c = chatWith(a.run);
  try {
    await c.chat.flow.newConversation();
    assert.deepEqual(a.log, ['session/new'], 'it connected');
    await c.chat.flow.newConversation();
    assert.deepEqual(c.host.chooser.questions, [], 'there was nothing to lose');
    assert.deepEqual(a.log, ['session/new', 'session/new']);
  } finally { c.dispose(); }
});

test('restart is a new conversation, and says it restarted', async () => {
  const a = agent();
  const c = chatWith(a.run);
  try {
    await c.chat.flow.connect();
    await c.chat.flow.restart();
    assert.deepEqual(a.log, ['session/new', 'session/new']);
    assert.ok(toldOf(c).includes('info: Restarted fake.'), toldOf(c).join(' | '));
    c.host.chooser.answer = false;
    await c.chat.sendPrompt('x');
    await c.chat.flow.restart();
    assert.equal(toldOf(c).filter(t => t.startsWith('info: Restarted')).length, 1, 'declined: it was not restarted again');
    assert.deepEqual(a.log, ['session/new', 'session/new']);
  } finally { c.dispose(); }
});

test('open: an agent that can load is asked to load, behind a progress; one that can only resume is asked to resume and the person is told the history is not shown', async () => {
  for (const [caps, wire, told] of [
    [{ load: true, resume: true }, 'session/load old', 'progress: Opening the session…'],
    [{ resume: true }, 'session/resume old', 'info: Resumed the session; its earlier messages are not shown.'],
  ]) {
    const a = agent(caps);
    const c = chatWith(a.run);
    try {
      await c.chat.flow.open('old');
      assert.deepEqual(a.log, [wire], 'no session/new: the session is one the agent has');
      assert.equal(c.sessions.getActiveSessionId(), 'old');
      assert.ok(toldOf(c).includes(told), toldOf(c).join(' | '));
    } finally { c.dispose(); }
  }
});

test('open: an agent that can neither load nor resume is an error told to the person', async () => {
  const a = agent();
  const c = chatWith(a.run);
  try {
    await c.chat.flow.open('old');
    assert.ok(toldOf(c).includes('error: Failed to open the session: the agent can neither load nor resume sessions'), toldOf(c).join(' | '));
    assert.equal(c.sessions.getActiveSessionId(), null);
  } finally { c.dispose(); }
});

test('open: the session that is open already is left alone; another with messages shown is asked about first', async () => {
  const a = agent({ load: true });
  const c = chatWith(a.run);
  try {
    await c.chat.flow.open('old');
    await c.chat.flow.open('old');
    assert.deepEqual(a.log, ['session/load old'], 'the open session is not loaded again');
    assert.ok(c.chat.hasChatContent, 'the replay filled the chat');
    c.host.chooser.answer = false;
    await c.chat.flow.open('other');
    assert.deepEqual(c.host.chooser.questions, ['Open a different session? The chat now shown is replaced.']);
    assert.deepEqual(a.log, ['session/load old'], 'declined: nothing was loaded');
    assert.equal(c.sessions.getActiveSessionId(), 'old');
  } finally { c.dispose(); }
});

test('open: a load the agent refuses is told to the person and leaves no session open', async () => {
  const a = agent({ load: true, failLoad: true });
  const c = chatWith(a.run);
  try {
    await c.chat.flow.open('gone');
    assert.ok(toldOf(c).some(t => /^error: Failed to open the session: .*no such session/.test(t)), toldOf(c).join(' | '));
    assert.equal(c.sessions.getActiveSessionId(), null);
  } finally { c.dispose(); }
});

test('an agent that ends on its own takes its session with it and the supply forgets it: the next connect starts a new one', async () => {
  const a = agent();
  const c = chatWith(a.run);
  try {
    await c.chat.flow.connect();
    const id = c.sessions.getActiveSession().agentId;
    c.host.agents.killAgent(id);
    assert.equal(c.sessions.getActiveSessionId(), null);
    await c.chat.flow.connect();
    assert.equal(c.host.agents.spawned, 2);
    assert.deepEqual(a.log, ['session/new', 'session/new']);
  } finally { c.dispose(); }
});

test('P15: two connects started together are one: one agent, one session/new (a double click, or the command and the button)', async () => {
  const a = agent();
  const c = chatWith(a.run);
  try {
    await Promise.all([c.chat.flow.connect(), c.chat.flow.connect(), c.port.deliver({ type: 'connectAgent' })]);
    assert.deepEqual(a.log, ['session/new']);
    assert.equal(c.host.agents.spawned, 1);
    assert.equal(c.host.agents.alive, 1, 'no orphaned agent');
  } finally { c.dispose(); }
});
