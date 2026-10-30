// CR1, the autocontinue button (R11: the `autonomy` option armed, echoed, ended; derived, shape only). The button is the view of one plain ACP
// config option: pressing it is session/set_config_option for that option, and what it shows is what the agent answered.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { closeDom, viewOn } from './dom.mjs';

after(closeDom);

const changes = (v) => v.host.traffic.filter(t => t.direction === 'send' && t.message.method === 'session/set_config_option')
  .map(t => [t.message.params.configId, t.message.params.value]);
const button = (v) => v.$('button.autonomy-btn[data-config-id="autonomy"]');

test('R11: the option is a button that shows it is off, not a drop-down list', async () => {
  const v = await viewOn('R11');
  try {
    await v.connect();
    await v.settle();
    assert.ok(button(v), 'a button for the autonomy option');
    assert.equal(button(v).getAttribute('aria-pressed'), 'false');
    assert.equal(v.$$('.picker-wrap[data-config-id="autonomy"]').length, 0, 'not also a picker');
    assert.ok(button(v).title.length > 20, 'a title that says what the button does');
  } finally { v.dispose(); }
});

test('R11: the first press sets the option on and shows what the agent answered; the second press sets it off', async () => {
  const v = await viewOn('R11');
  try {
    await v.connect();
    await v.settle();
    await v.click(button(v));
    await v.settle(() => button(v).getAttribute('aria-pressed') === 'true');
    assert.deepEqual(changes(v), [['autonomy', 'on']]);
    assert.equal(button(v).getAttribute('aria-pressed'), 'true');
    await v.click(button(v));
    await v.settle(() => button(v).getAttribute('aria-pressed') === 'false');
    assert.deepEqual(changes(v), [['autonomy', 'on'], ['autonomy', 'off']]);
    assert.equal(button(v).getAttribute('aria-pressed'), 'false');
  } finally { v.dispose(); }
});

test('R11: the word in a message arms nothing', async () => {
  const v = await viewOn('R11');
  try {
    await v.connect();
    await v.settle();
    await v.type('please /autocontinue the plan');
    await v.key('Enter');
    await v.settle(() => v.host.traffic.some(t => t.direction === 'send' && t.message.method === 'session/prompt'));
    assert.deepEqual(changes(v), [], 'no change of the option was sent');
    assert.equal(button(v).getAttribute('aria-pressed'), 'false', 'the button still shows off');
  } finally { v.dispose(); }
});
