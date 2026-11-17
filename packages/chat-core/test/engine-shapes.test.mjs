// 28h dogfood S19-1 and S19-4 (2026-11-17): the chat's own side of what jawata's agent really sends. A turn answered with a long message full of
// characters that take several bytes, on a stream that arrives in small pieces, must end the turn and let the next message through; a pick of
// the principal's brain and model must show in the options the chat holds, also after the turn's own option update. The agent is a small fake
// over the SDK that sends what the engine sends: the brain row, message chunks, tool lines, an option update and then the end of the turn.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AgentSideConnection, ndJsonStream } from '@agentclientprotocol/sdk';
import { chatWith } from '../dist/test-support.js';

const row = (value) => ({
  id: 'principal-brain', name: 'Brain of the principal', category: 'model', type: 'select', currentValue: value,
  options: [{ value: 'claude-code|opus', name: 'claude-code · Opus 5.5' }, { value: 'claude-code|sonnet', name: 'claude-code · Sonnet 5.5' }],
});

/** The same bytes, in pieces of this many bytes: a multi-byte character is cut in the middle, as a pipe may cut it. */
function inPieces(output, size) {
  const writer = output.getWriter();
  return new WritableStream({
    async write(chunk) { for (let at = 0; at < chunk.length; at += size) { await writer.write(chunk.slice(at, at + size)); } },
    async close() { await writer.close(); },
  });
}

const LONG = Array.from({ length: 90 }, (_, i) => `— ${i + 1} · αβγδε — the parsing of dates is harder than it looks, and the formats people use are many.`).join('\n');

function engineLikeAgent({ pieces }) {
  let picked = 'claude-code|opus';
  const run = (input, output) => {
    const connection = new AgentSideConnection(agentSide => ({
      async initialize() { return { protocolVersion: 1, agentCapabilities: {}, agentInfo: { name: 'engine-like', version: '1' } }; },
      async newSession() { return { sessionId: 's1', configOptions: [row(picked)] }; },
      async setSessionConfigOption({ value }) { picked = value; return { configOptions: [row(picked)] }; },
      async prompt() {
        await agentSide.sessionUpdate({ sessionId: 's1', update: { sessionUpdate: 'tool_call', toolCallId: 't1', title: 'Bash', kind: 'execute', status: 'in_progress' } });
        await agentSide.sessionUpdate({ sessionId: 's1', update: { sessionUpdate: 'tool_call_update', toolCallId: 't1', status: 'completed' } });
        await agentSide.sessionUpdate({ sessionId: 's1', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: LONG } } });
        await agentSide.sessionUpdate({ sessionId: 's1', update: { sessionUpdate: 'config_option_update', configOptions: [row(picked)] } });
        return { stopReason: 'end_turn' };
      },
      async cancel() {},
    }), ndJsonStream(pieces ? inPieces(output, pieces) : output, input));
    return connection;
  };
  return { run };
}

const tick = () => new Promise(r => setTimeout(r, 30));
const ended = (c) => c.port.toView.filter(m => m.type === 'promptEnd');
const heardText = (c) => c.port.toView.filter(m => m.type === 'sessionUpdate' && m.update.sessionUpdate === 'agent_message_chunk').map(m => m.update.content.text).join('');

for (const pieces of [0, 7, 1]) {
  test(`S19-1: a long answer of multi-byte characters on a stream cut in pieces of ${pieces || 'whole'} byte(s) ends the turn, and the next message is answered too`, async () => {
    const c = chatWith(engineLikeAgent({ pieces }).run);
    try {
      await c.sessions.connectToAgent('agent');
      await c.chat.sendPrompt('first');
      await tick();
      assert.equal(ended(c).length, 1, 'the turn did not end');
      assert.equal(ended(c)[0].stopReason, 'end_turn');
      assert.equal(heardText(c), LONG, 'the long answer arrived whole');
      await c.chat.sendPrompt('second');
      await tick();
      assert.equal(ended(c).length, 2, 'the second message was not answered');
    } finally { c.dispose(); }
  });
}

test('S19-4: after the person picks another model the options the chat holds name it, and the update that follows the turn keeps it', async () => {
  const c = chatWith(engineLikeAgent({ pieces: 0 }).run);
  try {
    await c.sessions.connectToAgent('agent');
    const shown = () => c.chat.snapshot().session?.configOptions?.find(o => o.id === 'principal-brain')?.currentValue;
    assert.equal(shown(), 'claude-code|opus');
    await c.port.deliver({ type: 'setConfigOption', configId: 'principal-brain', value: 'claude-code|sonnet' });
    await tick();
    assert.equal(shown(), 'claude-code|sonnet', 'the pick is not in the options the chat holds');
    await c.chat.sendPrompt('hello');
    await tick();
    assert.equal(shown(), 'claude-code|sonnet', 'the turn\'s own option update moved the model back');
    const updates = c.port.toView.filter(m => m.type === 'configOptionsUpdate' || m.type === 'state');
    assert.ok(updates.length > 0, 'the page was told of no options at all');
  } finally { c.dispose(); }
});
