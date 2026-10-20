// The view renders what the core tells it, with no editor running: the recorded sessions on the in-memory host, in a DOM.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { act, closeDom, mountChatView, viewOn, sessionFile } from './dom.mjs';

after(closeDom);

const lines = (name) => readFileSync(sessionFile(name), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
const notifications = (name, kind) => lines(name).filter(l => l.dir === 'recv' && l.msg.method === 'session/update' && l.msg.params.update.sessionUpdate === kind).map(l => l.msg.params.update);
const turnEnded = (v) => v.$('.turn .message.assistant') && !v.$('.send-stop-btn.stop');

test('with no session the empty state offers to connect and to configure, by intent', async () => {
  const v = await viewOn('R1');
  try {
    assert.ok(v.$('.empty-state'));
    assert.ok(!v.$('.session-banner').classList.contains('visible'));
    await v.click(v.$('.action-btn.secondary'));
    assert.deepEqual(v.host.asked, ['configureAgent'], 'configuring is the host\'s to do');
    await v.click(v.$('.action-btn.primary'));
    await v.settle(() => v.$('.session-banner.visible'));
    assert.ok(v.sessions.getActiveSessionId(), 'connecting is the core\'s: it connected');
    assert.deepEqual(v.host.asked, ['configureAgent'], 'and asked the host for nothing');
  } finally { v.dispose(); }
});

test('R1: a connected chat shows the agent, a prompt typed and sent shows once, and the streamed answer follows', async () => {
  const v = await viewOn('R1');
  try {
    await v.connect();
    await v.settle(() => v.$('.session-banner.visible'));
    assert.ok(v.$('.session-banner').classList.contains('visible'));
    assert.equal(v.$('.session-banner .agent').textContent, 'Claude Agent');
    assert.ok(!v.$('.empty-state'));
    await v.type('hello there');
    await v.click(v.$('.send-stop-btn.send'));
    await v.settle(() => turnEnded(v));
    assert.deepEqual(v.$$('.message.user').map(e => e.textContent), ['hello there']);
    const sent = notifications('R1', 'agent_message_chunk').map(u => u.content.text).join('');
    assert.equal(v.$('.turn .message.assistant').textContent.trim(), sent.trim(), 'the answer text is the agent\'s');
    assert.equal(v.$('textarea').value, '');
    assert.ok(v.$('.send-stop-btn.send'), 'back to Send once the turn ends');
  } finally { v.dispose(); }
});

test('a one-word answer is one text node on one line: it is not split', async () => {
  const v = await viewOn('R1');
  try {
    await v.connect();
    await v.settle();
    await v.type('ping');
    await v.key('Enter');
    await v.settle(() => turnEnded(v));
    const answer = v.$('.turn .message.assistant');
    const word = notifications('R1', 'agent_message_chunk').map(u => u.content.text).join('').trim();
    assert.ok(word.length > 0 && !/\s/.test(word), 'R1\'s answer is one word: ' + word);
    assert.equal(answer.textContent.trim(), word);
    assert.equal(answer.querySelectorAll('br, wbr').length, 0);
    assert.doesNotMatch(window.getComputedStyle(answer).wordBreak, /break-all/);
  } finally { v.dispose(); }
});

test('R2: a tool call shows with its title and its outcome, and the turn counts its calls', async () => {
  const v = await viewOn('R2');
  try {
    await v.connect();
    await v.settle();
    await v.type('go');
    await v.key('Enter');
    await v.settle(() => v.$$('.tool-call-inline').length > 0 && !v.$('.send-stop-btn.stop'));
    const calls = notifications('R2', 'tool_call');
    assert.ok(calls.length > 0);
    // the title of each call as the agent last gave it: its own, or a later update's
    const lastTitle = new Map(calls.map(c => [c.toolCallId, c.title]));
    for (const u of notifications('R2', 'tool_call_update')) { if (u.title) { lastTitle.set(u.toolCallId, u.title); } }
    const titles = v.$$('.tool-call-inline .tc-title').map(e => e.textContent);
    assert.deepEqual(titles, calls.map(c => lastTitle.get(c.toolCallId)), 'one line per call, with the agent\'s title');
    assert.ok(titles.every(t => t.length > 0 && t !== 'Tool Call'), 'not the placeholder');
    assert.ok(v.$('.tool-call-inline .tc-icon.completed') || v.$('.tool-call-inline .tc-icon.failed'), 'the outcome shows');
    assert.match(v.$('.turn-tools-summary').textContent, /\d+ tool calls?/);
  } finally { v.dispose(); }
});

test('R3: typing / lists the agent\'s commands with their purpose; a command added to the list appears with no change to the chat', async () => {
  const v = await viewOn('R3');
  try {
    await v.connect();
    await v.settle();
    // R3's agent lists its commands during the first turn
    await v.type('go');
    await v.key('Enter');
    await v.settle(() => v.$('textarea').placeholder.includes('/') && !v.$('.send-stop-btn.stop'));
    const sent = notifications('R3', 'available_commands_update').at(-1).availableCommands;
    assert.ok(sent.length > 3);
    assert.equal(v.$('textarea').placeholder, 'Type a message or / for commands...');
    await v.type('/');
    const shown = v.$$('.slash-popup-item');
    assert.equal(shown.length, sent.length, 'every command is listed');
    const first = sent[0];
    assert.ok(shown.some(e => e.querySelector('.cmd-name').textContent === '/' + first.name && e.querySelector('.cmd-desc').textContent === first.description));
    const prefix = first.name.slice(0, 2).toLowerCase();
    await v.type('/' + prefix);
    assert.ok(v.$$('.slash-popup-item').every(e => e.querySelector('.cmd-name').textContent.toLowerCase().startsWith('/' + prefix)), 'the list narrows as the name is typed');
    v.port.post({ type: 'sessionUpdate', sessionId: v.sessions.getActiveSessionId(), update: { sessionUpdate: 'available_commands_update', availableCommands: [...sent, { name: 'zzextra', description: 'added by the test' }] } });
    await v.type('/zz');
    assert.deepEqual(v.$$('.slash-popup-item .cmd-name').map(e => e.textContent), ['/zzextra']);
  } finally { v.dispose(); }
});

test('a prompt sent by the core\'s command shows in the chat as well (the view draws it from the stream)', async () => {
  const v = await viewOn('R1');
  try {
    await v.connect();
    await v.settle();
    await act(async () => { await v.chat.sendPrompt('from a command'); });
    await v.settle();
    assert.deepEqual(v.$$('.message.user').map(e => e.textContent), ['from a command']);
  } finally { v.dispose(); }
});

test('while a turn runs the field stays open for the next message and Stop asks the core to cancel', async () => {
  const v = await viewOn('R1');
  try {
    await v.connect();
    await v.settle();
    await act(async () => { v.port.post({ type: 'promptStart' }); });
    assert.ok(!v.$('textarea').disabled, 'a message can be typed while the agent works');
    assert.equal(v.$('.send-stop-btn.send').textContent, 'Queue');
    await v.click(v.$('.send-stop-btn.stop'));
    await v.settle();
    assert.equal(v.host.traffic.filter(t => t.direction === 'send' && t.message.method === 'session/cancel').length, 1);
  } finally { v.dispose(); }
});

test('R5: the pickers show the agent\'s options; choosing one asks for it', async () => {
  const v = await viewOn('R5');
  try {
    await v.connect();
    await v.settle();
    assert.ok(v.$$('.picker-wrap').length >= 3);
    const wrap = v.$('.picker-wrap[data-config-id="effort"]');
    assert.ok(wrap);
    await v.click(wrap.querySelector('.picker-btn'));
    assert.ok(wrap.querySelector('.picker-dropdown').classList.contains('open'));
    const other = [...wrap.querySelectorAll('.picker-dropdown-item')].find(i => !i.classList.contains('selected'));
    await v.click(other);
    await v.settle(() => v.host.traffic.some(t => t.message.method === 'session/set_config_option'));
    const asked = v.host.traffic.filter(t => t.direction === 'send' && t.message.method === 'session/set_config_option').map(t => t.message.params);
    assert.deepEqual(asked.map(p => [p.configId, p.value]), [['effort', other.dataset.value]]);
    assert.ok(!wrap.querySelector('.picker-dropdown').classList.contains('open'), 'the list closes');
  } finally { v.dispose(); }
});

test('R6: a loaded session shows its history, the overlay covers the replay, and the person\'s earlier messages are there', async () => {
  const v = await viewOn('R6');
  try {
    await v.sessions.listSessions('agent');
    const sessionId = lines('R6').find(l => l.msg.method === 'session/load').msg.params.sessionId;
    await act(async () => { await v.sessions.loadSession('agent', sessionId); });
    await v.settle(() => !v.$('.load-overlay.visible'));
    assert.ok(!v.$('.load-overlay').classList.contains('visible'));
    const userChunks = notifications('R6', 'user_message_chunk').map(u => u.content.text).join('');
    assert.ok(userChunks.length > 0);
    assert.equal(v.$$('.message.user').map(e => e.textContent).join(''), userChunks);
    assert.ok(v.$$('.turn .message.assistant').length > 0);
  } finally { v.dispose(); }
});

test('an error the core reports shows as an error message', async () => {
  const v = await viewOn('R1');
  try {
    await act(async () => { v.port.post({ type: 'error', message: 'No active session. Create a session first.' }); });
    assert.equal(v.$('.message.error').textContent, 'No active session. Create a session first.');
  } finally { v.dispose(); }
});

test('an attached file shows as a chip, and goes with the next prompt as a reference', async () => {
  const v = await viewOn('R1');
  try {
    await v.connect();
    await v.settle();
    await act(async () => { v.chat.attachFile('/w/notes.txt'); });
    assert.equal(v.$('.attachment-chip .chip-name').textContent, 'notes.txt');
    await v.type('look');
    await v.key('Enter');
    await v.settle(() => turnEnded(v));
    assert.equal(v.$$('.message.user')[0].firstChild.textContent, 'look', 'the words are the person\'s own: no file text is written into them');
    assert.deepEqual(v.$$('.message.user .user-files .chip-name').map(e => e.textContent), ['notes.txt'], 'the file shows by name');
    const sent = v.host.traffic.filter(x => x.direction === 'send' && x.message.method === 'session/prompt').map(x => x.message.params.prompt)[0];
    assert.equal(sent[1].type, 'resource_link', 'and the agent is sent it as a link');
    assert.ok(!v.$('.attachments'), 'the chip leaves the input with the prompt');
  } finally { v.dispose(); }
});

test('a view that mounts after the conversation began is given the snapshot on ready and shows it', async () => {
  const v = await viewOn('R1');
  try {
    await v.connect();
    await v.settle();
    await v.type('first');
    await v.key('Enter');
    await v.settle(() => turnEnded(v));
    const second = document.createElement('div');
    document.body.appendChild(second);
    let late;
    await act(async () => { late = mountChatView(second, v.port.page); });
    await v.settle();
    assert.deepEqual([...second.querySelectorAll('.message.user')].map(e => e.textContent), ['first']);
    assert.ok(second.querySelector('.turn .message.assistant'));
    act(() => late.dispose());
    second.remove();
  } finally { v.dispose(); }
});

test('the answer\'s markdown is rendered once the turn ends, and sanitised: a script or an event handler in it does not reach the page', async () => {
  const v = await viewOn('R1');
  try {
    await v.connect();
    await v.settle();
    const id = v.sessions.getActiveSessionId();
    const chunk = (text) => v.port.post({ type: 'sessionUpdate', sessionId: id, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } } });
    await act(async () => {
      v.port.post({ type: 'promptStart' });
      chunk('**bold** <img src=x onerror="window.pwned=1"><script>window.pwned=2</script>');
    });
    assert.equal(v.$('.turn .message.assistant').classList.contains('md-rendered'), false, 'plain while it streams');
    await act(async () => { v.port.post({ type: 'promptEnd', stopReason: 'end_turn' }); });
    const answer = v.$('.turn .message.assistant');
    assert.ok(answer.classList.contains('md-rendered'));
    assert.equal(answer.querySelector('strong').textContent, 'bold');
    assert.equal(answer.querySelector('script'), null);
    assert.equal(answer.querySelector('img')?.getAttribute('onerror') ?? null, null);
    assert.equal(window.pwned, undefined);
  } finally { v.dispose(); }
});

