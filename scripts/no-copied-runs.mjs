#!/usr/bin/env node
// S12b criterion 2: no file of this repository repeats text of the code this chat was started from
// (the files the fork brought at the import commit). Two measures, both over the text without comments
// and without import lines:
//   lines   - a run of six consecutive lines, compared trimmed, blank lines skipped (the criterion as written);
//   tokens  - a run of forty consecutive tokens, so that lines joined or split, or comments put between
//             them, do not hide a copied block.
// A window that is mostly closing punctuation (lines: fewer than three of six hold a letter) is structure,
// not text, and does not count; in a manifest (json) only windows with prose count, and no token windows. What neither measure sees: the same code with every name changed.
// Files: every file of the repository that is not ignored, tracked or not yet added.
// Where the original comes from: test/fork-manifest.json, which holds hashes and no text (every six-line window and every file of
// the starting code), so that a clone without the old history is checked the same way; or, given an import commit (the archive
// of the old history), the code itself, which adds the token measure the manifest leaves out (it would be too large to keep).
// Usage: node scripts/no-copied-runs.mjs                       against the manifest (lines only)
//        node scripts/no-copied-runs.mjs <import-commit>       against the code itself (lines and tokens)
//        node scripts/no-copied-runs.mjs --make-manifest <import-commit>    prints the manifest for that commit
// exit 0: none; exit 1: the runs, listed.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const LINES = 6;
const TOKENS = 40;
const makeManifest = process.argv[2] === '--make-manifest';
const importCommit = makeManifest ? process.argv[3] : process.argv[2];
const MANIFEST = new URL('../test/fork-manifest.json', import.meta.url);
const digest = (text) => createHash('sha1').update(text).digest('hex').slice(0, 12);
const git = (...args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 1 << 28 });

/** Every text file counts, whatever it is called or has no extension: a binary one (a NUL byte in its first 8,000 bytes) is the byte-for-byte test's. */
const isText = (buffer) => !buffer.subarray(0, 8000).includes(0);
const CODE = /\.(ts|tsx|js|mjs|css)$/;
// the fork landed in packages/vscode; the rest of the import commit was this repository's own start
const FORK_DIR = 'packages/vscode/';
const isImport = (line) => /^(import\b|export .* from\b|\} from\b)/.test(line);
/** A line of a manifest that holds a sentence: a string value of 25 characters or more. */
const PROSE = /:\s*"[^"]{25,}"/;
const TOKEN = /[A-Za-z_$][\w$]*|\d[\w.]*|'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"|`(?:[^`\\]|\\.)*`|\S/g;

/** The text without comments (C-style and shell). A `//` after a colon is a web address, not a comment. */
function withoutComments(path, source) {
  if (/\.(sh|gitignore|vscodeignore)$|(^|\/)\.(git|vscode)ignore$/.test(path)) { return source.replace(/(^|\s)#.*$/gm, '$1'); }
  if (!CODE.test(path)) { return source; }
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

/** Both kinds of window of one file: [{ key, line }]. */
function windows(path, source) {
  const lines = [];
  withoutComments(path, source).split('\n').forEach((raw, index) => {
    const text = raw.trim();
    if (text !== '' && !isImport(text)) { lines.push({ text, line: index + 1 }); }
  });
  const found = [];
  const isJson = /\.json$/.test(path);
  for (let i = 0; i + LINES <= lines.length; i++) {
    const slice = lines.slice(i, i + LINES);
    if (slice.filter((l) => /[A-Za-z]/.test(l.text)).length < 3) { continue; }
    // a manifest's names, versions and keys are facts it has to state; only its prose can be copied
    if (isJson && slice.filter((l) => PROSE.test(l.text)).length < 2) { continue; }
    found.push({ key: 'L' + slice.map((l) => l.text).join('\n'), line: slice[0].line });
  }
  const tokens = [];
  if (isJson) { return found; }
  for (const { text, line } of lines) { for (const token of text.match(TOKEN) ?? []) { tokens.push({ token, line }); } }
  for (let i = 0; i + TOKENS <= tokens.length; i += 1) {
    const slice = tokens.slice(i, i + TOKENS);
    if (slice.filter((t) => /[A-Za-z]/.test(t.token)).length < TOKENS / 4) { continue; }
    found.push({ key: 'T' + slice.map((t) => t.token).join(' '), line: slice[0].line });
  }
  return found;
}

// the original: every text file the fork brought at the import commit, indexed by window; or the manifest's hashes of them
const original = new Map();
const fromManifest = importCommit === undefined;
const manifest = fromManifest ? JSON.parse(readFileSync(MANIFEST, 'utf8')) : null;
const known = manifest ? new Set(manifest.lineWindows) : null;
if (!fromManifest) {
  for (const path of git('ls-tree', '-r', '--name-only', importCommit).split('\n').filter((p) => p !== '' && p.startsWith(FORK_DIR))) {
    let source;
    try {
      const bytes = execFileSync('git', ['show', `${importCommit}:${path}`], { maxBuffer: 1 << 28 });
      if (!isText(bytes)) { continue; }
      source = bytes.toString('utf8');
    } catch { continue; }
    for (const w of windows(path, source)) {
      if (!original.has(w.key)) { original.set(w.key, `${path}:${w.line}`); }
    }
  }
}
if (makeManifest) {
  const blobs = git('ls-tree', '-r', importCommit, '--', FORK_DIR).split('\n').filter(Boolean).map((line) => line.split('\t')[0].split(' ')[2]);
  const lineWindows = [...original.keys()].filter((key) => key[0] === 'L').map(digest);
  console.log(JSON.stringify({ lineWindows: [...new Set(lineWindows)].sort(), blobs: blobs.sort() }));
  process.exit(0);
}
const originalOf = (key) => (fromManifest ? (key[0] === 'L' && known.has(digest(key)) ? 'the starting code (manifest)' : undefined) : original.get(key));

// ours: every file not ignored, whether or not it has been added yet
const copied = new Map();
for (const path of git('ls-files', '--cached', '--others', '--exclude-standard').split('\n').filter((p) => p !== '' && !/package-lock\.json$/.test(p))) {
  let source;
  try {
    const bytes = readFileSync(path);
    if (!isText(bytes)) { continue; }
    source = bytes.toString('utf8');
  } catch { continue; }
  for (const w of windows(path, source)) {
    const from = originalOf(w.key);
    if (from) { copied.set(`${path}:${w.line} repeats ${from}`, w.key[0] === 'L' ? 'lines' : 'tokens'); }
  }
}

if (copied.size > 0) {
  const byFile = new Map();
  for (const [what] of copied) { const file = what.split(':')[0]; byFile.set(file, (byFile.get(file) ?? 0) + 1); }
  console.error(`${copied.size} window(s) of the starting code's text in ${byFile.size} file(s) (${fromManifest ? 'manifest' : 'commit ' + importCommit}):`);
  for (const [file, n] of byFile) { console.error(`  ${file}: ${n}`); }
  for (const [what, kind] of [...copied].slice(0, 40)) { console.error(`    ${kind}: ${what}`); }
  process.exit(1);
}
console.log(fromManifest ? `no run of ${LINES} lines in common with the manifest (the token measure needs an import commit)` : `no run of ${LINES} lines or ${TOKENS} tokens in common with ${importCommit}`);
