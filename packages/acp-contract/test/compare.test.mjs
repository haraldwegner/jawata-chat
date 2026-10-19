// The compare command: exit 0 and "same shape" for a match, exit 1 and the first difference otherwise.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const bin = fileURLToPath(new URL('../dist/bin/compare.js', import.meta.url));
const session = (n) => fileURLToPath(new URL(`../sessions/${n}.jsonl`, import.meta.url));
const run = (a, b) => spawnSync(process.execPath, [bin, a, b], { encoding: 'utf8' });

test('a session matches itself', () => {
  const r = run(session('R1'), session('R1'));
  assert.equal(r.status, 0);
  assert.match(r.stdout, /same shape .* \(12 of 12 messages\)/);
});

// the unprompted notices (the command list, the usage figures) arrive at varying places in live runs
const kindOf = (l) => l.msg.params?.update?.sessionUpdate;
const isNotice = (l) => l.dir === 'recv' && (kindOf(l) === 'available_commands_update' || kindOf(l) === 'usage_update');
function variant(change, base = 'R1') {
  const lines = readFileSync(session(base), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const path = join(mkdtempSync(join(tmpdir(), 'cmp-')), 'v.jsonl');
  writeFileSync(path, change(lines).map((l) => JSON.stringify(l)).join('\n') + '\n');
  return path;
}

test('unprompted notices moved to another place in the turn are still the same shape', () => {
  const moved = variant((lines) => {
    const i = lines.findIndex(isNotice);
    const [n] = lines.splice(i, 1);
    lines.splice(Math.min(i + 3, lines.length), 0, n);
    return lines;
  });
  assert.equal(run(moved, session('R1')).status, 0);
});

test('a missing notice, or an ordinary message out of order, is still a difference', () => {
  const missing = variant((lines) => { lines.splice(lines.findIndex(isNotice), 1); return lines; });
  assert.equal(run(missing, session('R1')).status, 1);
  const swapped = variant((lines) => {
    const i = lines.findIndex((l) => l.msg.method === 'session/new');
    [lines[i], lines[i - 2]] = [lines[i - 2], lines[i]];
    return lines;
  });
  assert.equal(run(swapped, session('R1')).status, 1);
});

test('two different sessions do not, and the first difference is named', () => {
  const r = run(session('R1'), session('R2'));
  assert.equal(r.status, 1);
  assert.match(r.stdout, /different shape .* at message \d+/);
});

test('a command list that lost the jawata groups differs from the grouped one, wherever it arrives', () => {
  const ungrouped = variant((lines) => {
    for (const l of lines) { for (const c of l.msg.params?.update?.availableCommands ?? []) { delete c._meta; } }
    return lines;
  }, 'R3');
  assert.equal(run(ungrouped, session('R3')).status, 1);
  assert.equal(run(session('R3'), session('R3')).status, 0);
});
