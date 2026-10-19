// The replay plays every recorded agent message, answers every recorded client method, and keeps
// what follows one answer ahead of the next.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable, Writable } from 'node:stream';
import { fileURLToPath } from 'node:url';
import { ClientSideConnection, ndJsonStream, PROTOCOL_VERSION } from '@agentclientprotocol/sdk';

const bin = fileURLToPath(new URL('../dist/bin/replay.js', import.meta.url));
const J = (dir, msg) => JSON.stringify({ dir, msg: { jsonrpc: '2.0', ...msg } });
const upd = (text) => ({ method: 'session/update', params: { sessionId: 's', update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } } } });
const handshake = [
  J('send', { id: 0, method: 'initialize', params: { protocolVersion: 1, clientCapabilities: {} } }),
  J('recv', { id: 0, result: { protocolVersion: 1, agentCapabilities: {}, authMethods: [] } }),
  J('send', { id: 1, method: 'session/new', params: { cwd: '/workspace', mcpServers: [] } }),
  J('recv', { id: 1, result: { sessionId: 's' } }),
];

function run(lines, client) {
  const dir = mkdtempSync(join(tmpdir(), 'replay-'));
  const file = join(dir, 's.jsonl');
  writeFileSync(file, lines.join('\n') + '\n');
  const child = spawn(process.execPath, [bin, file], { stdio: ['pipe', 'pipe', 'inherit'] });
  const conn = new ClientSideConnection(() => client, ndJsonStream(Writable.toWeb(child.stdin), Readable.toWeb(child.stdout)));
  return { conn, child };
}
const start = async (conn) => {
  await conn.initialize({ protocolVersion: PROTOCOL_VERSION, clientCapabilities: {} });
  await conn.newSession({ cwd: '/workspace', mcpServers: [] });
};

test('a recorded file-read request from the agent is played', async () => {
  const reads = [];
  const { conn, child } = run([...handshake,
    J('send', { id: 2, method: 'session/prompt', params: { sessionId: 's', prompt: [] } }),
    J('recv', { id: 7, method: 'fs/read_text_file', params: { sessionId: 's', path: '/workspace/a.txt' } }),
    J('send', { id: 7, result: { content: 'x' } }),
    J('recv', { id: 2, result: { stopReason: 'end_turn' } }),
  ], { sessionUpdate: async () => {}, requestPermission: async () => ({}), readTextFile: async (p) => { reads.push(p.path); return { content: 'x' }; }, writeTextFile: async () => ({}) });
  try {
    await start(conn);
    await conn.prompt({ sessionId: 's', prompt: [] });
    assert.deepEqual(reads, ['/workspace/a.txt']);
  } finally { child.kill(); }
});

test('a recorded config-option change is answered', async () => {
  const { conn, child } = run([...handshake,
    J('send', { id: 2, method: 'session/set_config_option', params: { sessionId: 's', configId: 'model', value: 'haiku' } }),
    J('recv', { id: 2, result: { configOptions: [] } }),
  ], { sessionUpdate: async () => {}, requestPermission: async () => ({}) });
  try {
    await start(conn);
    const r = await conn.setSessionConfigOption({ sessionId: 's', configId: 'model', value: 'haiku' });
    assert.deepEqual(r.configOptions, []);
  } finally { child.kill(); }
});

test('a recorded jawata extension request (stop one hire) is answered as recorded', async () => {
  const { conn, child } = run([...handshake,
    J('send', { id: 2, method: '_jawata/hire/stop', params: { planId: 'p1' } }),
    J('recv', { id: 2, result: { ok: true } }),
    J('send', { id: 3, method: '_jawata/hire/transcript', params: { planId: 'p1' } }),
    J('recv', { id: 3, result: { planId: 'p1', turns: [{ role: 'assistant', text: 'done' }] } }),
  ], { sessionUpdate: async () => {}, requestPermission: async () => ({}) });
  try {
    await start(conn);
    assert.deepEqual(await conn.extMethod('jawata/hire/stop', { planId: 'p1' }), { ok: true });
    assert.equal((await conn.extMethod('jawata/hire/transcript', { planId: 'p1' })).turns[0].text, 'done');
  } finally { child.kill(); }
});

test('what follows one answer arrives before the next answer begins', async () => {
  const seen = [];
  const { conn, child } = run([...handshake,
    J('send', { id: 2, method: 'session/prompt', params: { sessionId: 's', prompt: [] } }),
    J('recv', { id: 2, result: { stopReason: 'end_turn' } }),
    J('recv', upd('after-1')),
    J('recv', upd('after-2')),
    J('send', { id: 3, method: 'session/prompt', params: { sessionId: 's', prompt: [] } }),
    J('recv', upd('before-3')),
    J('recv', { id: 3, result: { stopReason: 'end_turn' } }),
  ], { sessionUpdate: async (p) => { seen.push(p.update.content.text); }, requestPermission: async () => ({}) });
  try {
    await start(conn);
    await conn.prompt({ sessionId: 's', prompt: [] });
    await conn.prompt({ sessionId: 's', prompt: [] });
    assert.deepEqual(seen, ['after-1', 'after-2', 'before-3']);
  } finally { child.kill(); }
});
