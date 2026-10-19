// S12b: this repository holds no trace of the code its chat was started from: no file names its author or its project,
// and no source file holds a run of six lines that the starting code held. (The starting code is held as hashes in fork-manifest.json, so a clone without the old history is checked the same way.)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

// hashes of the starting code, no text: the old history is not part of this repository
const manifest = JSON.parse(readFileSync(new URL('./fork-manifest.json', import.meta.url), 'utf8'));

// built from parts, so that this file does not hold what it looks for
const NAMES = [['formula', 'hendry'], ['Jun', ' Han']].map(parts => parts.join(''));

/** Every file of the repository that is not ignored: the tracked ones and the new ones. */
const files = () => execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8' })
  .split('\n').filter(Boolean);

test('no file of the repository names the author or the project it was started from', () => {
  assert.ok(manifest.lineWindows.length > 1000 && manifest.blobs.length > 20, 'the manifest of the starting code is present');
  const found = [];
  for (const path of files()) {
    let text;
    try { text = readFileSync(path, 'utf8'); } catch { continue; } // a file git lists and the disk no longer has
    if (NAMES.some(name => text.toLowerCase().includes(name.toLowerCase()))) { found.push(path); }
    if (NAMES.some(name => path.toLowerCase().includes(name.toLowerCase()))) { found.push(path + ' (its name)'); }
  }
  assert.deepEqual(found, []);
});

test('no source file repeats a run of six lines of the code it was started from', () => {
  const result = (() => {
    try { return { out: execFileSync('node', ['scripts/no-copied-runs.mjs'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }), code: 0 }; }
    catch (e) { return { out: String(e.stderr), code: e.status }; }
  })();
  assert.equal(result.code, 0, result.out);
});

test('no file is byte for byte a file of the starting code, whatever its type (images and settings files included)', () => {
  const fork = new Set(manifest.blobs);
  const same = [];
  for (const path of files()) {
    let hash;
    try { hash = execFileSync('git', ['hash-object', path], { encoding: 'utf8' }).trim(); } catch { continue; }
    if (fork.has(hash)) { same.push(path); }
  }
  assert.deepEqual(same, []);
});

