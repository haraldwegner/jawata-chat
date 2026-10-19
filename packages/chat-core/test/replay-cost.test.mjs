// A long history replays at a cost that grows with its length, not its square. Folding a batch (reduceAll) changes the arrays the batch
// made in place, so the cost per message does not grow with the number of turns; the ceiling is tied to the measured growth (four times
// the turns must not cost more than eight times the time), which a copy on every message would fail (it costs sixteen times), and to an
// absolute bound far under what a person could feel.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initialViewState, reduce, reduceAll } from '../dist/view-state.js';
import { readFileSync } from 'node:fs';
import { sessionFile } from './play.mjs';

/** The updates a recorded session's agent sent, as messages to the page, in order: what a replay is made of. */
const updatesOf = (name) => readFileSync(sessionFile(name), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l))
  .filter(l => l.dir === 'recv' && l.msg.method === 'session/update')
  .map(l => ({ type: 'sessionUpdate', sessionId: l.msg.params.sessionId, update: l.msg.params.update }));

const timeOf = (messages) => {
  let best = Infinity;
  for (let i = 0; i < 3; i++) { const t0 = performance.now(); reduceAll(initialViewState(), messages); best = Math.min(best, performance.now() - t0); }
  return best;
};

test('R6 repeated: sixteen thousand turns fold in a time that grows with their number, not its square', () => {
  const replay = updatesOf('R6').filter(m => ['user_message_chunk', 'agent_message_chunk'].includes(m.update.sessionUpdate));
  assert.ok(replay.length >= 2, 'R6 replays a prompt and an answer');
  const turns = (n) => { const m = []; for (let i = 0; i < n; i++) { m.push(...replay); } return m; };
  const small = timeOf(turns(4000));
  const large = timeOf(turns(16000));
  assert.ok(large < 500, `16000 turns took ${large.toFixed(0)} ms`);
  assert.ok(large < Math.max(8 * small, 40), `4 times the turns took ${(large / small).toFixed(1)} times the time (${small.toFixed(0)} ms, ${large.toFixed(0)} ms)`);
});

test('one answer of thousands of tool calls folds in a time that grows with their number', () => {
  const u = (update) => ({ type: 'sessionUpdate', sessionId: 's', update });
  const calls = (n) => { const m = []; for (let i = 0; i < n; i++) {
    m.push(u({ sessionUpdate: 'tool_call', toolCallId: `t${i}`, title: 'Read', status: 'pending', kind: 'read' }));
    m.push(u({ sessionUpdate: 'tool_call_update', toolCallId: `t${i}`, status: 'completed' })); } return m; };
  const small = timeOf(calls(2400));
  const large = timeOf(calls(9600));
  assert.ok(large < 500, `9600 tool calls took ${large.toFixed(0)} ms`);
  assert.ok(large < Math.max(8 * small, 40), `4 times the calls took ${(large / small).toFixed(1)} times the time`);
});

test('a batch gives the state the messages one by one give, and nothing it hands on is changed afterwards', () => {
  for (const name of ['R2', 'R6', 'R7']) {
    const messages = updatesOf(name);
    assert.ok(messages.length > 2, `${name} has updates`);
    const one = messages.reduce(reduce, initialViewState());
    const batch = reduceAll(initialViewState(), messages);
    assert.deepEqual(JSON.parse(JSON.stringify(batch)), JSON.parse(JSON.stringify(one)), name);
    const frozen = JSON.stringify(batch);
    reduce(batch, { type: 'sessionUpdate', sessionId: 's', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'more' } } });
    reduceAll(batch, messages);
    assert.equal(JSON.stringify(batch), frozen, 'folding on from a batch changed it');
  }
});

test('the state a batch starts from is left as it was', () => {
  const messages = updatesOf('R2');
  const start = reduceAll(initialViewState(), messages);
  const frozen = JSON.stringify(start);
  reduceAll(start, messages);
  assert.equal(JSON.stringify(start), frozen);
});
