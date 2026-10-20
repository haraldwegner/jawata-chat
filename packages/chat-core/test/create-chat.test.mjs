// One wiring (ledger C14-5, C13-5): the chat is built once, from a host's ports, by createChat; the root owns what lives longest.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { AgentSideConnection, ndJsonStream } from '@agentclientprotocol/sdk';
import { createChat } from '../dist/index.js';
import { fakeHost } from '../dist/test-support.js';

const sourcesOf = (pkg) => readdirSync(new URL(`../../${pkg}/src/`, import.meta.url), { recursive: true })
  .filter(f => /\.(ts|tsx)$/.test(String(f)) && !String(f).endsWith('.d.ts') && !/(^|\/)test/.test(String(f)))
  .map(f => ({ name: `${pkg}/${f}`, text: readFileSync(new URL(`../../${pkg}/src/${f}`, import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '') }));

const agent = (input, output) => { new AgentSideConnection(() => ({
  async initialize() { return { protocolVersion: 1, agentCapabilities: {} }; },
  async newSession() { return { sessionId: 's1' }; },
}), ndJsonStream(output, input)); };

test('the chat is built in one place: nothing but createChat constructs the sessions, the supply, the links or the controller', () => {
  const builders = (re) => [...sourcesOf('chat-core'), ...sourcesOf('chat-view'), ...sourcesOf('vscode')].filter(f => re.test(f.text)).map(f => f.name);
  assert.deepEqual(builders(/new (SessionManager|AgentSupply|ChatController|ConversationFlow|AgentUpdates)\(/), ['chat-core/create-chat.ts']);
  assert.deepEqual(builders(/new ConnectionManager\(/), ['chat-core/create-chat.ts']);
});

test('the page\'s end of the line is defined once', () => {
  const defined = [...sourcesOf('chat-core'), ...sourcesOf('chat-view'), ...sourcesOf('vscode')]
    .filter(f => /interface (PageTransport|PageEnd)\b/.test(f.text)).map(f => f.name);
  assert.deepEqual(defined, ['chat-core/view.ts']);
});

test('disposing the chat ends the agents; disposing the sessions alone does not (the supply is the root\'s)', async () => {
  const host = fakeHost(agent);
  const chat = createChat(host);
  try {
    await chat.flow.connect();
    assert.equal(host.agents.alive, 1);
    chat.sessions.dispose();
    assert.equal(host.agents.alive, 1, 'the sessions do not own the agents');
  } finally { chat.dispose(); }
  assert.equal(host.agents.alive, 0, 'the root ends them');
});
