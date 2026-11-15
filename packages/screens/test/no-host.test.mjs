// The screens know no host: nothing from a host is imported, and every call of the port is classified.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { HOST_VARIABLES, PORT_CALLS } from '../dist/index.js';

const dir = new URL('../src/', import.meta.url);
const sources = readdirSync(dir, { recursive: true }).filter(f => /\.(ts|tsx)$/.test(String(f)))
  .map(f => ({ name: String(f), text: readFileSync(new URL(String(f), dir), 'utf8') }));

/** The names of the files that reach a host. */
const reachHost = (files) => files
  .filter(f => /from\s+['"]vscode['"]|acquireVsCodeApi|@tauri-apps|org\.eclipse|jawataHostCall|--vscode-/.test(f.text))
  .map(f => f.name);

/** The bare module names the files import. */
// the keyword, not the word inside a string such as a verb named 'import'
const importsOf = (files) => new Set(files.flatMap(f => [...f.text.matchAll(/(?<![\w'"$.])(?:from|import)\s*\(?\s*['"]([^'".][^'"]*)['"]/g)].map(m => m[1])));

test('the screens reach no host', () => {
  assert.deepEqual(reachHost(sources), []);
});

test('control: the check names a file that reaches a host', () => {
  const planted = [
    { name: 'a.ts', text: "import { invoke } from '@tauri-apps/api/core';" },
    { name: 'b.ts', text: 'window.jawataHostCall("x");' },
    { name: 'c.ts', text: "import { x } from './c.js';" },
  ];
  assert.deepEqual(reachHost(planted), ['a.ts', 'b.ts']);
});

test('the package imports nothing but React and its own files', () => {
  assert.deepEqual([...importsOf(sources)].filter(name => name !== 'react' && name !== 'react-dom/client'), []);
});

test('control: the import check names a module imported statically or dynamically, and not a string that merely says import', () => {
  const planted = [
    { name: 'a.ts', text: "import { x } from 'lodash';\nconst y = await import('left-pad');" },
    { name: 'b.ts', text: "verb('import', { path }); switch (kind) { case 'import': break; }" },
  ];
  assert.deepEqual([...importsOf(planted)], ['lodash', 'left-pad']);
});

test('the package depends on no host', () => {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
  assert.deepEqual(deps.filter(d => d === 'vscode' || d.startsWith('@vscode/') || d.startsWith('@tauri-apps/')), []);
});

test('every call of the port is classified, and only the theme is answered at once', () => {
  assert.deepEqual(Object.entries(PORT_CALLS).filter(([, kind]) => kind === 'at-once').map(([name]) => name), ['theme']);
  assert.equal(Object.keys(PORT_CALLS).length, 17, 'the 13 calls, the two file dialogs, the version and the theme');
});

test('every style name a host sets has a value of the screens\' own, for a host that sets none, and the stylesheet reads it', () => {
  const css = sources.find(f => f.name === 'screen.ts').text;
  const own = css.match(/:root \{([^}]*)\}/)[1];
  for (const name of HOST_VARIABLES) {
    assert.match(own, new RegExp(`${name}:`), `${name} has a value of its own`);
    assert.match(css, new RegExp(`var\\(${name}\\)`), `${name} is read by the stylesheet`);
  }
});
