// The wiring findings of the C20 architect watch that were fixed (ledger 28i-C20-4), held so they do not come back.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { AgentSupply } from '../dist/agent-supply.js';

const read = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const NEW_CONTROLLER = ['new Chat', 'Controller('].join('');

test('the sessions hear what the agents say from the root that owns it, not through the supply\'s links', () => {
  assert.equal(AgentSupply.prototype.onUpdate, undefined, 'AgentSupply passes the updates on again');
  assert.match(read('../src/create-chat.ts'), /new SessionManager\(host, supply, updates\)/);
});

test('no test builds a second controller on the sessions of a chat: it uses the chat\'s own', () => {
  const dirs = [new URL('./', import.meta.url), new URL('../../vscode/src/test/', import.meta.url)];
  for (const dir of dirs) {
    for (const f of readdirSync(dir).filter(f => /\.test\.(mjs|ts)$/.test(f))) {
      assert.ok(!readFileSync(new URL(f, dir), 'utf8').includes(NEW_CONTROLLER), `${f} builds a ChatController of its own`);
    }
  }
});

test('an agent host registers a listener and its handle in one call (Emitter.listen), not by hand', () => {
  for (const path of ['../src/test-support.ts', '../../vscode/src/host/AgentProcesses.ts']) {
    assert.doesNotMatch(read(path), /this\.off\('agent-/, `${path} writes the listener-to-handle pair by hand`);
  }
});
