// Every intent the page can send is delivered through the port to the core, on the in-memory host, and its effect is asserted
// on the stream the page is told or on what the agent was sent. A member of the intent union that no test delivers fails the last test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VIEW_INTENT_TYPES, isViewIntent } from '../dist/index.js';
import { chatOn } from './play.mjs';

const delivered = new Set();

/** A chat whose agent plays the named session; deliveries through its port are counted. */
function opened(name) {
  const c = chatOn(name);
  const deliver = c.port.deliver.bind(c.port);
  c.port.deliver = async (intent) => { if (isViewIntent(intent)) { delivered.add(intent.type); } await deliver(intent); };
  return c;
}

/** The same, connected to its agent. */
async function connected(name) {
  const c = opened(name);
  await c.sessions.connectToAgent('agent');
  c.port.toView.length = 0;
  c.sent = (method) => c.host.traffic.filter(t => t.direction === 'send' && t.message.method === method).map(t => t.message.params);
  return c;
}
const types = (port) => port.toView.map(m => m.type);

test('ready: the page is told the state, and then the snapshot of the conversation it has missed', async () => {
  const c = await connected('R1');
  try {
    await c.port.deliver({ type: 'ready' });
    assert.deepEqual(types(c.port), ['state', 'snapshot'], 'a first page is given the state, and the snapshot of an empty conversation');
    assert.equal(c.port.toView[0].contractVersion, 2);
    assert.equal(c.port.toView[0].session.agentName, 'Claude Agent');
    await c.port.deliver({ type: 'sendPrompt', text: 'hello' });
    c.port.toView.length = 0;
    await c.port.deliver({ type: 'ready' });
    assert.deepEqual(types(c.port), ['state', 'snapshot'], 'a page that comes later is caught up');
    const caught = c.port.toView[1].state;
    assert.equal(caught.entries[0].kind, 'user');
    assert.equal(caught.entries[0].text, 'hello');
    assert.equal(caught.entries[1].kind, 'turn');
    assert.ok(caught.entries[1].turn.parts.some(p => p.kind === 'text' && p.text.length > 0));
    assert.equal(caught.processing, false);
  } finally { c.dispose(); }
});

test('sendPrompt: the turn is begun, run on the agent and ended, and the prompt reaches the agent', async () => {
  const c = await connected('R1');
  try {
    await c.port.deliver({ type: 'sendPrompt', text: 'hello there' });
    const t = types(c.port);
    assert.deepEqual(c.port.toView[0], { type: 'userPrompt', text: 'hello there', files: [] }, 'the page is told the prompt, so it can show it');
    assert.equal(t[1], 'promptStart');
    assert.equal(t.at(-1), 'promptEnd');
    assert.ok(t.includes('sessionUpdate'));
    const [prompt] = c.sent('session/prompt');
    assert.equal(prompt.prompt[0].text, 'hello there');
    assert.equal(c.chat.hasChatContent, true);
  } finally { c.dispose(); }
});

test('sendPrompt without a session: the page is told there is none', async () => {
  const c = opened('R1');
  try {
    await c.port.deliver({ type: 'sendPrompt', text: 'hello' });
    assert.deepEqual(c.port.toView.map(m => [m.type, m.message]), [['error', 'No active session. Create a session first.']]);
  } finally { c.dispose(); }
});

test('the prompt command and the page\'s own send are the same intent: the same stream', async () => {
  const viaPage = await connected('R1');
  const viaCommand = await connected('R1');
  try {
    await viaPage.port.deliver({ type: 'sendPrompt', text: 'same' });
    await viaCommand.chat.sendPrompt('same');
    const strip = (port) => JSON.stringify(port.toView, (k, v) => (k === 'sessionId' || k === 'messageId' ? undefined : v));
    assert.equal(strip(viaCommand.port), strip(viaPage.port));
    assert.deepEqual(viaCommand.port.toView[0], { type: 'userPrompt', text: 'same', files: [] }, 'a prompt sent by the command is shown too');
    assert.equal(viaCommand.chat.hasChatContent, true);
  } finally { viaPage.dispose(); viaCommand.dispose(); }
});