test('R9: thinking shows as a folded line once the turn ends', async () => {
  const v = await viewOn('R9');
  try {
    await v.connect();
    await v.settle();
    await v.type('think');
    await v.key('Enter');
    await v.settle(() => turnEnded(v));
    const thought = v.$('.thought-block');
    assert.ok(thought, 'a thought block');
    assert.equal(thought.open, false);
    assert.equal(thought.querySelector('summary .thought-label').textContent, 'Thought');
    assert.equal(thought.querySelector('summary .thought-gist').textContent, thought.querySelector('.thought-content').textContent.trim().split('\n')[0], 'the folded line shows the summary the agent sent');
    assert.equal(v.$$('.thought-indicator').length, 0);
    assert.ok(thought.querySelector('.thought-content').textContent.length > 0);
  } finally { v.dispose(); }
});

test('R10: a plan shows its entries', async () => {
  const v = await viewOn('R10');
  try {
    await v.connect();
    await v.settle();
    await v.type('plan');
    await v.key('Enter');
    await v.settle(() => v.$('.plan') && !v.$('.send-stop-btn.stop'));
    const planned = notifications('R10', 'plan').at(-1).entries;
    assert.ok(v.$('.plan .plan-title'));
    assert.equal(v.$$('.plan').length, 1, 'one plan, the current one, not one per update');
    assert.equal(v.$('.plan').querySelectorAll('.plan-entry').length, planned.length);
    assert.deepEqual(v.$$('.plan .plan-entry.completed').length, planned.filter(e => e.status === 'completed').length, 'it shows the latest statuses');
    assert.ok(!v.$('.messages').contains(v.$('.plan')), 'it is kept on screen above the conversation, not scrolled away with it');
  } finally { v.dispose(); }
});

