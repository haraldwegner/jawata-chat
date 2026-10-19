// The reducer is a pure function: its rules one by one, and the one property that makes a snapshot trustworthy —
// folding every message the page was told, from nothing, gives exactly the state the core hands a page that comes late.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { initialViewState, reduce, waitingLine } from '../dist/view-state.js';
import { chatOn } from './play.mjs';
import { readFileSync } from 'node:fs';
import { sessionFile } from './play.mjs';

const update = (u) => ({ type: 'sessionUpdate', sessionId: 's', update: u });
const chunk = (kind, text) => update({ sessionUpdate: kind, content: { type: 'text', text } });
const session = { sessionId: 's', agentName: 'A', title: null, cwd: '/w', modes: { currentModeId: 'a', availableModes: [] }, models: null, configOptions: [], availableCommands: [] };
const fold = (messages, from = initialViewState()) => messages.reduce(reduce, from);

const open = { type: 'state', contractVersion: 2, activeSessionId: 's', session };
const parts = (s, i = 0) => s.entries[i].turn.parts.map(p => p.kind === 'tool' ? `tool:${p.tool.toolCallId}` : `${p.kind}:${p.text}`);

test('it does not change the state it is given', () => {
  const before = fold([open, { type: 'userPrompt', text: 'q' }, chunk('agent_message_chunk', 'a')]);
  const copy = JSON.parse(JSON.stringify(before));
  fold([chunk('agent_message_chunk', 'b'), update({ sessionUpdate: 'tool_call', toolCallId: 't', title: 'T', status: 'pending' })], before);
  assert.deepEqual(before, copy);
});

test('an answer holds its thinking, text and tool calls in the order they came; parts of one kind that follow each other are one part', () => {
  const s = fold([
    { type: 'userPrompt', text: 'q1' }, { type: 'promptStart' },
    chunk('agent_thought_chunk', 'hm'), chunk('agent_thought_chunk', 'm'),
    chunk('agent_message_chunk', 'He'), chunk('agent_message_chunk', 'llo'),
    update({ sessionUpdate: 'tool_call', toolCallId: 't1', title: 'Read', status: 'pending' }),
    chunk('agent_thought_chunk', 'again'),
    chunk('agent_message_chunk', 'Done'),
    { type: 'promptEnd', stopReason: 'end_turn' },
    { type: 'userPrompt', text: 'q2' }, { type: 'promptStart' }, chunk('agent_message_chunk', 'Again'),
  ]);
  assert.deepEqual(s.entries.map(e => e.kind), ['user', 'turn', 'user', 'turn']);
  assert.deepEqual(parts(s, 1), ['thought:hmm', 'text:Hello', 'tool:t1', 'thought:again', 'text:Done'], 'order kept, several thoughts not merged into one');
  assert.deepEqual(parts(s, 3), ['text:Again']);
  assert.equal(s.processing, true);
  assert.ok(!('turnOpen' in s), 'whether an answer is open is not part of the public state');
});

test('a tool call keeps its kind, input, output and content; an update names only what changed', () => {
  const s = fold([
    update({ sessionUpdate: 'tool_call', toolCallId: 't', title: 'Preparing file…', status: 'pending', kind: 'edit', rawInput: {} }),
    update({ sessionUpdate: 'tool_call_update', toolCallId: 't', title: 'Write a.txt', rawInput: { file_path: '/a.txt' } }),
    update({ sessionUpdate: 'tool_call_update', toolCallId: 't', content: [{ type: 'diff', path: '/a.txt', oldText: null, newText: 'hi\n' }] }),
    update({ sessionUpdate: 'tool_call_update', toolCallId: 't', status: 'completed', rawOutput: 'created' }),
    update({ sessionUpdate: 'tool_call_update', toolCallId: 'unknown', status: 'failed' }),
  ]);
  const tool = s.entries[0].turn.parts[0].tool;
  assert.deepEqual(tool, { toolCallId: 't', title: 'Write a.txt', status: 'completed', kind: 'edit', input: { file_path: '/a.txt' }, output: 'created', content: [{ type: 'diff', path: '/a.txt', oldText: null, newText: 'hi\n' }] });
});

test('leading whitespace does not start an answer; replayed user chunks join and end the answer before them', () => {
  const s = fold([chunk('agent_message_chunk', '\n'), chunk('user_message_chunk', 'a'), chunk('user_message_chunk', 'b'), chunk('agent_message_chunk', 'x')]);
  assert.deepEqual(s.entries.map(e => e.kind === 'user' ? e.text : parts(s, 1)[0]), ['ab', 'text:x']);
});