test('cancelTurn: the agent is told to cancel the session', async () => {
  const c = await connected('R1');
  try {
    await c.port.deliver({ type: 'cancelTurn' });
    await new Promise(r => setTimeout(r, 50));
    assert.deepEqual(c.sent('session/cancel').map(p => p.sessionId), [c.sessions.getActiveSessionId()]);
  } finally { c.dispose(); }
});

test('setMode: the agent is asked to set the mode option', async () => {
  const c = await connected('R5');
  try {
    await c.port.deliver({ type: 'setMode', modeId: 'plan' });
    assert.deepEqual(c.sent('session/set_config_option').map(p => [p.configId, p.value]), [['mode', 'plan']]);
  } finally { c.dispose(); }
});

test('setModel: the agent is asked to set the model option', async () => {
  const c = await connected('R5');
  try {
    await c.port.deliver({ type: 'setModel', modelId: 'opus' });
    assert.deepEqual(c.sent('session/set_config_option').map(p => [p.configId, p.value]), [['seat-model:architect', 'opus']]);
  } finally { c.dispose(); }
});

test('setConfigOption: the agent is asked, and the page is told the options it answered with', async () => {
  const c = await connected('R5');
  try {
    await c.port.deliver({ type: 'setConfigOption', configId: 'effort', value: 'low' });
    assert.deepEqual(c.sent('session/set_config_option').map(p => [p.configId, p.value]), [['effort', 'low']]);
    const update = c.port.toView.find(m => m.type === 'configOptionsUpdate');
    assert.ok(update && Array.isArray(update.configOptions) && update.configOptions.length > 0);
  } finally { c.dispose(); }
});

test('setConfigOption refused by the agent: the page is told, and given the options as they were', async () => {
  const c = await connected('R1'); // R1 records no set_config_option: the agent has nothing to answer with
  try {
    await c.port.deliver({ type: 'setConfigOption', configId: 'effort', value: 'low' });
    const t = types(c.port);
    assert.ok(t.includes('error') && t.at(-1) === 'configOptionsUpdate', t.join(','));
  } finally { c.dispose(); }
});

test('connectAgent: the core connects and opens the session; configureAgent: the host is asked, by name', async () => {
  const c = opened('R1');
  try {
    await c.port.deliver({ type: 'connectAgent' });
    assert.ok(c.sessions.getActiveSessionId(), 'a session is open');
    assert.deepEqual(c.host.asked, [], 'connecting is not something the host decides');
    await c.port.deliver({ type: 'configureAgent' });
    assert.deepEqual(c.host.asked, ['configureAgent']);
  } finally { c.dispose(); }
});

test('sendNow: with nothing queued and no turn running it does nothing (queue and steer are in queue.test.mjs)', async () => {
  const c = await connected('R1');
  try {
    await c.port.deliver({ type: 'sendNow' });
    assert.deepEqual(c.port.toView, []);
    assert.deepEqual(c.sent('session/cancel'), []);
    assert.deepEqual(c.sent('session/prompt'), []);
  } finally { c.dispose(); }
});

test('disconnectAgent: the core ends the agent and the session, and tells the person; with none connected it says so', async () => {
  const c = await connected('R1');
  try {
    await c.port.deliver({ type: 'disconnectAgent' });
    assert.equal(c.sessions.getActiveSessionId(), null);
    assert.equal(c.host.agents.alive, 0);
    await c.port.deliver({ type: 'disconnectAgent' });
    assert.deepEqual(c.host.notifier.told, ['info: Disconnected from the agent.', 'info: No agent is connected.']);
    assert.deepEqual(c.host.asked, []);
  } finally { c.dispose(); }
});

test('stopHire and openTranscript: the agent is asked by the contract\'s extension requests, with the plan', async () => {
  const c = await connected('R4');
  try {
    await c.port.deliver({ type: 'stopHire', planId: 'p-1' });
    await c.port.deliver({ type: 'openTranscript', planId: 'p-1' });
    assert.deepEqual(c.sent('_jawata/hire/stop'), [{ planId: 'p-1' }]);
    assert.deepEqual(c.sent('_jawata/hire/transcript'), [{ planId: 'p-1' }]);
    await c.port.deliver({ type: 'stopHire' });
    assert.equal(c.sent('_jawata/hire/stop').length, 1, 'a stop with no plan is not an intent');
  } finally { c.dispose(); }
});

