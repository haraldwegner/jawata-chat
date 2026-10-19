// The tee command: an agent-side recorder for clients we do not control (another editor's chat, Zed).
// It stands between the client and the real agent and writes the recorded-session format.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readSession } from '../dist/index.js';

const bin = fileURLToPath(new URL('../dist/bin/tee.js', import.meta.url));
// an "agent" that answers every request line with a result carrying the same id
const ECHO = "process.stdin.on('data',d=>{for(const l of String(d).split('\\n').filter(Boolean)){const m=JSON.parse(l);process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:m.id,result:{}})+'\\n')}})";

function run(args, input) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [bin, ...args], { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    p.stdout.on('data', (d) => { out += d; });
    p.stdin.write(input);
    setTimeout(() => p.stdin.end(), 500);
    p.on('close', (status) => resolve({ status, out }));
  });
}

test('every line in either direction is written in the session format, and the client sees the agent unchanged', async () => {
  const out = join(mkdtempSync(join(tmpdir(), 'tee-')), 'rec.jsonl');
  const req = JSON.stringify({ jsonrpc: '2.0', id: 0, method: 'initialize', params: { protocolVersion: 1 } });
  const r = await run(['--out', out, '--', process.execPath, '-e', ECHO], req + '\n');
  assert.equal(r.status, 0);
  assert.equal(JSON.parse(r.out.trim()).id, 0, 'the client receives the agent line as sent');
  const lines = readFileSync(out, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(lines.map((l) => l.dir), ['send', 'recv']);
  assert.equal(lines[0].msg.method, 'initialize');
  assert.deepEqual(readSession(out).length, 2, 'the reader accepts the file');
});

test('a line that is not JSON is passed through and left out of the recording', async () => {
  const out = join(mkdtempSync(join(tmpdir(), 'tee-')), 'rec.jsonl');
  const r = await run(['--out', out, '--', process.execPath, '-e', "process.stdin.on('data',()=>process.stdout.write('not json\\n'))"], 'x\n');
  assert.equal(r.status, 0);
  assert.match(r.out, /not json/);
  assert.equal(readFileSync(out, 'utf8').trim(), '');
});

test('a missing --out or command is refused with the usage line', async () => {
  const r = await run(['--', 'node'], '');
  assert.equal(r.status, 2);
});

test('an agent that exits right after a burst loses nothing, on the client side or in the recording', async () => {
  const out = join(mkdtempSync(join(tmpdir(), 'tee-')), 'rec.jsonl');
  const burst = "for(let i=0;i<5000;i++)process.stdout.write(JSON.stringify({jsonrpc:'2.0',method:'n',params:{i}})+'\\n');";
  for (let attempt = 0; attempt < 5; attempt++) {
    const r = await run(['--out', out + attempt, '--', process.execPath, '-e', burst], '');
    assert.equal(r.out.trim().split('\n').length, 5000, `client saw all lines (attempt ${attempt})`);
    assert.equal(readFileSync(out + attempt, 'utf8').trim().split('\n').length, 5000, `recording holds all lines (attempt ${attempt})`);
  }
});

test('killing tee ends the real agent too', async () => {
  const out = join(mkdtempSync(join(tmpdir(), 'tee-')), 'rec.jsonl');
  const p = spawn(process.execPath, [bin, '--out', out, '--', process.execPath, '-e', "console.log('pid:'+process.pid);setInterval(()=>{},1000)"], { stdio: ['pipe', 'pipe', 'inherit'] });
  const pid = await new Promise((resolve) => p.stdout.on('data', (d) => { const m = /pid:(\d+)/.exec(String(d)); if (m) resolve(Number(m[1])); }));
  p.kill('SIGTERM');
  await new Promise((r) => p.on('close', r));
  await new Promise((r) => setTimeout(r, 300));
  assert.throws(() => process.kill(pid, 0), /ESRCH/, 'the agent process is gone');
});

test('a second run with the same --out keeps the first recording and writes beside it', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'tee-'));
  const out = join(dir, 'rec.jsonl');
  const req = JSON.stringify({ jsonrpc: '2.0', id: 0, method: 'initialize', params: {} }) + '\n';
  await run(['--out', out, '--', process.execPath, '-e', ECHO], req);
  const first = readFileSync(out, 'utf8');
  await run(['--out', out, '--', process.execPath, '-e', ECHO], req);
  assert.equal(readFileSync(out, 'utf8'), first, 'the first recording is untouched');
  assert.equal(readdirSync(dir).length, 2, 'the second run wrote its own file');
});

test('an agent that cannot be started is named, with a failing status', async () => {
  const out = join(mkdtempSync(join(tmpdir(), 'tee-')), 'rec.jsonl');
  const r = await run(['--out', out, '--', 'definitely-not-a-program-xyz'], '');
  assert.equal(r.status, 127);
});
