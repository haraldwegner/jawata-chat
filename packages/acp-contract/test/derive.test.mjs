// Level-1 checks and the derive step: a derived session is a real promoted recording plus a declarative
// overlay, validated against the contract's Level-1 types; the manifest lists every derived file.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { checkLevel1, deriveSession, formatSession, parseSession, readSession } from '../dist/index.js';

const sessions = (p) => fileURLToPath(new URL(`../sessions/${p}`, import.meta.url));
const R1 = () => readSession(sessions('R1.jsonl'));

const hire = (over = {}) => ({ planId: 'p1', seat: 'architect', brain: 'claude', model: 'sonnet', state: 'running', elapsedMs: 0, tokens: 0, costUsd: 0, ...over });
const callWith = (meta) => ({ dir: 'recv', msg: { jsonrpc: '2.0', method: 'session/update', params: { update: { sessionUpdate: 'tool_call', kind: 'execute', toolCallId: 't', _meta: { 'jawata/hire': meta } } } } });

test('real recordings carry no Level-1 field and pass the check', () => {
  assert.deepEqual(checkLevel1(R1()), []);
  assert.deepEqual(checkLevel1(readSession(sessions('R2.jsonl'))), []);
});

test('a hire with a state the contract does not name, or a missing field, is a violation', () => {
  assert.deepEqual(checkLevel1([callWith(hire())]), []);
  assert.deepEqual(checkLevel1([callWith(hire({ state: 'compacting' }))]), []);
  assert.match(checkLevel1([callWith(hire({ state: 'bogus' }))])[0], /state/);
  const { costUsd, ...missing } = hire();
  assert.match(checkLevel1([callWith(missing)])[0], /costUsd/);
});

test('a command group outside seat, skill, utility, and an unknown jawata method, are violations', () => {
  const cmds = (g) => ({ dir: 'recv', msg: { jsonrpc: '2.0', method: 'session/update', params: { update: { sessionUpdate: 'available_commands_update', availableCommands: [{ name: 'x', _meta: { 'jawata/group': g } }] } } } });
  assert.deepEqual(checkLevel1([cmds('seat')]), []);
  assert.match(checkLevel1([cmds('widget')])[0], /group/);
  assert.match(checkLevel1([{ dir: 'send', msg: { jsonrpc: '2.0', id: 1, method: '_jawata/hire/explode', params: {} } }])[0], /method/);
});

test('a seat-model option must be a model option', () => {
  const opts = (o) => ({ dir: 'recv', msg: { jsonrpc: '2.0', id: 1, result: { configOptions: [o] } } });
  assert.deepEqual(checkLevel1([opts({ id: 'seat-model:architect', category: 'model', type: 'select' })]), []);
  assert.match(checkLevel1([opts({ id: 'seat-model:architect', category: 'mode', type: 'select' })])[0], /category/);
});

test('Level 1 is strict about what it names: unknown hire fields and jawata keys, a wrong kind, missing request params, a wrong option type', () => {
  assert.match(checkLevel1([callWith(hire({ bogus: 1 }))])[0], /bogus/);
  assert.match(checkLevel1([callWith(hire({ elapsedMs: 'soon' }))])[0], /elapsedMs/);
  const meta = (m) => ({ dir: 'recv', msg: { jsonrpc: '2.0', method: 'session/update', params: { update: { sessionUpdate: 'tool_call', _meta: m } } } });
  assert.match(checkLevel1([meta({ 'jawata/zzz': 1 })])[0], /jawata\/zzz/);
  const thinkHire = { dir: 'recv', msg: { jsonrpc: '2.0', method: 'session/update', params: { update: { sessionUpdate: 'tool_call', kind: 'think', _meta: { 'jawata/hire': hire() } } } } };
  assert.match(checkLevel1([thinkHire])[0], /kind/);
  assert.match(checkLevel1([{ dir: 'send', msg: { jsonrpc: '2.0', id: 1, method: '_jawata/hire/stop', params: {} } }])[0], /planId/);
  assert.match(checkLevel1([{ dir: 'recv', msg: { jsonrpc: '2.0', id: 1, result: { configOptions: [{ id: 'seat-model:x', category: 'model', type: 'text' }] } } }])[0], /select/);
});

test('the replies to a stop and to a transcript request are checked', () => {
  const pair = (method, result) => [
    { dir: 'send', msg: { jsonrpc: '2.0', id: 7, method, params: { planId: 'p' } } },
    { dir: 'recv', msg: { jsonrpc: '2.0', id: 7, result } },
  ];
  assert.deepEqual(checkLevel1(pair('_jawata/hire/stop', { ok: true })), []);
  assert.match(checkLevel1(pair('_jawata/hire/stop', { done: 1 }))[0], /ok/);
  assert.deepEqual(checkLevel1(pair('_jawata/hire/transcript', { planId: 'p', turns: [{ role: 'user', text: 'x' }] })), []);
  assert.match(checkLevel1(pair('_jawata/hire/transcript', { planId: 'p', turns: [{ role: 'robot', text: 'x' }] }))[0], /role/);
});

