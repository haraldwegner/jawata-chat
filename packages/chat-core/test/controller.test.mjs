// The controller's own rules: which port it talks to, what it keeps of the conversation, what it lets go of.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { RecordingPort } from '../dist/test-support.js';
import { chatOn, sessionFile } from './play.mjs';

const types = (port) => port.toView.map(m => m.type);

test('attach replaces the port in use and returns a handle that lets go of it', async () => {
  const c = chatOn('R1');
  try {
    const second = new RecordingPort();
    const handle = c.chat.attach(second);
    await c.port.deliver({ type: 'ready' });
    assert.deepEqual(c.port.toView, [], 'the first port is no longer heard');
    await second.deliver({ type: 'ready' });
    assert.deepEqual(types(second), ['state', 'snapshot']);
    handle.dispose();
    second.toView.length = 0;
    await second.deliver({ type: 'ready' });
    assert.deepEqual(second.toView, [], 'a port that was let go of is not heard');
    c.chat.clearChat();
    assert.deepEqual(second.toView, [], 'nor told anything');
  } finally { c.dispose(); }
});

test('a port that is replaced is not told, and the log says a page was replaced (the core serves one page)', async () => {
  const c = chatOn('R1');
  try {
    c.chat.attach(new RecordingPort());
    c.port.toView.length = 0;
    c.chat.clearChat();
    assert.deepEqual(c.port.toView, [], 'the replaced page hears nothing more');
    assert.ok(c.host.logged.some(l => /a port was replaced/.test(l)));
  } finally { c.dispose(); }
});

test('attachIfFree: a page that resolves late does not take the place of a port in use', async () => {
  const c = chatOn('R1');
  try {
    const late = new RecordingPort();
    assert.equal(c.chat.attachIfFree(late), undefined);
    c.chat.clearChat();
    assert.deepEqual(types(c.port), ['clearChat'], 'the port in use is still told');
    assert.deepEqual(late.toView, []);
  } finally { c.dispose(); }
});

test('attachIfFree attaches when no port is, and again when the one in use is gone', () => {
  const c = chatOn('R1');
  try {
    const first = new RecordingPort();
    c.chat.attach(first).dispose();
    const late = new RecordingPort();
    const handle = c.chat.attachIfFree(late);
    assert.ok(handle);
    c.chat.clearChat();
    assert.deepEqual(types(late), ['clearChat']);
  } finally { c.dispose(); }
});

test('a port that says it is gone is let go of', () => {
  const c = chatOn('R1');
  try {
    let gone;
    const port = new RecordingPort();
    port.onDispose = (handler) => { gone = handler; return { dispose() {} }; };
    c.chat.attach(port);
    gone();
    c.chat.clearChat();
    assert.deepEqual(port.toView, []);
    assert.ok(c.chat.attachIfFree(new RecordingPort()), 'free again');
  } finally { c.dispose(); }
});

test('the conversation is kept with no page attached, and a page that comes later is caught up on ready', async () => {
  const c = chatOn('R1');
  try {
    c.chat.attach(c.port).dispose(); // no page
    await c.sessions.connectToAgent('agent');
    await c.chat.sendPrompt('hello');
    const late = new RecordingPort();
    c.chat.attach(late);
    await late.deliver({ type: 'ready' });
    assert.deepEqual(types(late).slice(0, 2), ['state', 'snapshot']);
    assert.deepEqual(late.toView[1].state.entries.map(e => e.kind), ['user', 'turn']);
  } finally { c.dispose(); }
});

test('clearing the chat clears what is kept of it', async () => {
  const c = chatOn('R1');
  try {
    await c.sessions.connectToAgent('agent');
    await c.chat.sendPrompt('hello');
    c.chat.clearChat();
    assert.equal(c.chat.hasChatContent, false);
    c.port.toView.length = 0;
    await c.port.deliver({ type: 'ready' });
    assert.deepEqual(c.port.toView[1].state.entries, []);
  } finally { c.dispose(); }
});