test('answerPermission: an answer that names no proposal changes nothing and is logged (proposals.test.mjs has the ones that do)', async () => {
  const c = opened('R1');
  try {
    await c.port.deliver({ type: 'answerPermission', requestId: 'proposal-1', optionId: 'allow-once' });
    assert.deepEqual(c.port.toView, []);
    assert.ok(c.host.logged.some(l => /names nothing that waits/.test(l)));
    await c.port.deliver({ type: 'answerPermission', requestId: 'proposal-1' });
    assert.equal(c.host.logged.filter(l => /not an intent/.test(l)).length, 1, 'an answer with no choice is not an intent');
  } finally { c.dispose(); }
});

test('listSessions and openSession: the agent is asked for its sessions, and a session it lists is opened (history.test.mjs follows it through)', async () => {
  const c = opened('R6');
  try {
    await c.port.deliver({ type: 'listSessions' });
    await c.port.deliver({ type: 'listSessions', cursor: 7 });
    assert.equal(c.host.logged.filter(l => /not an intent/.test(l)).length, 1, 'a cursor that is not a string is not an intent');
    await c.port.deliver({ type: 'openSession', sessionId: c.chat.snapshot().history.sessions[0].sessionId });
    assert.ok(c.sessions.getActiveSessionId());
  } finally { c.dispose(); }
});

test('keepDraft: the core keeps what is typed and tells the page; a draft that is not words is not an intent', async () => {
  const c = opened('R1');
  try {
    await c.port.deliver({ type: 'keepDraft', text: 'half a thought' });
    assert.deepEqual(c.port.toView, [{ type: 'draft', text: 'half a thought' }]);
    assert.equal(c.chat.snapshot().draft, 'half a thought');
    await c.port.deliver({ type: 'keepDraft', text: 5 });
    assert.equal(c.chat.snapshot().draft, 'half a thought');
  } finally { c.dispose(); }
});

test('detachFile: an attached file is taken back out of the state, and only that one', async () => {
  const c = opened('R1');
  try {
    c.chat.attachFile('/w/a.txt');
    c.chat.attachFile('/w/b.txt');
    await c.port.deliver({ type: 'detachFile', path: '/w/a.txt' });
    assert.deepEqual(c.port.toView.map(m => m.type), ['file-attached', 'file-attached', 'file-detached']);
    assert.deepEqual(c.chat.snapshot().attachments.map(a => a.path), ['/w/b.txt']);
    await c.port.deliver({ type: 'detachFile' });
    assert.equal(c.chat.snapshot().attachments.length, 1, 'a detach with no path is not an intent');
  } finally { c.dispose(); }
});

test('a message that is not an intent is ignored and logged: a page cannot ask the host for a command by id', async () => {
  const c = opened('R1');
  try {
    await c.port.deliver({ type: 'executeCommand', command: 'workbench.action.openSettings' });
    await c.port.deliver({ type: 'renderMarkdown', items: [] }); // the round trip is gone: the view renders markdown itself
    await c.port.deliver({ nonsense: true });
    // an intent with its payload missing or of the wrong kind is not an intent either: it never reaches the agent
    await c.port.deliver({ type: 'sendPrompt' });
    await c.port.deliver({ type: 'sendPrompt', text: 42 });
    await c.port.deliver({ type: 'setConfigOption', configId: 'effort' });
    await c.port.deliver(null);
    assert.deepEqual(c.port.toView, []);
    assert.deepEqual(c.host.asked, []);
    assert.equal(c.host.logged.filter(l => /not an intent/.test(l)).length, 7);
  } finally { c.dispose(); }
});

test('every intent of the union was delivered by a test above', () => {
  const missing = VIEW_INTENT_TYPES.filter(t => !delivered.has(t));
  assert.deepEqual(missing, [], `no test delivers: ${missing.join(', ')}`);
});
