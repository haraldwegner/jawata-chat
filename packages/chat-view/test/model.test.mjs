// 28h S25 (D56 (f)): the model is chosen in the chat. The brain shown at the right of the input row is a picker offering what Agent
// Control's principal row offers, and a choice sends the very intent that row sends, so the agent gets one request whichever is used.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { act, closeDom, viewOn } from './dom.mjs';

after(closeDom);

/** Every intent the page sends, in order. */
function intentsOf(v) {
  const intents = [];
  const deliver = v.port.deliver.bind(v.port);
  v.port.deliver = async (intent) => { intents.push(intent); await deliver(intent); };
  return intents;
}

const choiceNames = (menu) => [...menu.querySelectorAll('[role="option"]')].map(o => o.textContent.replace('✓', '').trim());

/** Open the principal's brain menu in the given page and pick the choice named `name`; the intents it sent and the names offered. */
async function pick(role, button, name) {
  const v = await viewOn('R5', { role });
  try {
    await v.connect();
    await v.settle();
    const intents = intentsOf(v);
    await v.click(v.$(button));
    const menu = v.$('.brain-menu');
    assert.ok(menu, `${role}: the menu opens`);
    const offered = choiceNames(menu);
    await v.click([...menu.querySelectorAll('[role="option"]')].find(o => o.textContent.includes(name)));
    await v.settle(() => v.host.traffic.some(t => t.direction === 'send' && t.message.method === 'session/set_config_option'));
    const label = v.$(button).textContent;
    const sent = v.host.traffic.filter(t => t.direction === 'send' && t.message.method === 'session/set_config_option').map(t => [t.message.params.configId, t.message.params.value]);
    return { offered, intents: intents.filter(i => i.type !== 'listBrains'), label, sent, menuAfter: v.$('.brain-menu') };
  } finally { v.dispose(); }
}

test('R5: the brain at the right of the chat\'s input row is a picker that offers the models Agent Control offers for the principal', async () => {
  const chat = await pick('chat', '.input-toolbar .principal-brain', 'Default (recommended)');
  const control = await pick('agents', '.hire.principal .brain-btn', 'Default (recommended)');
  assert.ok(chat.offered.length > 1, chat.offered.join(', '));
  assert.deepEqual(chat.offered, control.offered, 'the same models in both places');
});

test('R5: a model chosen in the chat sends the request Agent Control sends, and the chat then shows the model the agent answered with', async () => {
  const chat = await pick('chat', '.input-toolbar .principal-brain', 'Default (recommended)');
  const control = await pick('agents', '.hire.principal .brain-btn', 'Default (recommended)');
  assert.deepEqual(chat.intents, [{ type: 'setConfigOption', configId: 'principal-brain', value: 'default' }]);
  assert.deepEqual(chat.intents, control.intents, 'one request, whichever place it was chosen in');
  assert.deepEqual(chat.sent, [['principal-brain', 'default']]);
  assert.match(chat.label, /^Default \(recommended\)/, 'the label shows the model now in use');
  assert.equal(chat.menuAfter, null, 'the menu closes on a choice');
});

test('R5: the model in use is marked in the chat\'s menu, and choosing it again sends nothing', async () => {
  const chat = await pick('chat', '.input-toolbar .principal-brain', 'Sonnet 5.5');
  assert.deepEqual(chat.intents, []);
  assert.deepEqual(chat.sent, []);
});

test('R5: the chat\'s model menu closes with Escape and sends nothing', async () => {
  const v = await viewOn('R5');
  try {
    await v.connect();
    await v.settle();
    const intents = intentsOf(v);
    await v.click(v.$('.input-toolbar .principal-brain'));
    assert.deepEqual(v.$$('.brain-menu [aria-selected="true"]').map(o => o.textContent), ['✓Sonnet 5.5'], 'the model in use is marked');
    await act(async () => { v.$('.brain-menu').dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); });
    assert.equal(v.$('.brain-menu'), null);
    assert.deepEqual(intents, []);
  } finally { v.dispose(); }
});

test('R5: with Agent Control open beside the chat, a model chosen in the chat shows in both places', async () => {
  const { LoopbackPort } = await import('@jawata/chat-core/test-support');
  const { mountChatView } = await import('../dist/index.js');
  const v = await viewOn('R5');
  const panel = new LoopbackPort();
  const beside = document.createElement('div');
  document.body.appendChild(beside);
  let mounted;
  try {
    await act(async () => { v.chat.attachPanel(panel); mounted = mountChatView(beside, panel.page, 'agents'); });
    await v.connect();
    await v.settle(() => beside.querySelector('.hire.principal .brain-btn'));
    assert.match(beside.querySelector('.hire.principal .brain-btn').textContent, /^Sonnet 5\.5/);
    await v.click(v.$('.input-toolbar .principal-brain'));
    await v.click(v.$$('.brain-menu [role="option"]').find(o => o.textContent.includes('Default (recommended)')));
    await v.settle(() => /^Default/.test(beside.querySelector('.hire.principal .brain-btn')?.textContent ?? ''));
    assert.match(v.$('.input-toolbar .principal-brain').textContent, /^Default \(recommended\)/);
    assert.match(beside.querySelector('.hire.principal .brain-btn').textContent, /^Default \(recommended\)/, 'Agent Control shows the model chosen in the chat');
  } finally { act(() => { mounted?.dispose(); }); beside.parentNode?.removeChild(beside); v.dispose(); }
});
