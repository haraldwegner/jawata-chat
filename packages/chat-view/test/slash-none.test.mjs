// 28h D57 (h): typing / in a session that holds no commands says so in one sentence, instead of showing nothing.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { closeDom, viewOn } from './dom.mjs';

after(closeDom);

const noCommands = line => line.msg?.params?.update?.sessionUpdate === 'available_commands_update';

/** R3's turn played to its end, with or without the commands the agent sent in it. */
async function afterTheTurn(options) {
  const v = await viewOn('R3', options);
  await v.connect();
  await v.settle();
  await v.type('go');
  await v.key('Enter');
  await v.settle(() => v.$$('.message').length > 1 && !v.$('.send-stop-btn.stop'));
  return v;
}

test('D57 (h): / in a session the agent sent no commands for says in one sentence that there are none', async () => {
  const v = await afterTheTurn({ without: noCommands });
  try {
    await v.type('/');
    const popup = v.$('.slash-popup');
    assert.ok(popup.classList.contains('open'), 'the / list stays closed and says nothing');
    assert.equal(v.$$('.slash-popup-item').length, 0);
    assert.match(popup.textContent, /no commands/i, popup.textContent);
  } finally { v.dispose(); }
});

test('D57 (h), the control: with commands, / lists them and no such sentence shows', async () => {
  const v = await afterTheTurn({});
  try {
    await v.type('/');
    assert.ok(v.$$('.slash-popup-item').length > 0);
    assert.doesNotMatch(v.$('.slash-popup').textContent, /no commands/i);
  } finally { v.dispose(); }
});
