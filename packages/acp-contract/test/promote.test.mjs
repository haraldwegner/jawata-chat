// Promotion: the _auth notices go, the working directory (and its mangled folder name) becomes /workspace, and a recording that still holds a local path is refused.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promoteRecording, WORKSPACE_PLACEHOLDER } from '../dist/index.js';

const cwd = '/tmp/someone/project';
const raw = [
  { dir: 'send', msg: { jsonrpc: '2.0', id: 0, method: 'initialize', params: {} } },
  { dir: 'recv', msg: { jsonrpc: '2.0', method: '_auth/status_update', params: { account: { email: 'a@b.c' } } } },
  { dir: 'send', msg: { jsonrpc: '2.0', id: 1, method: 'session/new', params: { cwd, mcpServers: [] } } },
  { dir: 'recv', msg: { jsonrpc: '2.0', method: 'session/update', params: { update: { rawInput: { file_path: `${cwd}/a.txt` } } } } },
];

test('the _auth notices are dropped and nothing else is', () => {
  const out = promoteRecording(raw);
  assert.equal(out.length, raw.length - 1);
  assert.ok(!out.some((l) => l.msg.method === '_auth/status_update'));
});

test('the working directory becomes the placeholder everywhere', () => {
  const text = JSON.stringify(promoteRecording(raw));
  assert.ok(!text.includes(cwd));
  assert.ok(text.includes(`${WORKSPACE_PLACEHOLDER}/a.txt`));
});

test('every other message is unchanged', () => {
  assert.deepEqual(promoteRecording(raw)[0], raw[0]);
});

test('a Windows working directory is redacted where JSON escapes it', () => {
  const win = 'C:\\Users\\someone\\project';
  const out = promoteRecording([
    { dir: 'send', msg: { jsonrpc: '2.0', id: 1, method: 'session/new', params: { cwd: win, mcpServers: [] } } },
    { dir: 'recv', msg: { jsonrpc: '2.0', method: 'session/update', params: { update: { path: `${win}\\a.txt` } } } },
  ]);
  assert.ok(!JSON.stringify(out).includes('someone'));
});

test('the working directory as the adapter mangles it into a path (separators and dots become dashes) is redacted too', () => {
  const dir = '/tmp/claude-1000/-home-me-proj/work/ws';
  const mangled = '-tmp-claude-1000--home-me-proj-work-ws';
  const session = [
    { dir: 'send', msg: { jsonrpc: '2.0', id: 1, method: 'session/new', params: { cwd: dir } } },
    { dir: 'recv', msg: { jsonrpc: '2.0', method: 'session/update', params: { text: `output_file: /srv/out/${mangled}/s/tasks/x.output` } } },
  ];
  const text = JSON.stringify(promoteRecording(session));
  assert.ok(!text.includes(mangled), 'the mangled directory is gone');
  assert.ok(text.includes('-workspace'), 'it is replaced by the placeholder in its own form');
});

test('a promotion that still holds a home-directory path is refused, naming it', () => {
  const session = [
    { dir: 'send', msg: { jsonrpc: '2.0', id: 1, method: 'session/new', params: { cwd: '/srv/work/ws' } } },
    { dir: 'recv', msg: { jsonrpc: '2.0', id: 1, result: { sessions: [{ cwd: '/home/someone/else/project' }] } } },
  ];
  assert.throws(() => promoteRecording(session), /home\/someone/);
});

test('a Windows user directory left behind is refused too', () => {
  const session = [
    { dir: 'send', msg: { jsonrpc: '2.0', id: 1, method: 'session/new', params: { cwd: '/srv/work/ws' } } },
    { dir: 'recv', msg: { jsonrpc: '2.0', method: 'session/update', params: { text: 'C:\\Users\\someone\\x' } } },
  ];
  assert.throws(() => promoteRecording(session), /Users/);
});

test('a session that loads an earlier one (no session/new) is redacted by the directory it loads with', () => {
  const dir = '/srv/work/ws';
  const session = [
    { dir: 'send', msg: { jsonrpc: '2.0', id: 1, method: 'session/load', params: { sessionId: 's', cwd: dir } } },
    { dir: 'recv', msg: { jsonrpc: '2.0', id: 0, result: { sessions: [{ sessionId: 's', cwd: dir }] } } },
  ];
  const text = JSON.stringify(promoteRecording(session));
  assert.ok(!text.includes(dir) && text.includes(WORKSPACE_PLACEHOLDER));
});

