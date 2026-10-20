// One writer of what an agent says about a session (ledger C13-7): the registry. Nothing else assigns a session's modes, models, options,
// commands or title, and the registry's own setters are private; the manager goes through its public notes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';

const sources = readdirSync(new URL('../src/', import.meta.url)).filter(f => f.endsWith('.ts') && !f.endsWith('.d.ts') && f !== 'test-support.ts')
  .map(f => ({ name: f, text: readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '') }));

test('only the registry assigns what a session knows about its modes, models, options, commands and title', () => {
  const writers = sources.filter(f => /\b(session|info|held|s)\.(modes|models|configOptions|availableCommands|title)\s*=[^=]/.test(f.text)).map(f => f.name);
  assert.deepEqual(writers, ['session-registry.ts']);
});

test('the registry\'s setters of single facts are private: the public ones are note, noteAnswer, noteChosen and noteOptions', () => {
  const registry = sources.find(f => f.name === 'session-registry.ts').text;
  for (const name of ['setMode', 'setCommands', 'setTitle', 'setOptions']) {
    assert.doesNotMatch(registry, new RegExp(`^\\s+(?!private)${name}\\(`, 'm'), `${name} is not private`);
  }
  for (const name of ['note', 'noteAnswer', 'noteChosen', 'noteOptions']) {
    assert.match(registry, new RegExp(`^\\s+${name}\\(`, 'm'), `${name} is public`);
  }
});
