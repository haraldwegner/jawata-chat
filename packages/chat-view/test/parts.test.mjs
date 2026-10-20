// The parts of an answer, the waiting line, the tool call details, the command groups, the queue and the version notice, on the recorded sessions in a DOM.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { VIEW_CONTRACT_VERSION } from '@jawata/chat-core/view';
import { act, closeDom, viewOn, sessionFile } from './dom.mjs';

after(closeDom);

const lines = (name) => readFileSync(sessionFile(name), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
const notifications = (name, kind) => lines(name).filter(l => l.dir === 'recv' && l.msg.method === 'session/update' && l.msg.params.update.sessionUpdate === kind).map(l => l.msg.params.update);
const turnEnded = (v) => v.$('.turn .message.assistant') && !v.$('.send-stop-btn.stop');

const postUpdate = (v, update) => v.port.post({ type: 'sessionUpdate', sessionId: v.sessions.getActiveSessionId(), update });
const chunkOf = (kind, text) => ({ sessionUpdate: kind, content: { type: 'text', text } });

test('the waiting line shows from the send until answer text begins, names the tool under way, and goes with the turn', async () => {
  const v = await viewOn('R1');
  try {
    await v.connect();
    await v.settle();
    assert.ok(!v.$('.waiting-line'), 'nothing while idle');
    await act(async () => { v.port.post({ type: 'userPrompt', text: 'q' }); v.port.post({ type: 'promptStart' }); });
    assert.equal(v.$('.waiting-line').textContent, 'Thinking...', 'from the send, before anything arrives');
    assert.ok(v.$('.waiting-line .dots'), 'with moving dots');
    await act(async () => { postUpdate(v, chunkOf('agent_thought_chunk', 'hm')); });
    assert.ok(v.$('.waiting-line'), 'while it thinks');
    await act(async () => { postUpdate(v, { sessionUpdate: 'tool_call', toolCallId: 't', title: 'Preparing file…', status: 'pending', kind: 'edit' }); });
    assert.equal(v.$('.waiting-line .waiting-tool').textContent, 'Preparing file…');
    await act(async () => { postUpdate(v, { sessionUpdate: 'tool_call_update', toolCallId: 't', title: 'Write hello.txt', status: 'in_progress' }); });
    assert.equal(v.$('.waiting-line .waiting-tool').textContent, 'Write hello.txt', 'the tool\'s current title');
    await act(async () => { postUpdate(v, { sessionUpdate: 'tool_call_update', toolCallId: 't', status: 'completed' }); });
    assert.equal(v.$('.waiting-line').textContent, 'Thinking...', 'after the call ended, before the answer');
    await act(async () => { postUpdate(v, chunkOf('agent_message_chunk', 'Done')); });
    assert.ok(!v.$('.waiting-line'), 'answer text has begun');
    await act(async () => { v.port.post({ type: 'promptEnd', stopReason: 'end_turn' }); });
    assert.ok(!v.$('.waiting-line'));
  } finally { v.dispose(); }
});

test('an answer shows its parts in the order they came: thought, text, tool calls, thought, text', async () => {
  const v = await viewOn('R1');
  try {
    await v.connect();
    await v.settle();
    await act(async () => {
      v.port.post({ type: 'promptStart' });
      postUpdate(v, chunkOf('agent_thought_chunk', 'first'));
      postUpdate(v, chunkOf('agent_message_chunk', 'Hello'));
      postUpdate(v, { sessionUpdate: 'tool_call', toolCallId: 'a', title: 'A', status: 'completed', kind: 'read' });
      postUpdate(v, { sessionUpdate: 'tool_call', toolCallId: 'b', title: 'B', status: 'completed', kind: 'read' });
      postUpdate(v, chunkOf('agent_thought_chunk', 'second'));
      postUpdate(v, chunkOf('agent_message_chunk', 'Bye'));
      v.port.post({ type: 'promptEnd', stopReason: 'end_turn' });
    });
    const order = [...v.$('.turn').children].map(e => e.className.split(' ')[0] + ':' + (e.querySelector('.thought-content')?.textContent ?? e.textContent).replace(/\s+/g, ' ').trim().slice(0, 14));
    assert.deepEqual(order, ['thought-block:first', 'message:Hello', 'turn-tools:▾ 2 tool calls', 'thought-block:second', 'message:Bye'], 'several thoughts stay several, tool calls that follow each other are one run');
  } finally { v.dispose(); }
});

test('R2: a tool call line shows its kind, status and title; unfolded it shows what went in, the diff and what came out', async () => {
  const v = await viewOn('R2');
  try {
    await v.connect();
    await v.settle();
    await v.type('go');
    await v.key('Enter');
    await v.settle(() => v.$$('.tool-call-inline').length > 0 && !v.$('.send-stop-btn.stop'));
    const call = v.$('.tool-call-inline');
    assert.equal(call.open, false, 'folded');
    assert.ok(call.querySelector('summary .tc-kind').textContent.length > 0, 'an icon for its kind');
    assert.ok(call.querySelector('summary .tc-title').textContent.length > 0, 'a title');
    assert.ok(['✓', '✗'].includes(call.querySelector('summary .tc-icon').textContent), 'a status');
    assert.ok(!call.querySelector('summary').textContent.includes('File created'), 'the output is not in the line');
    call.open = true;
    assert.match(call.querySelector('.tc-input').textContent, /hello\.txt/, 'what went in');
    assert.match(call.querySelector('.tc-diff .add').textContent, /hi/, 'the diff');
    assert.match(call.querySelector('.tc-output').textContent, /File created successfully/, 'what came out');
  } finally { v.dispose(); }
});

test('there is no context meter and no compaction offer, though the agent sends usage', async () => {
  for (const name of ['R1', 'R2']) {
    assert.ok(readFileSync(sessionFile(name), 'utf8').includes('usage_update'), `${name} carries usage_update`);
    const v = await viewOn(name);
    try {
      await v.connect();
      await v.settle();
      await v.type('go');
      await v.key('Enter');
      await v.settle(() => turnEnded(v));
      assert.equal(v.$$('[class*="meter"], [class*="usage"], [class*="context"], [class*="compact"]').length, 0, `${name}: a meter element is rendered`);
    } finally { v.dispose(); }
  }
});

test('R3: / lists the commands in three groups, seats, skills and utilities, in that order, each entry in the group the agent put it in', async () => {
  const v = await viewOn('R3');
  try {
    await v.connect();
    await v.settle();
    await v.type('go');
    await v.key('Enter');
    await v.settle(() => v.$('textarea').placeholder.includes('/') && !v.$('.send-stop-btn.stop'));
    const sent = notifications('R3', 'available_commands_update').at(-1).availableCommands;
    await v.type('/');
    assert.deepEqual(v.$$('.slash-popup-group').map(e => e.textContent), ['Seats', 'Skills', 'Utilities']);
    const byGroup = { Seats: [], Skills: [], Utilities: [] };
    let group = '';
    for (const el of v.$$('.slash-popup-group, .slash-popup-item')) {
      if (el.classList.contains('slash-popup-group')) { group = el.textContent; } else { byGroup[group].push(el.querySelector('.cmd-name').textContent.slice(1)); }
    }
    const expected = (key) => sent.filter(c => c._meta?.['jawata/group'] === key).map(c => c.name).sort();
    assert.deepEqual(byGroup.Seats.slice().sort(), expected('seat'));
    assert.deepEqual(byGroup.Skills.slice().sort(), expected('skill'));
    assert.deepEqual(byGroup.Utilities.slice().sort(), expected('utility'));
    assert.ok(byGroup.Seats.length > 0 && byGroup.Skills.length > 0 && byGroup.Utilities.length > 0, 'all three groups hold commands');
    assert.ok(v.$$('.slash-popup-item .cmd-desc').every(e => e.textContent.length > 0), 'each with its purpose');
    assert.ok(v.$$('.slash-popup-item').every(e => e.getAttribute('title') === e.querySelector('.cmd-desc').textContent), 'the whole purpose is in the mouseover, since the line cuts it short');
    assert.match(v.$('.slash-popup-group').getAttribute('title'), /roles/, 'a group says what it is');
  } finally { v.dispose(); }
});

test('a prompt queued during a turn shows as queued with a Send now, which asks the core by intent', async () => {
  const v = await viewOn('R1');
  try {
    await v.connect();
    await v.settle();
    const intents = [];
    const deliver = v.port.deliver.bind(v.port);
    v.port.deliver = async (intent) => { intents.push(intent.type); await deliver(intent); };
    await act(async () => { v.port.post({ type: 'promptStart' }); v.port.post({ type: 'promptQueued', text: 'next one', files: ['a.txt'] }); });
    assert.match(v.$('.queued .queued-text').textContent, /next one \(\+1 file\)/);
    assert.equal(v.$('.queued .queued-text').getAttribute('title'), 'next one', 'the whole text is in the mouseover, since the line cuts it short');
    const now = v.$('.queued .queued-now');
    assert.match(now.getAttribute('title'), /Stops the running answer and sends this now/);
    await v.click(now);
    assert.deepEqual(intents, ['sendNow']);
  } finally { v.dispose(); }
});

test('a message of another version of the contract is refused with a notice that says what to do', async () => {
  const v = await viewOn('R1');
  try {
    await act(async () => { v.port.post({ type: 'state', contractVersion: 1, activeSessionId: null, session: null }); });
    const notice = v.$('.mismatch');
    assert.ok(notice, 'a notice');
    assert.match(notice.textContent, new RegExp(`version ${VIEW_CONTRACT_VERSION} .* version 1`));
    assert.match(notice.textContent, /Update the chat and reload it/);
    assert.equal(notice.getAttribute('role'), 'alert');
  } finally { v.dispose(); }
});


test('a tool call whose output is a terminal says so in words and shows no internal id', async () => {
  const v = await viewOn('R1');
  try {
    await v.connect();
    await v.settle();
    await act(async () => {
      v.port.post({ type: 'promptStart' });
      postUpdate(v, { sessionUpdate: 'tool_call', toolCallId: 'x', title: 'Run tests', status: 'completed', kind: 'execute', content: [{ type: 'terminal', terminalId: 'term-7f3a' }] });
    });
    const call = v.$('.tool-call-inline');
    call.open = true;
    assert.equal(call.querySelector('.tc-content').textContent, 'Its output is in a terminal of its own.');
    assert.ok(!call.textContent.includes('term-7f3a'));
  } finally { v.dispose(); }
});