test('the plan is the current plan, each update replaces it, and it is not part of the conversation', () => {
  const first = [{ content: 'one', priority: 'high', status: 'pending' }];
  const second = [{ content: 'one', priority: 'high', status: 'completed' }, { content: 'two', priority: 'high', status: 'in_progress' }];
  const s = fold([chunk('agent_message_chunk', 'before'), update({ sessionUpdate: 'plan', entries: first }), chunk('agent_message_chunk', ' after'), update({ sessionUpdate: 'plan', entries: second })]);
  assert.deepEqual(s.plan, second);
  assert.deepEqual(s.entries.map(e => e.kind), ['turn'], 'no entry per update');
  assert.deepEqual(parts(s), ['text:before after'], 'a plan between two chunks of text does not split the answer');
  assert.equal(fold([{ type: 'clearChat' }], s).plan, null);
});

test('mode, config, commands and title go to the session', () => {
  const s = fold([
    open,
    update({ sessionUpdate: 'current_mode_update', currentModeId: 'plan' }),
    update({ sessionUpdate: 'config_option_update', configOptions: [{ id: 'e' }] }),
    update({ sessionUpdate: 'available_commands_update', availableCommands: [{ name: 'x', description: 'd' }] }),
    update({ sessionUpdate: 'session_info_update', title: 'T' }),
  ]);
  assert.equal(s.session.modes.currentModeId, 'plan');
  assert.deepEqual(s.session.configOptions, [{ id: 'e' }]);
  assert.equal(s.session.availableCommands[0].name, 'x');
  assert.equal(s.session.title, 'T');
});

test('without a session those updates change nothing', () => {
  const s = fold([update({ sessionUpdate: 'current_mode_update', currentModeId: 'plan' }), update({ sessionUpdate: 'available_commands_update', availableCommands: [] })]);
  assert.equal(s.session, null);
});

test('loading, clearing, errors and attached files; a prompt carries the names of its files', () => {
  let s = fold([{ type: 'file-attached', path: '/a/b.txt', name: 'b.txt' }]);
  assert.deepEqual(s.attachments, [{ path: '/a/b.txt', name: 'b.txt' }]);
  s = fold([{ type: 'userPrompt', text: 'q2', files: ['b.txt'] }], s);
  assert.deepEqual(s.attachments, [], 'the next prompt takes the files');
  assert.deepEqual(s.entries, [{ kind: 'user', text: 'q2', files: ['b.txt'] }]);
  s = fold([{ type: 'loadSessionStart' }], s);
  assert.deepEqual([s.entries, s.loading], [[], true]);
  s = fold([{ type: 'error', message: 'boom' }, { type: 'loadSessionEnd', ok: true }], s);
  assert.deepEqual([s.entries, s.loading], [[{ kind: 'error', message: 'boom' }], false]);
  s = fold([{ type: 'clearChat' }], s);
  assert.deepEqual(s.entries, []);
});

test('a prompt typed during a turn is queued, and the queue loses its first when that prompt is sent', () => {
  const s = fold([open, { type: 'userPrompt', text: 'one' }, { type: 'promptStart' }, { type: 'promptQueued', text: 'two' }, { type: 'promptQueued', text: 'three', files: ['a.txt'] }]);
  assert.deepEqual(s.queued, [{ text: 'two', files: [] }, { text: 'three', files: ['a.txt'] }]);
  const next = fold([{ type: 'promptEnd', stopReason: 'end_turn' }, { type: 'userPrompt', text: 'two' }, { type: 'promptStart' }], s);
  assert.deepEqual(next.queued, [{ text: 'three', files: ['a.txt'] }]);
  assert.equal(fold([{ type: 'clearChat' }], next).queued.length, 0);
});

test('a snapshot replaces the state', () => {
  const was = fold([{ type: 'userPrompt', text: 'q' }]);
  assert.deepEqual(fold([{ type: 'snapshot', state: initialViewState() }], was), initialViewState());
});

test('a message of another version of the contract is refused: the view says so and folds nothing more', () => {
  const was = fold([open, { type: 'userPrompt', text: 'q' }]);
  const stateOf1 = reduce(was, { type: 'state', contractVersion: 1, activeSessionId: 's', session });
  assert.equal(stateOf1.mismatch, 1);
  assert.equal(reduce(stateOf1, { type: 'userPrompt', text: 'more' }).entries.length, 1, 'nothing more is folded');
  const snapshotOf1 = reduce(was, { type: 'snapshot', state: { ...initialViewState(), contractVersion: 1 } });
  assert.equal(snapshotOf1.mismatch, 1);
  assert.equal(snapshotOf1.entries.length, 1, 'the snapshot of another version is not taken');
  assert.equal(was.mismatch, undefined);
});

