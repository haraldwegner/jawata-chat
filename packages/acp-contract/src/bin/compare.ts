#!/usr/bin/env node
// Compare two recorded sessions by shape: `compare <recording.jsonl> <expected.jsonl>`.
// Prints whether they match and, if not, the first ordinary message that differs; unprompted notices are
// compared as a set (compareShapes). Exit 0 on a match, 1 otherwise.
import { compareShapes, readSession, shapeOf } from '../recording.js';

const [actual, expected] = process.argv.slice(2);
if (!actual || !expected) {
  process.stderr.write('usage: compare <recording.jsonl> <expected.jsonl>\n');
  process.exit(2);
}
const a = shapeOf(readSession(actual));
const b = shapeOf(readSession(expected));
const r = compareShapes(a, b);
if (r.same) {
  process.stdout.write(`RESULT: same shape as ${expected} (${a.length} of ${b.length} messages)\n`);
  process.exit(0);
}
const where = r.at === undefined ? '' : ` at message ${r.at + 1}`;
process.stdout.write(`RESULT: different shape from ${expected}${where}: got "${r.got}", expected "${r.expected}"\n`);
process.exit(1);