test('an overlay set merges into a base line; the base is not touched', () => {
  const base = R1();
  const before = JSON.stringify(base);
  const out = deriveSession(base, [{ op: 'set', at: 0, path: ['msg', 'params'], value: { extra: 1 } }]);
  assert.equal(out[0].msg.params.extra, 1);
  assert.equal(out[0].msg.params.protocolVersion, 1, 'merged, not replaced');
  assert.equal(JSON.stringify(base), before);
});

test('a derivation that breaks a Level-1 rule is refused, naming the violation', () => {
  const i = R1().findIndex((l) => l.msg.params?.update?.sessionUpdate === 'agent_message_chunk');
  assert.throws(() => deriveSession(R1(), [{ op: 'set', at: i, path: ['msg', 'params', 'update', '_meta'], value: { 'jawata/hire': hire({ state: 'bogus' }) } }]), /state/);
});

test('commandGroups tags every advertised command by name, with a default group', () => {
  const out = deriveSession(R1(), [{ op: 'commandGroups', seat: ['compact'], utility: ['config'], default: 'skill' }]);
  const cmds = out.flatMap((l) => l.msg.params?.update?.availableCommands ?? []);
  assert.ok(cmds.length > 0);
  assert.ok(cmds.every((c) => ['seat', 'skill', 'utility'].includes(c._meta['jawata/group'])));
  assert.equal(cmds.find((c) => c.name === 'compact')._meta['jawata/group'], 'seat');
  assert.equal(cmds.find((c) => c.name === 'config')._meta['jawata/group'], 'utility');
});

test('seatModels makes one model option per seat and points a recorded change at the chosen seat', () => {
  const base = parseSession([
    JSON.stringify({ dir: 'recv', msg: { jsonrpc: '2.0', id: 1, result: { sessionId: 's', configOptions: [{ id: 'model', category: 'model', type: 'select', currentValue: 'a', options: [] }, { id: 'mode', category: 'mode', type: 'select' }] } } }),
    JSON.stringify({ dir: 'send', msg: { jsonrpc: '2.0', id: 2, method: 'session/set_config_option', params: { sessionId: 's', configId: 'model', value: 'b' } } }),
  ].join('\n'));
  const out = deriveSession(base, [{ op: 'seatModels', seats: ['architect', 'test-writer'], select: 'test-writer' }]);
  const ids = out[0].msg.result.configOptions.map((o) => o.id);
  assert.deepEqual(ids, ['seat-model:architect', 'seat-model:test-writer', 'mode']);
  assert.equal(out[1].msg.params.configId, 'seat-model:test-writer');
});

test('insertAfter adds lines after a base line, by base index', () => {
  const extra = { dir: 'send', msg: { jsonrpc: '2.0', id: 99, method: '_jawata/hire/stop', params: { planId: 'p' } } };
  const out = deriveSession(R1(), [{ op: 'insertAfter', at: 1, lines: [extra] }]);
  assert.equal(out.length, R1().length + 1);
  assert.equal(out[2].msg.method, '_jawata/hire/stop');
});

test('every derived file equals its derivation, and the manifest lists exactly the derived files with their overlay hashes', () => {
  const manifest = JSON.parse(readFileSync(sessions('derived.json'), 'utf8'));
  const overlays = readdirSync(sessions('overlays')).filter((f) => f.endsWith('.json')).map((f) => f.replace(/\.json$/, '.jsonl')).sort();
  assert.deepEqual(Object.keys(manifest).sort(), overlays, 'the manifest and the overlays name the same files');
  assert.deepEqual(overlays, ['R10.jsonl', 'R3.jsonl', 'R4.jsonl', 'R5.jsonl', 'R9.jsonl'], 'the derived sessions are exactly these five: a new one is a decision, not an accident');
  assert.ok(overlays.length > 0);
  for (const [file, entry] of Object.entries(manifest)) {
    const overlayText = readFileSync(sessions(entry.overlay), 'utf8');
    assert.equal(createHash('sha256').update(overlayText).digest('hex'), entry.overlaySha256, `${file}: overlay hash`);
    const overlay = JSON.parse(overlayText);
    assert.equal(entry.source, overlay.base);
    const derived = formatSession(deriveSession(readSession(sessions(overlay.base)), overlay.ops));
    assert.equal(readFileSync(sessions(file), 'utf8'), derived, `${file} is its derivation`);
  }
});

test('the sessions README marks every derived file SHAPE ONLY', () => {
  const readme = readFileSync(sessions('README.md'), 'utf8');
  for (const file of Object.keys(JSON.parse(readFileSync(sessions('derived.json'), 'utf8')))) {
    const row = readme.split('\n').find((l) => l.startsWith(`| ${file} `));
    assert.ok(row, `${file} has a row`);
    assert.match(row, /SHAPE ONLY/, `${file} is marked`);
  }
});