test('the waiting line: from the send until answer text starts, naming the tool while one is under way', () => {
  const sent = fold([open, { type: 'userPrompt', text: 'q' }, { type: 'promptStart' }]);
  assert.deepEqual(waitingLine(sent), {}, 'from the send, before anything arrives');
  const thinking = reduce(sent, chunk('agent_thought_chunk', 'hm'));
  assert.deepEqual(waitingLine(thinking), {}, 'while it thinks');
  const tool = reduce(thinking, update({ sessionUpdate: 'tool_call', toolCallId: 't', title: 'Preparing file…', status: 'pending' }));
  assert.deepEqual(waitingLine(tool), { tool: 'Preparing file…' });
  const named = reduce(tool, update({ sessionUpdate: 'tool_call_update', toolCallId: 't', title: 'Write a.txt', status: 'in_progress' }));
  assert.deepEqual(waitingLine(named), { tool: 'Write a.txt' }, 'the tool\'s current title');
  const done = reduce(named, update({ sessionUpdate: 'tool_call_update', toolCallId: 't', status: 'completed' }));
  assert.deepEqual(waitingLine(done), {}, 'after the call ended and before the answer');
  const answering = reduce(done, chunk('agent_message_chunk', 'Done'));
  assert.equal(waitingLine(answering), null, 'answer text has begun');
  const moreWork = reduce(answering, update({ sessionUpdate: 'tool_call', toolCallId: 'u', title: 'Run tests', status: 'in_progress' }));
  assert.deepEqual(waitingLine(moreWork), { tool: 'Run tests' }, 'a tool after the text is under way');
  assert.equal(waitingLine(reduce(answering, { type: 'promptEnd', stopReason: 'end_turn' })), null, 'nothing between turns');
  assert.equal(waitingLine(initialViewState()), null);
});

for (const name of ['R1', 'R2', 'R3', 'R6', 'R7']) {
  test(`${name}: at every point, the state the core holds is the fold of what the page was told up to it, and a page that comes late is given exactly that`, async () => {
    const c = chatOn(name);
    try {
      // after each message the core posts, take the state it holds (the one a late page would be given)
      const points = [];
      const post = c.port.post.bind(c.port);
      c.port.post = (message) => { post(message); points.push({ message, held: JSON.stringify(c.chat.snapshot()) }); };
      if (name === 'R6') {
        const sessionId = readFileSync(sessionFile(name), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)).find(l => l.msg.method === 'session/load').msg.params.sessionId;
        await c.sessions.listSessions('agent');
        await c.sessions.loadSession('agent', sessionId);
      } else {
        await c.sessions.connectToAgent('agent');
        await c.chat.sendPrompt('replay');
      }
      await new Promise(r => setTimeout(r, 150));
      assert.ok(points.length > 5, `${points.length} points`);
      let folded = initialViewState();
      points.forEach((p, i) => {
        folded = reduce(folded, p.message);
        assert.equal(JSON.stringify(folded), p.held, `after message ${i} (${p.message.type})`);
      });
      // and what a late page is actually sent is the same state
      c.port.post = post;
      c.port.toView.length = 0;
      await c.port.deliver({ type: 'ready' });
      const snapshot = c.port.toView.find(m => m.type === 'snapshot').state;
      assert.equal(JSON.stringify(snapshot), JSON.stringify(folded));
      assert.ok(snapshot.entries.length > 0);
    } finally { c.dispose(); }
  });
}

test('the state of another session, or of none, begins the conversation afresh; the state of the same session keeps it', () => {
  const talked = fold([open, { type: 'userPrompt', text: 'q' }, chunk('agent_message_chunk', 'a'), { type: 'file-attached', path: '/w/a', name: 'a' }, update({ sessionUpdate: 'plan', entries: [{ content: 'x', priority: 'high', status: 'pending' }] })]);
  assert.equal(talked.entries.length, 2);
  const again = reduce(talked, { ...open, session: { ...session, title: 'Named' } });
  assert.equal(again.entries.length, 2, 'the same session: what is shown about it changes, the conversation stays');
  assert.equal(again.session.title, 'Named');
  const none = reduce(talked, { type: 'state', contractVersion: 2, activeSessionId: null, session: null });
  assert.deepEqual([none.entries.length, none.attachments.length, none.plan, none.session], [0, 0, null, null], 'no session: nothing of the last conversation is left on screen');
  const other = reduce(talked, { ...open, activeSessionId: 't', session: { ...session, sessionId: 't' } });
  assert.deepEqual([other.entries.length, other.attachments.length, other.plan], [0, 0, null], 'another session: it starts afresh');
});

test('an empty thought, or one of only spaces, begins no thought; a space inside a thought that is going on stays', () => {
  const none = reduce(reduce(initialViewState(), { type: 'promptStart' }), chunk('agent_thought_chunk', ''));
  assert.equal(none.entries.length, 0, 'nothing to show, so no part and no answer');
  const blank = reduce(none, chunk('agent_thought_chunk', '  \n'));
  assert.equal(blank.entries.length, 0);
  const going = [chunk('agent_thought_chunk', 'one'), chunk('agent_thought_chunk', ' '), chunk('agent_thought_chunk', 'two')].reduce(reduce, none);
  assert.deepEqual(parts(going, 0), ['thought:one two']);
});
