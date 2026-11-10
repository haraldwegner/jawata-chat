import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const { stagingOf } = createRequire(import.meta.url)('../out/refactorPrompt.js');

const asking = {
  id: 'signature.visibility', uri: 'file:///w/Foo.java', line: 3, column: 4,
  inputs: [{ name: 'visibility', prompt: 'Which visibility?', choices: ['public', 'private'] }, { name: 'factoryMethodName', prompt: 'Name it:', choices: [] }],
};

function asker(answers) {
  const asked = [];
  return {
    asked,
    pick: async (prompt, choices) => { asked.push(['pick', prompt, [...choices]]); return answers.shift(); },
    type: async prompt => { asked.push(['type', prompt]); return answers.shift(); },
  };
}

test('each question is asked in order, a pick when the engine gave choices and free text when it did not, and the answers go back under their names', async () => {
  const host = asker(['private', ' make ']);
  const staged = await stagingOf(asking, host);
  assert.deepEqual(staged, { id: 'signature.visibility', uri: 'file:///w/Foo.java', line: 3, column: 4, inputs: { visibility: 'private', factoryMethodName: 'make' } });
  assert.deepEqual(host.asked, [['pick', 'Which visibility?', ['public', 'private']], ['type', 'Name it:']]);
});

test('cancelling any question stages nothing, and stops asking', async () => {
  const host = asker([undefined, 'never asked']);
  assert.equal(await stagingOf(asking, host), undefined);
  assert.equal(host.asked.length, 1);
});

test('an empty answer is a cancel, because the engine would refuse it', async () => {
  assert.equal(await stagingOf(asking, asker(['public', '   '])), undefined);
});

test('a refactoring that asks nothing is staged at once', async () => {
  const host = asker([]);
  assert.deepEqual(await stagingOf({ id: 'x', uri: 'u', line: 0, column: 0, inputs: [] }, host), { id: 'x', uri: 'u', line: 0, column: 0, inputs: {} });
  assert.equal(host.asked.length, 0);
});
