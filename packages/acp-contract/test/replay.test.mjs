// The replay agent, driven by the SDK's own client side over stdio, plays a recorded session.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable, Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { ClientSideConnection, ndJsonStream, PROTOCOL_VERSION } from '@agentclientprotocol/sdk';
import { readSession } from '../dist/index.js';

const bin = fileURLToPath(new URL('../dist/bin/replay.js', import.meta.url));
const sessionFile = (name) => fileURLToPath(new URL(`../sessions/${name}.jsonl`, import.meta.url));

function connect(file, onPermission) {
  const child = spawn(process.execPath, [bin, file], { stdio: ['pipe', 'pipe', 'pipe'] });
  const updates = [];
  const permissions = [];
  const client = {
    sessionUpdate: async (p) => { updates.push(p); },
    requestPermission: async (p) => { permissions.push(p); return onPermission(p); },
    readTextFile: async () => ({ content: '' }),
    writeTextFile: async () => ({}),
  };
  const conn = new ClientSideConnection(() => client, ndJsonStream(Writable.toWeb(child.stdin), Readable.toWeb(child.stdout)));
  return { conn, child, updates, permissions };
}

const recordedUpdates = (name) => readSession(sessionFile(name)).filter((l) => l.dir === 'recv' && l.msg.method === 'session/update').map((l) => l.msg.params);
const settle = () => new Promise((r) => setTimeout(r, 200));

test('R1: initialize, session/new and a prompt are answered as recorded', async () => {
  const { conn, child, updates } = connect(sessionFile('R1'), () => { throw new Error('no permission expected'); });
  try {
    const init = await conn.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} });
    assert.equal(init.agentInfo.name, '@agentclientprotocol/claude-agent-acp');
    const { sessionId } = await conn.newSession({ cwd: '/workspace', mcpServers: [] });
    const done = await conn.prompt({ sessionId, prompt: [{ type: 'text', text: 'anything' }] });
    assert.equal(done.stopReason, 'end_turn');
    await settle();
    assert.deepEqual(updates, recordedUpdates('R1'));
  } finally { child.kill(); }
});

test('R2: the permission request reaches the client and the turn completes', async () => {
  const { conn, child, permissions } = connect(sessionFile('R2'), (p) => ({ outcome: { outcome: 'selected', optionId: p.options[0].optionId } }));
  try {
    await conn.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} });
    const { sessionId } = await conn.newSession({ cwd: '/workspace', mcpServers: [] });
    await conn.prompt({ sessionId, prompt: [{ type: 'text', text: 'anything' }] });
    assert.equal(permissions.length, 1);
    assert.deepEqual(permissions[0].options.map((o) => o.kind), ['allow_once', 'allow_always', 'reject_once']);
  } finally { child.kill(); }
});

test('a malformed session is refused, naming its line', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'replay-'));
  const bad = join(dir, 'bad.jsonl');
  writeFileSync(bad, '{"dir":"send","msg":{"jsonrpc":"2.0","id":0,"method":"initialize"}}\nnot json\n');
  const child = spawn(process.execPath, [bin, bad], { stdio: ['ignore', 'ignore', 'pipe'] });
  let err = '';
  child.stderr.on('data', (d) => { err += d; });
  const code = await new Promise((r) => child.on('close', r));
  assert.equal(code, 1);
  assert.match(err, /line 2: not JSON/);
});
