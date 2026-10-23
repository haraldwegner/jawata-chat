#!/usr/bin/env node
// Builds every package of the repository in the order their own dependencies set (ledger 28i-C17-5), so that one command builds a
// fresh clone and no package is built before a package it reads. With --pack it then packs the library packages into packed/, which is
// how another repository (jawata-eclipse, a Theia host) takes them: `npm install <path>/packed/jawata-chat-core-<version>.tgz`.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

/** Every package under packages/: its folder, its name, the packages of this repository it depends on, and whether it is a library. */
export function packagesOf(root = ROOT) {
  const dir = join(root, 'packages');
  return readdirSync(dir, { withFileTypes: true }).filter(e => e.isDirectory()).map(e => {
    const manifest = JSON.parse(readFileSync(join(dir, e.name, 'package.json'), 'utf8'));
    const deps = Object.keys({ ...manifest.dependencies, ...manifest.devDependencies, ...manifest.peerDependencies });
    return { folder: e.name, name: manifest.name, needs: deps, library: manifest.name.startsWith('@jawata/'), scripts: manifest.scripts ?? {} };
  });
}

/** The packages in an order where each comes after every package of this repository it depends on; a cycle is an error. */
export function buildOrder(packages) {
  const ours = new Map(packages.map(p => [p.name, p]));
  const done = new Set();
  const visiting = new Set();
  const order = [];
  const visit = (p) => {
    if (done.has(p.name)) { return; }
    if (visiting.has(p.name)) { throw new Error(`the packages depend on each other in a circle through ${p.name}`); }
    visiting.add(p.name);
    for (const dep of p.needs.filter(n => ours.has(n)).sort()) { visit(ours.get(dep)); }
    visiting.delete(p.name);
    done.add(p.name);
    order.push(p);
  };
  [...packages].sort((a, b) => a.name.localeCompare(b.name)).forEach(visit);
  return order;
}

function main() {
  const order = buildOrder(packagesOf());
  for (const p of order) {
    if (!p.scripts.build) { throw new Error(`${p.folder} has no build script`); }
    console.log(`build: ${p.name}`);
    execFileSync('npm', ['run', 'build', '--workspace', p.name], { cwd: ROOT, stdio: 'inherit' });
  }
  if (process.argv.includes('--pack')) {
    const out = join(ROOT, 'packed');
    mkdirSync(out, { recursive: true });
    for (const p of order.filter(x => x.library)) {
      execFileSync('npm', ['pack', '--workspace', p.name, '--pack-destination', out], { cwd: ROOT, stdio: 'inherit' });
    }
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) { main(); }
