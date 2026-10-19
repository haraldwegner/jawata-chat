// The contract package knows no host: nothing it depends on is a VS Code package.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

test('acp-contract depends on no VS Code package', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies, ...pkg.peerDependencies });
  const vscodeDeps = deps.filter((d) => d === 'vscode' || d.startsWith('@vscode/') || d.startsWith('@types/vscode'));
  assert.deepEqual(vscodeDeps, []);
});

test('no source file of acp-contract imports a VS Code module', () => {
  const dir = new URL('../src/', import.meta.url);
  const files = readdirSync(dir, { recursive: true }).filter((f) => String(f).endsWith('.ts'));
  assert.ok(files.length > 0, 'the sources were found');
  for (const f of files) {
    const text = readFileSync(new URL(String(f), dir), 'utf8');
    assert.ok(!/from\s+['"](vscode|@vscode\/[^'"]*)['"]|require\(['"]vscode['"]\)/.test(text), `${f} imports a VS Code module`);
  }
});
