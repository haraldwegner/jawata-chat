// The waiting line on the recorded sessions the plan names: R1 (real Claude, no thought), R2 (a tool call, then the answer) and
// R9 (a thought, derived). Every message the core told the page is folded in order, and the line is read at every step.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initialViewState, reduce, waitingLine } from '../dist/view-state.js';
import { played } from './play.mjs';

/** The state after each message, with what the line said and what the latest part of the open answer was. */
async function steps(name) {
  let state = initialViewState();
  const out = [];
  for (const message of await played(name)) {
    state = reduce(state, message);
    const last = state.entries.at(-1);
    const open = last && last.kind === 'turn' && !last.turn.ended ? last.turn.parts.at(-1) : undefined;
    out.push({ type: message.type, processing: state.processing, latest: open?.kind, tool: open?.kind === 'tool' ? open.tool : undefined, line: waitingLine(state) });
  }
  return out;
}

const working = (s) => s.processing;

for (const name of ['R1', 'R2', 'R9']) {
  test(`${name}: the line is there from the send until answer text begins, and gone while text is the latest part and after the turn`, async () => {
    const all = await steps(name);
    const turn = all.filter(working);
    assert.ok(turn.length > 0 && turn.some(s => s.line), `${name}: the line shows at some step`);
    for (const s of turn) {
      if (s.latest === 'text') { assert.equal(s.line, null, `${name}: present with text under way (${s.type})`); }
      else { assert.notEqual(s.line, null, `${name}: absent before the answer text (${s.type}, latest ${s.latest})`); }
    }
    assert.equal(all.filter(s => !s.processing).every(s => s.line === null), true, 'nothing between turns');
    const first = all.findIndex(working);
    assert.notEqual(all[first].line, null, 'from the send itself, before anything arrives');
  });
}

test('R2: while the tool call is pending or running the line carries that tool\'s current title, and after it ended it says only that the agent works', async () => {
  const all = await steps('R2');
  const underway = all.filter(s => s.tool && (s.tool.status === 'pending' || s.tool.status === 'in_progress'));
  assert.ok(underway.length > 0, 'R2 has a tool call under way');
  for (const s of underway) { assert.equal(s.line.tool, s.tool.title); }
  const done = all.filter(s => s.latest === 'tool' && s.tool.status === 'completed' && s.processing);
  assert.ok(done.length > 0);
  for (const s of done) { assert.deepEqual(s.line, {}); }
});

test('R9: the line stays through the thought, up to the first answer text, and the thought stays as a part', async () => {
  const all = await steps('R9');
  const thinking = all.filter(s => s.processing && s.latest === 'thought');
  assert.ok(thinking.length > 0, 'a thought arrives');
  for (const s of thinking) { assert.notEqual(s.line, null); }
});
