// The smoke scripts share one library and drive the desktop by keys only (ledger 28i-C7-4). Read and parse-checked here, never run:
// they open editor windows on the person's desktop.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';

const DIR = new URL('../scripts/', import.meta.url);
const scripts = () => readdirSync(DIR).filter(f => f.endsWith('-smoke.sh'));
const text = (f) => readFileSync(new URL(f, DIR), 'utf8');

test('every smoke script takes its steps from the shared library', () => {
  assert.ok(scripts().length >= 2, `found ${scripts().join(', ')}`);
  for (const f of scripts()) {
    assert.match(text(f), /^\. "\$\(dirname "\$0"\)\/smoke-lib\.sh"$/m, `${f} does not source smoke-lib.sh`);
    assert.doesNotMatch(text(f), /xdotool search --onlyvisible|import -window "\$WIN" "\$OUT\/1-opened\.png"|compare\.js/, `${f} repeats a step the library holds`);
  }
});

test('no script clicks at a fixed position on the screen', () => {
  for (const f of [...scripts(), 'smoke-lib.sh']) {
    assert.doesNotMatch(text(f), /xdotool\s+(mousemove|click|mousedown|mouseup)\b/, `${f} clicks at a position`);
  }
});

test('every smoke script and the library parse', () => {
  for (const f of [...scripts(), 'smoke-lib.sh']) { execFileSync('bash', ['-n', new URL(f, DIR).pathname]); }
});
