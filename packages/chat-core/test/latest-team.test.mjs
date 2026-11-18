// Stage 27 (u), his words 2026-11-18: after a fold, Agent Control said "8 finished" and showed none. The hires of the latest turn that hired anyone stay
// shown after they end, each under the agent that hired it; an earlier team is not part of that, and is counted instead.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initialViewState, latestTeam, workingTree } from '../dist/view-state.js';

const hire = (planId, extra = {}) => ({ planId, seat: 'dev', seatCommand: '', task: '', brain: 'b', model: 'm', state: 'done', elapsedMs: 0, tokens: 0, ...extra });
const hiringCall = (planId) => ({ kind: 'tool', tool: { toolCallId: 'c-' + planId, title: 'hire', status: 'completed', planId } });
const turn = (...parts) => ({ kind: 'turn', turn: { parts, ended: true } });

function stateWith(entries, hires) {
  return { ...initialViewState(), entries, hires };
}

test('the latest team is the hires of the latest turn that hired anyone, with everyone hired under them', () => {
  const state = stateWith(
    [turn(hiringCall('old-1')), turn({ kind: 'text', text: 'no hire this turn' }), turn(hiringCall('new-1')), turn({ kind: 'text', text: 'and none in the last' })],
    [hire('old-1'), hire('new-1'), hire('new-2', { parentPlanId: 'new-1' }), hire('new-3', { parentPlanId: 'new-2' }), hire('old-2', { parentPlanId: 'old-1' })]);

  assert.deepEqual([...latestTeam(state)].sort(), ['new-1', 'new-2', 'new-3'], 'the team is the latest hiring turn and what hangs under it, and no earlier one');
});

test('with no hiring turn there is no team, and a hire that ended is then not shown, as before', () => {
  const state = stateWith([turn({ kind: 'text', text: 'hello' })], [hire('a')]);

  assert.equal(latestTeam(state).size, 0);
  assert.deepEqual(workingTree(state.hires, latestTeam(state)), [], 'a hire that is neither working nor in the latest team was shown');
});

test('an ended member of the team is shown under its parent, an ended one outside the team is not, and a working one always is', () => {
  const hires = [hire('lead', { state: 'running' }), hire('dev', { parentPlanId: 'lead' }), hire('earlier', { state: 'failed' }), hire('busy', { state: 'running' })];
  const rows = workingTree(hires, new Set(['lead', 'dev']));

  assert.deepEqual(rows.map(r => `${r.depth}:${r.hire.planId}`), ['0:lead', '1:dev', '0:busy'], 'THE CLAIM: the ended dev is shown; CONTROL: the earlier one is not, the working one is');
});
