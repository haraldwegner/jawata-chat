#!/usr/bin/env node
// Turn a raw recording into a contract recording: `promote <raw.jsonl> <out.jsonl> [--keep-session <id>]`.
// The machine's own names (user, home directory, host, git email) are passed as values that must not
// survive; a recording that still holds one, a local path or a secret-shaped string is refused.
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { homedir, hostname, userInfo } from 'node:os';
import { readSession } from '../recording.js';
import { formatSession, promoteRecording } from '../promote.js';

const args = process.argv.slice(2);
const keepAt = args.indexOf('--keep-session');
const keepSession = keepAt >= 0 ? args[keepAt + 1] : undefined;
const [raw, out] = args.filter((a, i) => !a.startsWith('--') && (keepAt < 0 || i !== keepAt + 1));
if (!raw || !out) {
  process.stderr.write('usage: promote <raw.jsonl> <out.jsonl> [--keep-session <id>]\n');
  process.exit(2);
}
function gitEmail(): string {
  try { return execFileSync('git', ['config', 'user.email'], { encoding: 'utf8' }).trim(); } catch { return ''; }
}
const forbidden = [userInfo().username, homedir(), hostname(), gitEmail()].filter(v => v.length >= 3);
writeFileSync(out, formatSession(promoteRecording(readSession(raw), { keepSession, forbidden })));
