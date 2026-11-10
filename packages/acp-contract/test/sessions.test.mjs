// The recorded sessions: valid lines, the events each one is for, no private data, and R1/R2
// equal to the promoted real recordings they come from.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { userInfo } from 'node:os';
import { checkLevel1, promoteRecording, readSession } from '../dist/index.js';

const path = (rel) => new URL(rel, import.meta.url);
const session = (name) => readSession(path(`../sessions/${name}.jsonl`));
const updates = (s, kind) => s.filter((l) => update(l) === kind);
const update = (l) => l.msg.params?.update?.sessionUpdate;

for (const name of ['R1', 'R1-jawata', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7', 'R9', 'R10', 'R11', 'R12', 'R13', 'bases/hires', 'bases/model']) {
  test(`${name}: parses as a recorded session`, () => {
    assert.ok(session(name).length > 0);
  });
  test(`${name}: no account notice and no local path`, () => {
    const text = readFileSync(path(`../sessions/${name}.jsonl`), 'utf8');
    assert.ok(!text.includes('"_auth/'), 'an _auth notice');
    assert.ok(!/\/tmp\/|\/home\//.test(text), 'a local path');
  });
}

test('R1: a prompt sent and an answer streamed', () => {
  const s = session('R1');
  assert.ok(s.some((l) => l.dir === 'send' && l.msg.method === 'session/prompt'));
  assert.ok(s.some((l) => l.dir === 'recv' && update(l) === 'agent_message_chunk'));
});

test('R1-jawata: the same turn as R1 from the jawata agent itself, streamed through its launcher and accepted by the Level-1 check', () => {
  const s = session('R1-jawata');
  assert.ok(s.some((l) => l.dir === 'send' && l.msg.method === 'session/prompt'));
  assert.ok(s.some((l) => l.dir === 'recv' && update(l) === 'agent_message_chunk'));
  assert.deepEqual(checkLevel1(s), []);
});

test('R2: a tool call shown and its permission request answered', () => {
  const s = session('R2');
  assert.ok(s.some((l) => update(l) === 'tool_call'));
  assert.ok(s.some((l) => update(l) === 'tool_call_update' && l.msg.params.update.status === 'completed'));
  const ask = s.find((l) => l.dir === 'recv' && l.msg.method === 'session/request_permission');
  assert.ok(ask, 'the agent asked permission');
  const answer = s.find((l) => l.dir === 'send' && l.msg.id === ask.msg.id && l.msg.result);
  assert.equal(answer.msg.result.outcome.outcome, 'selected');
  assert.ok(s.some((l) => l.dir === 'recv' && update(l) === 'agent_message_chunk'));
});

test('R3 (shape only): every command carries a jawata group, and all three occur', () => {
  // The groups are assigned by name from jawata's deployed seats (derive overlay R3); R3 is re-recorded from 28h's agent.
  const cmds = session('R3').find((l) => update(l) === 'available_commands_update').msg.params.update.availableCommands;
  for (const c of cmds) { assert.ok(['seat', 'skill', 'utility'].includes(c._meta?.['jawata/group']), c.name); }
  assert.deepEqual([...new Set(cmds.map((c) => c._meta['jawata/group']))].sort(), ['seat', 'skill', 'utility']);
});

for (const [name, source] of [['R1', 'claude-s2-pong'], ['R2', 'claude-a1']]) {
  test(`${name} is ${source} as promoted, byte for byte`, () => {
    assert.equal(readFileSync(path(`../sessions/${name}.jsonl`), 'utf8'), readFileSync(path(`../../../docs/phase-a/${source}.jsonl`), 'utf8'));
  });
}

test('R4 (shape only): two hires overlap, one compacts, both end done; a stop and a transcript are asked after', () => {
  const s = session('R4');
  const hires = s.filter((l) => l.msg.params?.update?._meta?.['jawata/hire']).map((l) => l.msg.params.update._meta['jawata/hire']);
  assert.deepEqual([...new Set(hires.map((h) => h.planId))].sort(), ['p-architect', 'p-test-writer']);
  assert.ok(hires.some((h) => h.state === 'compacting'));
  assert.equal(hires.filter((h) => h.state === 'done').length, 2);
  const firstDone = s.findIndex((l) => l.msg.params?.update?._meta?.['jawata/hire']?.state === 'done');
  const secondStart = s.findIndex((l) => update(l) === 'tool_call' && l.msg.params.update._meta?.['jawata/hire']?.planId === 'p-test-writer');
  assert.ok(secondStart < firstDone, 'the second hire starts before the first ends');
  const asked = s.filter((l) => l.dir === 'send' && l.msg.method?.startsWith('_jawata/hire/')).map((l) => l.msg.method);
  assert.deepEqual(asked, ['_jawata/hire/stop', '_jawata/hire/transcript']);
});

test('R5 (shape only): one option for the principal\'s brain, and the change names it', () => {
  const s = session('R5');
  const ids = s.find((l) => l.msg.result?.configOptions).msg.result.configOptions.filter((o) => o.category === 'model').map((o) => o.id);
  assert.deepEqual(ids, ['principal-brain']);
  assert.equal(s.find((l) => l.msg.method === 'session/set_config_option').msg.params.configId, 'principal-brain');
});

test('R11 (shape only): the autonomy option is armed by a change, the answer shows on, then it is ended and the answer shows off', () => {
  const s = session('R11');
  const changes = s.filter((l) => l.dir === 'send' && l.msg.method === 'session/set_config_option');
  assert.deepEqual(changes.map((l) => [l.msg.params.configId, l.msg.params.value]), [['autonomy', 'on'], ['autonomy', 'off']]);
  const states = s.filter((l) => l.dir === 'recv' && l.msg.result?.configOptions).map((l) => l.msg.result.configOptions.find((o) => o.id === 'autonomy').currentValue);
  assert.deepEqual(states, ['off', 'on', 'off'], 'off at the start, on after the first change, off after the second');
  for (const change of changes) {
    const answer = s.find((l) => l.dir === 'recv' && l.msg.id === change.msg.id);
    assert.ok(answer, `change ${change.msg.id} is answered`);
    assert.equal(answer.msg.result.configOptions.find((o) => o.id === 'autonomy').currentValue, change.msg.params.value, 'the answer echoes the value set');
  }
});

test('R12 (shape only): a pm, a chief engineer under it and a dev under that, a list of brains, and a brain overwritten', () => {
  const s = session('R12');
  const hires = new Map();
  for (const l of s) {
    const h = l.msg.params?.update?._meta?.['jawata/hire'];
    if (h) { hires.set(h.planId, h); }
  }
  assert.deepEqual([...hires.keys()].sort(), ['p-ce', 'p-dev', 'p-pm']);
  assert.equal(hires.get('p-pm').parentPlanId, undefined, 'the pm is a root');
  assert.equal(hires.get('p-ce').parentPlanId, 'p-pm');
  assert.equal(hires.get('p-dev').parentPlanId, 'p-ce');
  assert.ok(s.some((l) => l.msg.params?.update?._meta?.['jawata/hire'] && l.msg.params.update._meta['jawata/hire'].costUsd === undefined), 'a hire that reports no cost');
  assert.equal(s.find((l) => l.dir === 'send' && l.msg.method === '_jawata/brains') !== undefined, true);
  const chose = s.find((l) => l.dir === 'send' && l.msg.method === '_jawata/hire/brain');
  assert.deepEqual(chose.msg.params, { planId: 'p-pm', brain: 'codex', model: 'gpt-5' });
  const answer = s.find((l) => l.dir === 'recv' && l.msg.id === chose.msg.id);
  assert.equal(answer.msg.result.brain, 'codex', 'the answer is the hire with its new brain');
  assert.equal(answer.msg.result.planId, 'p-pm');
});

test('R13 (shape only): a second session is opened beside the first and asked a question; its answer streams to that session, not the first', () => {
  const s = session('R13');
  const opened = s.filter((l) => l.dir === 'send' && l.msg.method === 'session/new');
  assert.equal(opened.length, 2, 'the main session and the side session');
  const ids = opened.map((l) => s.find((r) => r.dir === 'recv' && r.msg.id === l.msg.id).msg.result.sessionId);
  assert.notEqual(ids[0], ids[1]);
  assert.equal(opened[0].msg.params._meta, undefined, 'the first session is an ordinary one');
  assert.deepEqual(opened[1].msg.params._meta, { 'jawata/side': true }, 'the second says it is a side thread')
  const asked = s.filter((l) => l.dir === 'send' && l.msg.method === 'session/prompt');
  assert.deepEqual(asked.map((l) => l.msg.params.sessionId), [ids[0], ids[1]], 'one prompt for each session');
  const side = s.filter((l) => l.dir === 'recv' && l.msg.params?.sessionId === ids[1] && update(l) === 'agent_message_chunk');
  assert.equal(side.length, 1, 'the side answer streams to the side session');
  assert.ok(s.some((l) => l.dir === 'recv' && l.msg.id === asked[1].msg.id && l.msg.result.stopReason === 'end_turn'), 'the side prompt is answered');
});

test('R6: the list holds only this session, and the load replays the turn', () => {
  const s = session('R6');
  const listed = s.find((l) => l.msg.result?.sessions).msg.result.sessions;
  assert.equal(listed.length, 1);
  assert.equal(listed[0].cwd, '/workspace');
  const loadAt = s.findIndex((l) => l.msg.method === 'session/load');
  assert.ok(loadAt > 0);
  assert.ok(s.slice(loadAt).some((l) => update(l) === 'user_message_chunk'));
  assert.ok(s.slice(loadAt).some((l) => update(l) === 'agent_message_chunk'));
});

test('R7: two proposals as permission requests with a diff, answered yes and then no', () => {
  const s = session('R7');
  const asks = s.filter((l) => l.dir === 'recv' && l.msg.method === 'session/request_permission');
  assert.equal(asks.length, 2);
  for (const ask of asks) { assert.ok(ask.msg.params.toolCall.content.some((c) => c.type === 'diff'), 'a diff'); }
  const answers = asks.map((ask) => s.find((l) => l.dir === 'send' && l.msg.id === ask.msg.id && l.msg.result).msg.result.outcome.optionId);
  assert.deepEqual(answers, ['allow-once', 'reject']);
  assert.ok(updates(s, 'tool_call_update').some((l) => l.msg.params.update.status === 'failed'), 'the rejected write failed');
});

test('no recording the repository keeps holds a local path, a local user name or the adapter\'s mangled folder name', () => {
  const kept = [
    ...readdirSync(path('../sessions/'), { recursive: true }).filter((f) => String(f).endsWith('.jsonl')).map((f) => path(`../sessions/${f}`)),
    ...readdirSync(path('../../../docs/phase-a/')).filter((f) => f.endsWith('.jsonl')).map((f) => path(`../../../docs/phase-a/${f}`)),
  ];
  assert.ok(kept.length >= 18, `found ${kept.length} recordings`);
  for (const file of kept) {
    const text = readFileSync(file, 'utf8');
    assert.ok(!/\/tmp\/|\/home\/|\/Users\/|-home-|-Users-/i.test(text), `${file.pathname} holds a local path`);
    // The user name is looked for where a leak would put it (a path segment, a mangled folder name, an e-mail address, a ~name), not as a word
    // anywhere: on a CI runner the user is called "runner", which is also a word in an agent's own text ("Tool Runner").
    const user = userInfo().username.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    assert.ok(!new RegExp(`[/\\\\@~-]${user}(?![a-z0-9_])|(?<![a-z0-9_])${user}@`, 'i').test(text), `${file.pathname} holds this machine's user name`);
    assert.doesNotThrow(() => promoteRecording(readSession(file)), `${file.pathname} passes the promotion guard (chunked text included)`);
  }
});

test('R9 (shape only): thinking arrives as thought chunks before the answer, under one message id', () => {
  const s = session('R9');
  const thoughts = s.filter((l) => update(l) === 'agent_thought_chunk');
  assert.equal(thoughts.length, 2);
  assert.equal(new Set(thoughts.map((l) => l.msg.params.update.messageId)).size, 1);
  assert.ok(s.indexOf(thoughts[1]) < s.findIndex((l) => update(l) === 'agent_message_chunk'), 'thinking comes first');
});

test('R10 (shape only): the plan is sent whole each time and its entries move from pending to completed', () => {
  const plans = session('R10').filter((l) => update(l) === 'plan').map((l) => l.msg.params.update.entries.map((e) => e.status));
  assert.equal(plans.length, 3);
  assert.deepEqual(plans[0], ['pending', 'pending', 'pending']);
  assert.deepEqual(plans[2], ['completed', 'completed', 'completed']);
  for (const entries of session('R10').filter((l) => update(l) === 'plan').map((l) => l.msg.params.update.entries)) {
    for (const e of entries) { assert.ok(e.content && ['low', 'medium', 'high'].includes(e.priority) && ['pending', 'in_progress', 'completed'].includes(e.status)); }
  }
});
