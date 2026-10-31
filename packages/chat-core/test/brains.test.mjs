// Changing an agent's brain: the page is told what the agent answered, and an answer that does not describe the hire is told as an error,
// so a click never does nothing in silence. The agent is a small fake over the SDK.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AgentSideConnection, ndJsonStream } from '@agentclientprotocol/sdk';
import { chatWith } from '../dist/test-support.js';

function agent(answer) {
  return (input, output) => {
    new AgentSideConnection(() => ({
      async initialize() { return { protocolVersion: 1, agentCapabilities: {}, agentInfo: { name: 'b', version: '1' } }; },
      async newSession() { return { sessionId: 's1' }; },
      async prompt() { return { stopReason: 'end_turn' }; },
      async cancel() { /* not used */ },
      async extMethod(method) { return method === '_jawata/brains' ? { brains: [{ brain: 'x', model: 'y' }] } : answer; },
    }), ndJsonStream(output, input));
  };
}

test('an answer that does not describe the hire is told to the person as an error, and no hire is invented', async () => {
  const c = chatWith(agent({}));
  try {
    await c.sessions.connectToAgent('agent');
    c.port.toView.length = 0;
    await c.port.deliver({ type: 'chooseBrain', planId: 'p', brain: 'x', model: 'y' });
    assert.deepEqual(c.port.toView.map(m => m.type), ['error']);
    assert.equal(c.chat.snapshot().hires.length, 0);
  } finally { c.dispose(); }
});

test('an answer that describes the hire is folded into the panel', async () => {
  const c = chatWith(agent({ planId: 'p', seat: 's', seatCommand: '/s', task: 't', brain: 'x', model: 'y', state: 'running', elapsedMs: 1, tokens: 2 }));
  try {
    await c.sessions.connectToAgent('agent');
    await c.port.deliver({ type: 'chooseBrain', planId: 'p', brain: 'x', model: 'y' });
    assert.deepEqual(c.chat.snapshot().hires.map(h => `${h.planId}:${h.brain}/${h.model}`), ['p:x/y']);
  } finally { c.dispose(); }
});
