// CR1: what the core knows of the autocontinue switch: one plain select option, `autonomy`, with the values off and on. The view's button and
// the editor's command read the grant's state through the same function, so they cannot disagree.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AUTONOMY_OPTION, autonomyOf } from '../dist/view-entry.js';
import { AUTONOMY_OPTION_ID, AUTONOMY_VALUES } from '@jawata/acp-contract';
import { chatOn } from './play.mjs';

const session = (configOptions) => ({ sessionId: 's', agentName: 'a', title: null, cwd: undefined, modes: null, models: null, configOptions, availableCommands: [] });
const option = (currentValue, over = {}) => ({ id: 'autonomy', name: 'Autocontinue', type: 'select', currentValue, options: [{ value: 'off', name: 'Off' }, { value: 'on', name: 'On' }], ...over });

test('the option id is the one the contract names, and the values the button asks for are the ones it allows', () => {
  assert.equal(AUTONOMY_OPTION, AUTONOMY_OPTION_ID);
  assert.deepEqual([...AUTONOMY_VALUES], ['off', 'on']);
});

test('the grant is armed exactly when the agent reports on', () => {
  assert.deepEqual(autonomyOf(session([option('on')])), { armed: true });
  assert.deepEqual(autonomyOf(session([option('off')])), { armed: false });
});

test('a session without the option, a missing session and an option of another type say nothing', () => {
  assert.equal(autonomyOf(session([{ id: 'model', type: 'select', currentValue: 'a', options: [] }])), null);
  assert.equal(autonomyOf(session(null)), null);
  assert.equal(autonomyOf(null), null);
  assert.equal(autonomyOf(session([option('on', { type: 'boolean' })])), null);
});

test('a state changed from outside the chat: the agent announces the option on and off, no press, and the chat follows both', async () => {
  const c = chatOn('R11');
  try {
    await c.sessions.connectToAgent('agent');
    const id = c.sessions.getActiveSessionId();
    const say = (value) => c.updates.publish({ sessionId: id, update: { sessionUpdate: 'config_option_update', configOptions: [option(value)] } });
    assert.deepEqual(autonomyOf(c.chat.snapshot().session), { armed: false }, 'R11 opens with the grant off');
    say('on');
    assert.deepEqual(autonomyOf(c.chat.snapshot().session), { armed: true });
    say('off');
    assert.deepEqual(autonomyOf(c.chat.snapshot().session), { armed: false });
    assert.deepEqual(c.host.traffic.filter(t => t.direction === 'send' && t.message.method === 'session/set_config_option'), [], 'nothing was sent');
  } finally { c.dispose(); }
});
