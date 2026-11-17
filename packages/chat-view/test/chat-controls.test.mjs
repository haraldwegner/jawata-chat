// His words, 2026-11-17: Esc must close the "/" list when the chat has lost focus; the chat needs a button for a new session; the principal's
// tool calls in Agent Control are folded by default, the latest turn's too, because with ten agents they fill the screen.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readSession } from '@jawata/acp-contract';
import { act, closeDom, sessionFile, viewOn } from './dom.mjs';

after(closeDom);

const notifications = (name, kind) => readSession(sessionFile(name)).filter(l => l.dir === 'recv' && l.msg.method === 'session/update' && l.msg.params.update.sessionUpdate === kind).map(l => l.msg.params.update);

async function withCommands(v) {
  await v.connect();
  await v.settle();
  await v.type('go');
  await v.key('Enter');
  await v.settle(() => v.$('textarea').placeholder.includes('/') && !v.$('.send-stop-btn.stop'));
  await v.type('/');
}

const slashOpen = (v) => v.$('.slash-popup').classList.contains('open');

test('Esc closes the "/" list when the chat has lost focus, not only while the input has it', async () => {
  const v = await viewOn('R3');
  try {
    await withCommands(v);
    assert.ok(slashOpen(v), 'the list is open after typing /');
    v.$('textarea').blur();
    await act(async () => { document.body.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); });
    assert.ok(!slashOpen(v), 'Esc closed it although the input has no focus');
  } finally { v.dispose(); }
});

test('Esc with the input focused still closes the "/" list, and another Esc elsewhere is left alone when the list is closed', async () => {
  const v = await viewOn('R3');
  try {
    await withCommands(v);
    await v.key('Escape');
    assert.ok(!slashOpen(v));
    const free = new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    await act(async () => { document.body.dispatchEvent(free); });
    assert.equal(free.defaultPrevented, false, 'a closed list takes no Esc from the rest of the page');
  } finally { v.dispose(); }
});

test('a button beside the input starts a new session: it asks the core for a new conversation', async () => {
  const v = await viewOn('R1');
  try {
    await v.connect();
    await v.settle();
    const intents = [];
    const deliver = v.port.deliver.bind(v.port);
    v.port.deliver = async (intent) => { intents.push(intent); await deliver(intent); };
    const button = v.$('.new-conversation-btn');
    assert.ok(button, 'the button is there');
    assert.match(button.getAttribute('title'), /new session/i, 'its mouseover says what it does');
    await v.click(button);
    assert.ok(intents.some(i => i.type === 'newConversation'), JSON.stringify(intents));
  } finally { v.dispose(); }
});

test('the principal\'s tool calls are folded by default, the latest turn\'s as well, and open on a click', async () => {
  const v = await viewOn('R2', { role: 'agents' });
  try {
    await v.connect();
    await v.settle();
    await act(async () => { await v.chat.sendPrompt('go'); });
    await v.settle(() => v.$$('.principal-calls .tool-call-inline .tc-icon.completed').length > 0);
    assert.ok(notifications('R2', 'tool_call').length > 0);
    const latest = v.$('.principal-calls details.principal-calls-latest');
    assert.ok(latest, 'the latest turn\'s calls are in a fold');
    assert.equal(latest.open, false, 'folded until asked for');
    assert.match(v.$('.principal-calls-title').textContent, /\d+ tool calls?/, 'the fold says how many calls it holds');
    await v.click(latest.querySelector('summary'));
    assert.equal(latest.open, true, 'a click opens it');
    assert.ok(latest.querySelector('.tool-call-inline'), 'the calls are in it');
  } finally { v.dispose(); }
});
