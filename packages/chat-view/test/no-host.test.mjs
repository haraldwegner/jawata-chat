// chat-view knows no host: no `vscode`, no `acquireVsCodeApi`, no `--vscode-*` theme name, and nothing imported but React, DOMPurify and the core.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const sourcesOf = (pkg) => {
  const dir = new URL(`../../${pkg}/src/`, import.meta.url);
  return readdirSync(dir, { recursive: true }).filter(f => /\.(ts|tsx)$/.test(String(f)) && !String(f).endsWith('.d.ts'))
    .map(f => ({ name: `${pkg}/${f}`, text: readFileSync(new URL(String(f), dir), 'utf8') }));
};

/** The names of the files that reach a host: the check itself, so that its control can run it on a planted file. */
const reachHost = (files) => files.filter(f => /from\s+['"]vscode['"]|acquireVsCodeApi|vscode\.postMessage|--vscode-/.test(f.text)).map(f => f.name);

/** The bare module names the files import. */
const importsOf = (files) => new Set(files.flatMap(f => [...f.text.matchAll(/(?:from|import)\s*\(?\s*['"]([^'".][^'"]*)['"]/g)].map(m => m[1])));

test('neither chat-core nor chat-view reaches the VS Code api or names one of its theme variables', () => {
  assert.deepEqual(reachHost([...sourcesOf('chat-core'), ...sourcesOf('chat-view')]), []);
});

test('control: the check names a file that imports vscode or asks for the webview api', () => {
  const planted = [
    { name: 'a.ts', text: "import * as vscode from 'vscode';" },
    { name: 'b.ts', text: 'const api = acquireVsCodeApi();' },
    { name: 'c.ts', text: "import { x } from './c.js';" },
    { name: 'd.ts', text: 'const css = "color: var(--vscode-foreground, black)";' },
  ];
  assert.deepEqual(reachHost(planted), ['a.ts', 'b.ts', 'd.ts']);
});

test('chat-view imports only React, DOMPurify, marked, the core and its own files', () => {
  assert.deepEqual([...importsOf(sourcesOf('chat-view'))].sort(), ['@jawata/chat-core', 'dompurify', 'marked', 'react', 'react-dom/client']);
});

test('the package depends on no host', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
  assert.deepEqual(deps.filter(d => d === 'vscode' || d.startsWith('@vscode/') || d.startsWith('@types/vscode')), []);
});