test('the blocks that no one decides with are gone: no icon, title or hint in the empty state, no header on the command list, no resize handle', async () => {
  const v = await viewOn('R3');
  try {
    assert.equal(v.$('.empty-state').querySelectorAll('.icon, .title, .subtitle, .hint').length, 0);
    assert.equal(v.$('.empty-state .sentence').textContent, 'No agent is connected.');
    await v.connect();
    await v.settle();
    await v.type('go');
    await v.key('Enter');
    await v.settle(() => v.$('textarea').placeholder.includes('/') && !v.$('.send-stop-btn.stop'));
    await v.type('/');
    assert.ok(v.$$('.slash-popup-item').length > 0);
    assert.equal(v.$$('.slash-popup-header').length, 0);
    assert.equal(v.$$('.input-resize-handle').length, 0);
  } finally { v.dispose(); }
});

test('what a control does is in its mouseover: connect, configure, send, stop, the banner, the calls, the thought, the error', async () => {
  const v = await viewOn('R2');
  try {
    const say = (el) => el.getAttribute('title');
    assert.match(say(v.$('.action-btn.primary')), /jawataChat\.agent/);
    assert.match(say(v.$('.action-btn.primary')), /opens a session/);
    assert.match(say(v.$('.action-btn.secondary')), /jawataChat\.agent setting/);
    await v.connect();
    await v.settle();
    assert.equal(say(v.$('.send-stop-btn.send')), 'Send (Enter)');
    assert.match(say(v.$('.session-banner .dot')), /^Connected to /);
    assert.match(say(v.$('.session-banner .info')), /works in/, 'the working folder is the mouseover of the name');
    assert.equal(v.$$('.session-banner .cwd').length, 0, 'and not a line of its own');
    await v.type('go');
    await v.key('Enter');
    await v.settle(() => v.$$('.tool-call-inline').length > 0 && !v.$('.send-stop-btn.stop'));
    assert.match(say(v.$('.turn-tools-summary')), /show or fold the calls/);
    assert.ok(['completed', 'failed', 'running', 'waiting to start'].includes(say(v.$('.tc-icon'))), 'a call says its state');
    await act(async () => { v.port.post({ type: 'promptStart' }); });
    assert.match(say(v.$('.send-stop-btn.stop')), /Stop the running answer/);
    await act(async () => { v.port.post({ type: 'error', message: 'x' }); });
    assert.match(say(v.$('.message.error')), /Sending again tries again/);
  } finally { v.dispose(); }
});

