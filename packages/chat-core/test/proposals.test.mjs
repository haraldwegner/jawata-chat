// A proposal (a permission request that carries a diff) is put to the person in the chat and waits for the answer; nothing else asks.
// The agent is a small fake over the SDK that asks while a prompt runs and keeps what it was answered.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AgentSideConnection, ndJsonStream } from '@agentclientprotocol/sdk';
import { chatWith } from '../dist/test-support.js';
import { AgentUpdates } from '../dist/agent-updates.js';

const options = [
  { optionId: 'allow-once', name: 'Yes', kind: 'allow_once' },
  { optionId: 'allow-with-updates', name: 'Yes, allow all edits during this session', kind: 'allow_always' },
  { optionId: 'reject', name: 'No', kind: 'reject_once' },
];
const diff = { type: 'diff', path: '/w/a.txt', oldText: null, newText: 'one\n' };

/** An agent that, in each prompt, asks about `content` and keeps the answer; the prompt ends when the answer is in. */
function askingAgent(content) {
  const answers = [];
  const run = (input, output) => {
    new AgentSideConnection((conn) => ({
      async initialize() { return { protocolVersion: 1, agentCapabilities: {}, agentInfo: { name: 'asking', version: '1' } }; },
      async newSession() { return { sessionId: 's1' }; },
      async prompt({ sessionId }) {
        answers.push(await conn.requestPermission({ sessionId, toolCall: { toolCallId: 't', title: 'Write a.txt', content }, options }));
        return { stopReason: 'end_turn' };
      },
      async cancel() { /* the answer to the question is what ends the prompt */ },
    }), ndJsonStream(output, input));
  };
  return { run, answers };
}

const tick = () => new Promise(r => setTimeout(r, 30));
const ofType = (c, type) => c.port.toView.filter(m => m.type === type);

async function asked(content = [diff]) {
  const agent = askingAgent(content);
  const c = chatWith(agent.run);
  await c.sessions.connectToAgent('agent');
  const turn = c.chat.sendPrompt('go');
  await tick();
  return { agent, c, turn };
}

test('a proposal is told to the page with its diff and the choices the agent offered, and the agent waits for the answer', async () => {
  const { agent, c } = await asked();
  try {
    const [request] = ofType(c, 'permissionRequest');
    assert.equal(request.title, 'Write a.txt');
    assert.deepEqual(request.diffs, [{ path: '/w/a.txt', oldText: null, newText: 'one\n' }]);
    assert.deepEqual(request.options.map(o => o.optionId), ['allow-once', 'allow-with-updates', 'reject']);
    assert.deepEqual(agent.answers, [], 'nothing is answered before the person does');
    assert.deepEqual(c.chat.snapshot().proposals.map(p => p.requestId), [request.requestId], 'a page that comes late is given it');
  } finally { c.dispose(); }
});

test('accept and reject each reach the agent, as the choice the person made', async () => {
  for (const choice of ['allow-once', 'reject']) {
    const { agent, c, turn } = await asked();
    try {
      const [request] = ofType(c, 'permissionRequest');
      await c.port.deliver({ type: 'answerPermission', requestId: request.requestId, optionId: choice });
      await turn;
      assert.deepEqual(agent.answers, [{ outcome: { outcome: 'selected', optionId: choice } }]);
      assert.deepEqual(ofType(c, 'permissionResolved').map(m => m.requestId), [request.requestId]);
      assert.deepEqual(c.chat.snapshot().proposals, []);
    } finally { c.dispose(); }
  }
});

test('an answer that names no waiting proposal, or a choice the agent did not offer, is ignored and the agent keeps waiting', async () => {
  const { agent, c, turn } = await asked();
  try {
    const [request] = ofType(c, 'permissionRequest');
    await c.port.deliver({ type: 'answerPermission', requestId: 'proposal-99', optionId: 'allow-once' });
    await c.port.deliver({ type: 'answerPermission', requestId: request.requestId, optionId: 'allow-forever' });
    await tick();
    assert.deepEqual(agent.answers, []);
    assert.equal(c.chat.snapshot().proposals.length, 1);
    assert.equal(c.host.logged.filter(l => /names nothing that waits/.test(l)).length, 2);
    await c.port.deliver({ type: 'answerPermission', requestId: request.requestId, optionId: 'reject' });
    await turn;
  } finally { c.dispose(); }
});

test('cancelling the turn, or clearing the chat, answers a waiting proposal as cancelled and takes it off the page', async () => {
  for (const how of ['cancel', 'clear']) {
    const { agent, c, turn } = await asked();
    try {
      if (how === 'cancel') { await c.port.deliver({ type: 'cancelTurn' }); } else { c.chat.clearChat(); }
      await turn;
      assert.deepEqual(agent.answers, [{ outcome: { outcome: 'cancelled' } }], how);
      assert.deepEqual(c.chat.snapshot().proposals, [], how);
    } finally { c.dispose(); }
  }
});

test('nothing else asks: a request with no diff is allowed at once with the first choice that allows, and the page is told nothing', async () => {
  const { agent, c, turn } = await asked([]);
  try {
    await turn;
    assert.deepEqual(agent.answers, [{ outcome: { outcome: 'selected', optionId: 'allow-once' } }]);
    assert.deepEqual(ofType(c, 'permissionRequest'), []);
  } finally { c.dispose(); }
});

test('with no chat to put a question to, an agent\'s request is answered as cancelled: nothing is allowed unasked', async () => {
  const answer = await new AgentUpdates().askPermission({ sessionId: 's', toolCall: { toolCallId: 't', title: 'x', content: [diff] }, options });
  assert.deepEqual(answer, { outcome: { outcome: 'cancelled' } });
});

test('a request with no diff takes the first choice that allows, not the first choice', async () => {
  const updates = new AgentUpdates();
  const c = chatWith(() => undefined);
  try {
    const { ChatController } = await import('../dist/chat-controller.js');
    const chat = new ChatController(c.sessions, updates, c.host, c.chat.flow);
    const answer = await updates.askPermission({
      sessionId: 's', toolCall: { toolCallId: 't', title: 'Run it' },
      options: [{ optionId: 'no', name: 'Reject', kind: 'reject_once' }, { optionId: 'yes', name: 'Allow', kind: 'allow_once' }],
    });
    assert.deepEqual(answer, { outcome: { outcome: 'selected', optionId: 'yes' } });
    chat.dispose();
  } finally { c.dispose(); }
});

test('a request with no diff is allowed this once, never as a standing grant, whatever order the agent lists its choices in; with no choice that allows once it is cancelled', async () => {
  const updates = new AgentUpdates();
  const c = chatWith(() => undefined);
  try {
    const { ChatController } = await import('../dist/chat-controller.js');
    const chat = new ChatController(c.sessions, updates, c.host, c.chat.flow);
    const ask = (opts) => updates.askPermission({ sessionId: 's', toolCall: { toolCallId: 't', title: 'Run it' }, options: opts });
    assert.deepEqual(await ask([{ optionId: 'always', name: 'Always', kind: 'allow_always' }, { optionId: 'once', name: 'Once', kind: 'allow_once' }]), { outcome: { outcome: 'selected', optionId: 'once' } });
    assert.deepEqual(await ask([{ optionId: 'always', name: 'Always', kind: 'allow_always' }, { optionId: 'no', name: 'No', kind: 'reject_once' }]), { outcome: { outcome: 'cancelled' } });
    chat.dispose();
  } finally { c.dispose(); }
});