test('a value known to be local that survives redaction is refused: the machine\'s names, and the account email of a dropped notice', () => {
  const session = (text) => [
    { dir: 'recv', msg: { jsonrpc: '2.0', method: '_auth/status_update', params: { account: { email: 'me@example.org' } } } },
    { dir: 'send', msg: { jsonrpc: '2.0', id: 1, method: 'session/new', params: { cwd: '/srv/work/ws' } } },
    { dir: 'recv', msg: { jsonrpc: '2.0', method: 'session/update', params: { text } } },
  ];
  assert.doesNotThrow(() => promoteRecording(session('nothing local'), { forbidden: ['hostbox'] }));
  assert.throws(() => promoteRecording(session('built on hostbox today'), { forbidden: ['hostbox'] }), /hostbox/);
  assert.throws(() => promoteRecording(session('mail me@example.org'), {}), /me@example\.org/);
});

test('a secret-shaped string is refused', () => {
  const session = (text) => [
    { dir: 'send', msg: { jsonrpc: '2.0', id: 1, method: 'session/new', params: { cwd: '/srv/work/ws' } } },
    { dir: 'recv', msg: { jsonrpc: '2.0', method: 'session/update', params: { text } } },
  ];
  for (const secret of ['sk-abcdefghijklmnopqrstuvwx', 'ghp_abcdefghijklmnopqrstuvwxyz0123', 'AKIAABCDEFGHIJKLMNOP', 'Authorization: Bearer abcdefghijklmnopqrstuvwxyz']) {
    assert.throws(() => promoteRecording(session(`env: ${secret}`)), /secret/, secret);
  }
});

test('a lowercase or root home path is refused too', () => {
  const session = (text) => [
    { dir: 'send', msg: { jsonrpc: '2.0', id: 1, method: 'session/new', params: { cwd: '/srv/work/ws' } } },
    { dir: 'recv', msg: { jsonrpc: '2.0', method: 'session/update', params: { text } } },
  ];
  assert.throws(() => promoteRecording(session('c:\\users\\someone\\x')), /users/i);
  assert.throws(() => promoteRecording(session('/root/.ssh')), /root/);
  assert.throws(() => promoteRecording(session('/var/home/someone/x')), /home/);
});

test('the adapter\'s per-user temp folder is redacted, whoever the user is', () => {
  const session = [
    { dir: 'send', msg: { jsonrpc: '2.0', id: 1, method: 'session/new', params: { cwd: '/srv/work/ws' } } },
    { dir: 'recv', msg: { jsonrpc: '2.0', method: 'session/update', params: { text: 'output_file: /tmp/claude-1000/-workspace/s/tasks/x.output' } } },
  ];
  const text = JSON.stringify(promoteRecording(session));
  assert.ok(!text.includes('/tmp/') && !text.includes('claude-1000'));
  assert.ok(text.includes('/claude-tmp/-workspace/s/tasks/x.output'));
});

test('a local path streamed across several chunks of an answer is refused', () => {
  const chunk = (text) => ({ dir: 'recv', msg: { jsonrpc: '2.0', method: 'session/update', params: { update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text } } } } });
  const session = [
    { dir: 'send', msg: { jsonrpc: '2.0', id: 1, method: 'session/new', params: { cwd: '/srv/work/ws' } } },
    chunk('It is at /tm'), chunk('p/claude-1000/-ho'), chunk('me-someone-x/a.txt'),
  ];
  assert.throws(() => promoteRecording(session), /local path/);
});

test('keepSession cuts a session list to one session, so no one else\'s titles or paths are promoted', () => {
  const session = [
    { dir: 'send', msg: { jsonrpc: '2.0', id: 1, method: 'session/load', params: { sessionId: 'mine', cwd: '/srv/work/ws' } } },
    { dir: 'recv', msg: { jsonrpc: '2.0', id: 0, result: { sessions: [{ sessionId: 'other', title: 'private', cwd: '/home/x/y' }, { sessionId: 'mine', cwd: '/srv/work/ws' }] } } },
  ];
  assert.throws(() => promoteRecording(session), /home\/x/);
  const out = promoteRecording(session, { keepSession: 'mine' });
  assert.deepEqual(out[1].msg.result.sessions.map((s) => s.sessionId), ['mine']);
  assert.ok(!JSON.stringify(out).includes('private'));
});

test('a working directory too short to redact safely is refused', () => {
  assert.throws(() => promoteRecording([{ dir: 'send', msg: { jsonrpc: '2.0', id: 1, method: 'session/new', params: { cwd: '/' } } }]), /refusing/);
});
