// The recorded sessions played on the in-memory host: what the page is told equals the goldens, with no editor running.
// The extension's editor test plays the same sessions through the real host against the same files (parity).
// To regenerate: JAWATA_UPDATE_GOLDENS=1 npm test (the diff is then reviewed like any other).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { goldenBody, digestOf } from '../dist/test-support.js';
import { loaded, played, sessionFile } from './play.mjs';

const golden = (name) => new URL(`../goldens/view-${name}.json`, import.meta.url);

function check(name, messages) {
  const body = goldenBody(messages);
  if (process.env.JAWATA_UPDATE_GOLDENS) { writeFileSync(golden(name), JSON.stringify(body, null, 2) + '\n'); }
  assert.deepStrictEqual(body, JSON.parse(readFileSync(golden(name), 'utf8')));
  assert.ok(messages.length > 0, 'the page was told something');
}

test('R1: the page is told a prompt and a streamed answer', async () => check('R1', await played('R1')));
test('R2: the page is told a tool call and its outcome', async () => check('R2', await played('R2')));
test('R3: the page is told the grouped command list', async () => check('R3', await played('R3')));
test('R7: the page is told two proposals, one allowed and one failed', async () => check('R7', await played('R7')));
test('R6: the page is told a loaded session replayed, between its load start and its load end', async () => {
  const messages = await loaded('R6');
  const types = messages.map(m => m.type);
  assert.ok(types.includes('loadSessionStart') && types.indexOf('loadSessionEnd') > types.indexOf('loadSessionStart'), types.join(','));
  check('R6', messages);
});

test('a command list in a golden is the agent\'s own: its digest is the digest of a notification in the session file', () => {
  for (const name of ['R1', 'R2', 'R3', 'R6', 'R7']) {
    const body = JSON.parse(readFileSync(golden(name), 'utf8'));
    const digests = new Set();
    const walk = (v) => {
      if (Array.isArray(v)) { v.forEach(walk); return; }
      if (v && typeof v === 'object') {
        for (const [k, x] of Object.entries(v)) {
          if (k === 'availableCommands' && x && typeof x === 'object' && 'digest' in x) { digests.add(x.digest); } else { walk(x); }
        }
      }
    };
    walk(body.messages);
    const sent = new Set(readFileSync(sessionFile(name), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l))
      .filter(l => l.dir === 'recv' && l.msg.method === 'session/update' && l.msg.params?.update?.sessionUpdate === 'available_commands_update')
      .map(l => digestOf(l.msg.params.update.availableCommands)));
    for (const d of digests) {
      if (d === digestOf([])) { continue; } // no commands yet: the empty list is nobody's notification
      assert.ok(sent.has(d), `${name}: a golden command list that no recorded notification carries`);
    }
  }
  const r3 = JSON.parse(readFileSync(golden('R3'), 'utf8'));
  assert.ok(JSON.stringify(r3).includes('"digest"'), 'R3 holds a command list, as a digest');
});