test('a session loaded replaces what was kept: the snapshot holds the replayed history', async () => {
  const c = chatOn('R6');
  try {
    const sessionId = readFileSync(sessionFile('R6'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)).find(l => l.msg.method === 'session/load').msg.params.sessionId;
    await c.sessions.listSessions('agent');
    await c.sessions.loadSession('agent', sessionId);
    c.port.toView.length = 0;
    await c.port.deliver({ type: 'ready' });
    const kept = c.port.toView.find(m => m.type === 'snapshot').state;
    assert.equal(kept.loading, false);
    assert.ok(kept.entries.length > 0 && kept.entries.some(e => e.kind === 'user'), 'the replayed history is in it');
  } finally { c.dispose(); }
});

test('attachFile tells the page the file by its name, whichever separator the path has, and brings the page into view', () => {
  const c = chatOn('R1');
  try {
    c.chat.attachFile('/a/b/notes.txt');
    c.chat.attachFile('C:\\a\\b\\other.txt');
    assert.deepEqual(c.port.toView.map(m => [m.type, m.name]), [['file-attached', 'notes.txt'], ['file-attached', 'other.txt']]);
    assert.equal(c.port.revealed, 2);
  } finally { c.dispose(); }
});

test('attachFile with no page attached says nothing and shows nothing', () => {
  const c = chatOn('R1');
  try {
    c.chat.attach(c.port).dispose();
    c.chat.attachFile('/a/notes.txt');
    assert.deepEqual(c.port.toView, []);
    assert.equal(c.port.revealed, 0);
  } finally { c.dispose(); }
});

test('after dispose the controller listens to nothing: no page is told, no listener is left on the session manager', async () => {
  const c = chatOn('R1');
  c.chat.dispose();
  try {
    await c.sessions.connectToAgent('agent');
    await c.sessions.sendPrompt(c.sessions.getActiveSessionId(), 'hello');
    assert.deepEqual(c.port.toView, []);
    assert.equal(c.sessions.emit('active-session-changed', null), false, 'nothing listens for it');
  } finally { c.sessions.dispose(); c.updates.dispose(); }
});

test('the title is passed on for the active session only', async () => {
  const c = chatOn('R1');
  try {
    await c.sessions.connectToAgent('agent');
    c.port.toView.length = 0;
    c.sessions.emit('session-info-changed', 'someone-else', { title: 'No' });
    c.sessions.emit('session-info-changed', c.sessions.getActiveSessionId(), { title: 'Yes' });
    assert.deepEqual(c.port.toView.map(m => [m.type, m.title]), [['sessionInfoUpdate', 'Yes']]);
  } finally { c.dispose(); }
});

test('another session starts the transcript afresh: a page that says ready is not given the last session\'s conversation', async () => {
  const c = chatOn('R1');
  try {
    await c.sessions.connectToAgent('agent');
    await c.chat.sendPrompt('first');
    await c.sessions.disconnectAgent('agent');
    await c.sessions.connectToAgent('agent'); // the replay hands out its recorded session id again, so the id alone does not tell the sessions apart
    c.port.toView.length = 0;
    await c.port.deliver({ type: 'ready' });
    assert.deepEqual(c.port.toView[1].state.entries, [], 'nothing of the first conversation');
  } finally { c.dispose(); }
});

test('an error in the conversation is kept in the state', async () => {
  const c = chatOn('R1');
  try {
    await c.chat.sendPrompt('no session yet'); // answered with an error, and that belongs to the conversation
    c.port.toView.length = 0;
    await c.port.deliver({ type: 'ready' });
    const kept = c.port.toView.find(m => m.type === 'snapshot');
    assert.deepEqual(kept.state.entries.map(e => e.kind), ['error']);
  } finally { c.dispose(); }
});

test('a page that cannot be reached does not fail the conversation', async () => {
  const c = chatOn('R1');
  try {
    c.port.post = () => { throw new Error('relay is gone'); };
    await c.sessions.connectToAgent('agent');
    await c.chat.sendPrompt('hello');
    assert.ok(c.host.logged.some(l => /could not be told/.test(l)), 'the failure is logged');
  } finally { c.dispose(); }
});
