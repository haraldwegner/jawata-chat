// chat-core knows no host and no UI framework: a compile-time fact (no node, no DOM, no host types) and a text check.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const config = JSON.parse(readFileSync(new URL('../tsconfig.json', import.meta.url), 'utf8'));

test('it compiles with no ambient types and no DOM library', () => {
  assert.deepEqual(config.compilerOptions.types, []);
  assert.ok(!config.compilerOptions.lib.some((l) => /dom|webworker/i.test(l)), 'a DOM library is listed');
});

test('no source file imports a host, node or a UI framework', () => {
  const dir = new URL('../src/', import.meta.url);
  const files = readdirSync(dir, { recursive: true }).filter((f) => String(f).endsWith('.ts'));
  assert.ok(files.length > 0);
  for (const f of files) {
    const text = readFileSync(new URL(String(f), dir), 'utf8');
    assert.ok(!/from\s+['"](vscode|react|react-dom|node:[^'"]*|fs|path|os|child_process)['"]|acquireVsCodeApi/.test(text), `${f} reaches a host, node or a UI framework`);
  }
});

test('the package depends on no host and no UI framework', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies, ...pkg.peerDependencies });
  assert.deepEqual(deps.filter((d) => d === 'vscode' || d.startsWith('@vscode/') || d.startsWith('@types/vscode') || d.startsWith('react')), []);
});

// Criterion 0: the compile itself is the check. The package compiles with no ambient types and no DOM library, and the same
// settings refuse a file that reaches for a host or DOM global (the control: the check goes red when one is added).
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const tsc = fileURLToPath(new URL('../node_modules/typescript/bin/tsc', import.meta.url));
const root = fileURLToPath(new URL('..', import.meta.url));

test('the package compiles as it is', () => {
  const r = spawnSync(process.execPath, [tsc, '-p', root, '--noEmit'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

test('control: a file that reaches for a DOM or host global does not compile under the same settings', () => {
  const dir = mkdtempSync(join(tmpdir(), 'chat-core-control-'));
  try {
    for (const [name, text] of [['dom.ts', 'export const t = document.title;\n'], ['host.ts', 'export const v = acquireVsCodeApi();\n'], ['node.ts', 'export const p = process.cwd();\n']]) {
      writeFileSync(join(dir, name), text);
      const r = spawnSync(process.execPath, [tsc, '--ignoreConfig', '--noEmit', '--target', 'es2022', '--module', 'nodenext', '--moduleResolution', 'nodenext', '--lib', 'es2022', '--types', '', join(dir, name)], { encoding: 'utf8' });
      assert.notEqual(r.status, 0, `${name} compiled`);
      assert.doesNotMatch(r.stdout + r.stderr, /TS5112/, `${name} failed for the wrong reason: ${r.stdout}`);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

// Criterion 3: the import graph. What the sources import is the package's one dependency and its own files, and nothing else.
test('the sources import only the SDK and their own files', () => {
  const dir = new URL('../src/', import.meta.url);
  const files = readdirSync(dir, { recursive: true }).filter((f) => String(f).endsWith('.ts') && !String(f).endsWith('.d.ts'));
  const bare = new Set();
  for (const f of files) {
    const text = readFileSync(new URL(String(f), dir), 'utf8');
    for (const m of text.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)) {
      const spec = m[1];
      if (spec.startsWith('.')) {
        assert.ok(files.includes(spec.replace(/^\.\//, '').replace(/\.js$/, '.ts')), `${f}: ${spec} is not one of the package's files`);
      } else {
        bare.add(spec);
      }
    }
  }
  assert.deepEqual([...bare].sort(), ['@agentclientprotocol/sdk']);
});

// The words the person reads carry no host (ledger C17-2): the host supplies where the agent is set up, and the rest is said without
// naming an editor, a setting key or a window. Comments may name a host; the code and its strings may not.
test('no string of the core or the view names a host or a host setting', async () => {
  const { readdirSync, readFileSync } = await import('node:fs');
  const words = /jawataChat|VS ?Code|Theia|Eclipse|\bCursor\b|the editor|the extension|reload the window/;
  const files = ['chat-core', 'chat-view'].flatMap(pkg => readdirSync(new URL(`../../${pkg}/src/`, import.meta.url), { recursive: true })
    .filter(f => /\.(ts|tsx)$/.test(String(f)) && !String(f).endsWith('.d.ts') && String(f) !== 'test-support.ts')
    .map(f => ({ name: `${pkg}/${f}`, text: readFileSync(new URL(`../../${pkg}/src/${f}`, import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '') })));
  assert.deepEqual(files.filter(f => words.test(f.text)).map(f => f.name), []);
});
