// The chat's link to an agent is an interface (architecture F13(e)): the SDK's connection class is used in one function, and what
// the chat asks of an agent goes out by the wire names the contract knows, including the older model list's request.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { AgentSideConnection, ndJsonStream } from '@agentclientprotocol/sdk';
import { chatWith } from '../dist/test-support.js';

const sources = readdirSync(new URL('../src/', import.meta.url)).filter(f => f.endsWith('.ts') && !f.endsWith('.d.ts'))
  .map(f => ({ name: f, text: readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8') }));

test('the SDK connection class is used in agent-link.ts and nowhere else, and no unstable SDK method is reached by a cast', () => {
  const uses = sources.filter(f => /\bClientSideConnection\b/.test(f.text.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, ''))).map(f => f.name);
  assert.deepEqual(uses, ['agent-link.ts']);
  assert.deepEqual(sources.filter(f => /unstable_|as unknown as/.test(f.text)).map(f => f.name), []);
});

test('an agent with the older model list is asked by session/set_model, and the chat does not fall over (the SDK has no method for it)', async () => {
  const c = chatWith((input, output) => { new AgentSideConnection(() => ({
    async initialize() { return { protocolVersion: 1, agentCapabilities: {} }; },
    async newSession() { return { sessionId: 's1', models: { availableModels: [{ modelId: 'a', name: 'A' }, { modelId: 'b', name: 'B' }], currentModelId: 'a' } }; },
  }), ndJsonStream(output, input)); });
  try {
    await c.chat.flow.connect();
    await c.sessions.setModel('s1', 'b').catch(() => { /* this agent answers method-not-found: the request is what is measured */ });
    const asked = c.host.traffic.filter(t => t.direction === 'send' && t.message.method === 'session/set_model').map(t => t.message.params);
    assert.deepEqual(asked, [{ sessionId: 's1', modelId: 'b' }]);
  } finally { c.dispose(); }
});
