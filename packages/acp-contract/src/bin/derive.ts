#!/usr/bin/env node
// Derive sessions from promoted real recordings and a declarative overlay.
//   derive <overlay.json> <out.jsonl>   one derivation
//   derive --all <sessions-dir>         every overlays/*.json into <Name>.jsonl, and the manifest derived.json
// The manifest lists each derived file with its source and the hash of its overlay, so a hand edit to a
// derived file, or to an overlay without a re-derivation, is caught by the tests.
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { deriveSession, type Overlay } from '../derive.js';
import { formatSession } from '../promote.js';
import { readSession } from '../recording.js';

function derive(sessionsDir: string, overlayPath: string): { text: string; overlay: Overlay; hash: string } {
  const overlayText = readFileSync(overlayPath, 'utf8');
  const overlay = JSON.parse(overlayText) as Overlay;
  const lines = deriveSession(readSession(join(sessionsDir, overlay.base)), overlay.ops);
  return { text: formatSession(lines), overlay, hash: createHash('sha256').update(overlayText).digest('hex') };
}

const [a, b] = process.argv.slice(2);
if (a === '--all' && b) {
  const manifest: Record<string, { source: string; overlay: string; overlaySha256: string }> = {};
  for (const f of readdirSync(join(b, 'overlays')).filter(x => x.endsWith('.json')).sort()) {
    const out = `${basename(f, '.json')}.jsonl`;
    const r = derive(b, join(b, 'overlays', f));
    writeFileSync(join(b, out), r.text);
    manifest[out] = { source: r.overlay.base, overlay: `overlays/${f}`, overlaySha256: r.hash };
  }
  writeFileSync(join(b, 'derived.json'), JSON.stringify(manifest, null, 2) + '\n');
  process.stdout.write(`derived ${Object.keys(manifest).join(', ')}\n`);
} else if (a && b) {
  writeFileSync(b, derive(join(a, '..'), a).text);
} else {
  process.stderr.write('usage: derive <overlay.json> <out.jsonl> | derive --all <sessions-dir>\n');
  process.exit(2);
}
