// The tap is the one recorder: whatever passes it reaches every sink, in the order it passed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tapStream } from '../dist/traffic-tap.js';

const script = [
  { dir: 'send', msg: { jsonrpc: '2.0', id: 0, method: 'initialize', params: { protocolVersion: 1 } } },
  { dir: 'recv', msg: { jsonrpc: '2.0', id: 0, result: { protocolVersion: 1 } } },
  { dir: 'send', msg: { jsonrpc: '2.0', id: 1, method: 'session/prompt', params: { sessionId: 's', prompt: [] } } },
  { dir: 'recv', msg: { jsonrpc: '2.0', method: 'session/update', params: { sessionId: 's', update: { sessionUpdate: 'agent_message_chunk' } } } },
  { dir: 'recv', msg: { jsonrpc: '2.0', id: 1, result: { stopReason: 'end_turn' } } },
];

test('every sink sees every message in the order it passed, in both directions, and the messages travel on unchanged', async () => {
  const toAgent = new TransformStream();
  const fromAgent = new TransformStream();
  const seenA = [];
  const seenB = [];
  const errors = [];
  const tapped = tapStream({ writable: toAgent.writable, readable: fromAgent.readable },
    [(d, m) => seenA.push({ dir: d, msg: m }), (d, m) => seenB.push({ dir: d, msg: m })], (_what, e) => errors.push(e));
  const clientWriter = tapped.writable.getWriter();
  const clientReader = tapped.readable.getReader();
  const agentReader = toAgent.readable.getReader();
  const agentWriter = fromAgent.writable.getWriter();
  for (const step of script) {
    if (step.dir === 'send') {
      await clientWriter.write(step.msg);
      assert.deepStrictEqual((await agentReader.read()).value, step.msg, 'the agent receives what the client sent');
    } else {
      await agentWriter.write(step.msg);
      assert.deepStrictEqual((await clientReader.read()).value, step.msg, 'the client receives what the agent sent');
    }
  }
  assert.deepStrictEqual(seenA, script);
  assert.deepStrictEqual(seenB, script);
  assert.deepStrictEqual(errors, []);
});

test('a failing sink is reported and does not stop the conversation or the other sinks', async () => {
  const toAgent = new TransformStream();
  const fromAgent = new TransformStream();
  const errors = [];
  const seen = [];
  const tapped = tapStream({ writable: toAgent.writable, readable: fromAgent.readable },
    [() => { throw new Error('disk full'); }, (d, m) => seen.push({ dir: d, msg: m })], (_what, e) => errors.push(e));
  const writer = tapped.writable.getWriter();
  const reader = toAgent.readable.getReader();
  await writer.write(script[0].msg);
  assert.deepStrictEqual((await reader.read()).value, script[0].msg);
  assert.equal(errors.length, 1);
  assert.deepStrictEqual(seen, [script[0]]);
});