test('the thought line says what clicking it does', async () => {
  const v = await viewOn('R9');
  try {
    await v.connect();
    await v.settle();
    await v.type('think');
    await v.key('Enter');
    await v.settle(() => turnEnded(v));
    assert.match(v.$('.thought-block summary').getAttribute('title'), /reasoning/);
  } finally { v.dispose(); }
});

test('the banner offers to end the agent, by intent, and says what that does', async () => {
  const v = await viewOn('R1');
  try {
    assert.ok(!v.$('.session-banner').classList.contains('visible'), 'hidden while no session exists');
    await v.connect();
    await v.settle(() => v.$('.session-banner.visible'));
    const button = v.$('.session-banner .banner-btn:not(.history-btn)');
    assert.equal(button.textContent, 'Disconnect');
    assert.match(button.getAttribute('title'), /Ends the agent program/);
    await v.click(button);
    await v.settle(() => !v.$('.session-banner.visible'));
    assert.equal(v.sessions.getActiveSessionId(), null, 'the core ended the session');
    assert.deepEqual(v.host.asked, [], 'ending the agent is not the host\'s to decide');
  } finally { v.dispose(); }
});

test('an attached file can be taken out again, and only the one chosen', async () => {
  const v = await viewOn('R1');
  try {
    await v.connect();
    await v.settle();
    await act(async () => { v.chat.attachFile('/w/a.txt'); v.chat.attachFile('/w/b.txt'); });
    assert.deepEqual(v.$$('.attachment-chip .chip-name').map(e => e.textContent), ['a.txt', 'b.txt']);
    assert.equal(v.$('.attachment-chip').getAttribute('title'), '/w/a.txt', 'the path is the mouseover');
    await v.click(v.$('.attachment-chip .chip-remove'));
    await v.settle();
    assert.deepEqual(v.$$('.attachment-chip .chip-name').map(e => e.textContent), ['b.txt']);
  } finally { v.dispose(); }
});

