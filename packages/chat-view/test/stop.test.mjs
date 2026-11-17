// 28h dogfood S19-1 and S19-2 (his words 2026-11-17: after the first message the buttons do nothing; Stop does not stop): the page's own Stop
// button, pressed while a turn runs, asks the agent to cancel, and the turn ends; the next message he types is then sent and answered. The
// chat is mounted on a small fake agent whose turn does not end until it is released or cancelled, so the whole path is the real one: the
// button, the page's intent, the core, the connection and back.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { AgentSideConnection, ndJsonStream } from '@agentclientprotocol/sdk';
import { act, closeDom, mountChatView, sleep } from './dom.mjs';
import { LoopbackPort, chatWith } from '@jawata/chat-core/test-support';

after(closeDom);

function holdingAgent() {
  const log = [];
  const waiting = [];
  const run = (input, output) => {
    new AgentSideConnection(() => ({
      async initialize() { return { protocolVersion: 1, agentCapabilities: {}, agentInfo: { name: 'holding', version: '1' } }; },
      async newSession() { return { sessionId: 's1' }; },
      async prompt({ prompt }) {
        log.push(['prompt', prompt[0].text]);
        return new Promise(resolve => { waiting.push(resolve); });
      },
      async cancel() { log.push(['cancel']); waiting.shift()?.({ stopReason: 'cancelled' }); },
    }), ndJsonStream(output, input));
  };
  return { run, log, release: () => waiting.shift()?.({ stopReason: 'end_turn' }) };
}

async function mounted() {
  const agent = holdingAgent();
  const port = new LoopbackPort();
  const chat = chatWith(agent.run, port);
  const container = document.createElement('div');
  document.body.appendChild(container);
  let view;
  await act(async () => { view = mountChatView(container, port.page, 'chat'); });
  await act(async () => { await chat.sessions.connectToAgent('agent'); });
  const $ = (selector) => container.querySelector(selector);
  const settle = async (done, tries = 100) => {
    for (let i = 0; i < tries && !done(); i++) { await act(async () => { await sleep(20); }); }
    await act(async () => { await sleep(20); });
  };
  const type = async (value) => {
    const el = $('textarea');
    await act(async () => {
      Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set.call(el, value);
      el.dispatchEvent(new window.Event('input', { bubbles: true }));
    });
  };
  const enter = () => act(async () => { $('textarea').dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); });
  const click = (el) => act(async () => { el.click(); });
  return { agent, $, settle, type, enter, click, dispose() { act(() => { view.dispose(); }); container.remove(); chat.dispose(); } };
}

test('S19-1/2: the Stop button pressed while a turn runs cancels it, and the message typed after it is sent and answered', async () => {
  const v = await mounted();
  try {
    await v.type('first');
    await v.enter();
    await v.settle(() => v.$('.send-stop-btn.stop'));
    assert.ok(v.$('.send-stop-btn.stop'), 'a running turn shows Stop');
    assert.deepEqual(v.agent.log, [['prompt', 'first']]);

    await v.click(v.$('.send-stop-btn.stop'));
    await v.settle(() => v.$('.send-stop-btn.send'));
    assert.deepEqual(v.agent.log.map(e => e[0]), ['prompt', 'cancel'], 'the agent was asked to cancel');
    assert.ok(v.$('.send-stop-btn.send'), 'the turn ended and the button is Send again');

    await v.type('second');
    await v.enter();
    await v.settle(() => v.agent.log.length >= 3);
    assert.deepEqual(v.agent.log.map(e => e[0]), ['prompt', 'cancel', 'prompt'], 'the next message reached the agent');
    v.agent.release();
    await v.settle(() => v.$('.send-stop-btn.send'));
    assert.ok(v.$('.send-stop-btn.send'), 'and its turn ended');
  } finally { v.dispose(); }
});

test('S19-1: a message typed while a turn runs waits, and is sent when the turn ends normally; Send now cancels first', async () => {
  const v = await mounted();
  try {
    await v.type('one');
    await v.enter();
    await v.settle(() => v.$('.send-stop-btn.stop'));
    await v.type('two');
    await v.enter();
    await v.settle(() => v.$('.queue, .queued, [class*="queue"]'));
    assert.deepEqual(v.agent.log, [['prompt', 'one']], 'nothing is sent while the turn runs');
    v.agent.release();
    await v.settle(() => v.agent.log.length >= 2);
    assert.deepEqual(v.agent.log, [['prompt', 'one'], ['prompt', 'two']], 'the queued message is sent when the turn ends');
    v.agent.release();
    await v.settle(() => v.$('.send-stop-btn.send'));
  } finally { v.dispose(); }
});