test('the text field is as tall as its text, up to a limit, and there is nothing to drag', async () => {
  const v = await viewOn('R1');
  try {
    await v.connect();
    await v.settle();
    const height = (scrollHeight) => {
      Object.defineProperty(window.HTMLTextAreaElement.prototype, 'scrollHeight', { configurable: true, get: () => scrollHeight });
    };
    height(80);
    await v.type('a\nb\nc');
    assert.equal(v.$('textarea').style.height, '80px');
    height(5000);
    await v.type('a very long text');
    assert.equal(v.$('textarea').style.height, '240px', 'it stops growing at the limit');
    delete window.HTMLTextAreaElement.prototype.scrollHeight;
  } finally { v.dispose(); }
});

test('after the agent is disconnected the last conversation is gone and the chat offers to connect again', async () => {
  const v = await viewOn('R1');
  try {
    await v.connect();
    await v.settle();
    await v.type('hello');
    await v.key('Enter');
    await v.settle(() => turnEnded(v));
    assert.ok(v.$$('.message.user').length > 0);
    await act(async () => { await v.sessions.disconnectAgent('agent'); });
    await v.settle();
    assert.equal(v.$$('.message.user').length, 0, 'the conversation is not left on screen');
    assert.ok(v.$('.empty-state'), 'the chat offers to connect');
    assert.ok(!v.$('.session-banner').classList.contains('visible'));
  } finally { v.dispose(); }
});

test('a typed draft is kept by the core, and is in the field again after the page reloads; once sent it is gone', async () => {
  const v = await viewOn('R1');
  try {
    await v.connect();
    await v.settle();
    await v.type('half a thought');
    await v.settle(() => v.chat.snapshot().draft === 'half a thought');
    assert.equal(v.chat.snapshot().draft, 'half a thought', 'the core holds it');
    // the page reloads: a new page on the same core is given the state and the snapshot
    const second = document.createElement('div');
    document.body.appendChild(second);
    let late;
    await act(async () => { late = mountChatView(second, v.port.page); });
    await v.settle();
    assert.equal(second.querySelector('textarea').value, 'half a thought', 'the reloaded page has the draft back');
    act(() => late.dispose());
    second.remove();
    await v.key('Enter');
    await v.settle(() => v.chat.snapshot().draft === '');
    assert.equal(v.chat.snapshot().draft, '', 'sent, it is not a draft any more');
  } finally { v.dispose(); }
});

test('a new conversation or a clear empties the field; reloading or opening the chat in another place leaves it', async () => {
  const v = await viewOn('R1');
  try {
    await v.connect();
    await v.settle();
    await v.type('half a thought');
    await v.settle(() => v.chat.snapshot().draft === 'half a thought');
    // the same chat shown by a second page (another place): the field there has the text too
    const second = document.createElement('div');
    document.body.appendChild(second);
    let other;
    await act(async () => { other = mountChatView(second, v.port.page); });
    await v.settle();
    assert.equal(second.querySelector('textarea').value, 'half a thought');
    act(() => other.dispose());
    second.remove();
    assert.equal(v.$('textarea').value, 'half a thought', 'the first page keeps its text while another is opened');
    await act(async () => { v.chat.clearChat(); });
    await v.settle(() => v.chat.snapshot().draft === '');
    assert.equal(v.$('textarea').value, '', 'a cleared chat leaves no draft in the field');
    await v.type('after the clear');
    await v.settle(() => v.chat.snapshot().draft === 'after the clear');
    assert.equal(v.chat.snapshot().draft, 'after the clear', 'typing goes on being kept after a clear');
  } finally { v.dispose(); }
});
