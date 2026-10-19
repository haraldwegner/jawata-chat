#!/usr/bin/env node
// An agent-side recorder for clients we do not control: `tee --out <file> -- <agent command> [args]`.
// The client starts this as its agent; it starts the real agent, passes both directions through
// unchanged, and writes every JSON line in the recorded-session format ({"dir":"send"|"recv","msg":…},
// send = client to agent; lines are written by the contract's own formatLine). Promote the file with
// `promote` before it becomes a contract recording. A file that already exists is kept: this run
// writes <name>.2<ext>, <name>.3<ext> … and says which on stderr.
import { spawn } from 'node:child_process';
import { appendFileSync, existsSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { extname } from 'node:path';
import { formatLine, type RecordedLine } from '../recording.js';

const argv = process.argv.slice(2);
const dash = argv.indexOf('--');
const outAt = argv.indexOf('--out');
const requested = outAt >= 0 && outAt < dash ? argv[outAt + 1] : undefined;
const command = dash >= 0 ? argv.slice(dash + 1) : [];
if (!requested || command.length === 0) {
  process.stderr.write('usage: tee --out <file> -- <agent command> [args...]\n');
  process.exit(2);
}

function freePath(path: string): string {
  if (!existsSync(path)) { return path; }
  const ext = extname(path);
  const stem = path.slice(0, path.length - ext.length);
  for (let n = 2; ; n++) {
    if (!existsSync(`${stem}.${n}${ext}`)) { return `${stem}.${n}${ext}`; }
  }
}
const out = freePath(requested);
if (out !== requested) { process.stderr.write(`tee: ${requested} exists; recording to ${out}\n`); }
writeFileSync(out, '');

const agent = spawn(command[0]!, command.slice(1), { stdio: ['pipe', 'pipe', 'inherit'] });
agent.on('error', (e) => {
  process.stderr.write(`tee: cannot start ${command[0]}: ${e.message}\n`);
  process.exit(127);
});

function record(dir: RecordedLine['dir'], line: string): void {
  let msg: unknown;
  try { msg = JSON.parse(line); } catch { return; }
  if (msg && typeof msg === 'object') { appendFileSync(out, formatLine(dir, msg as RecordedLine['msg']) + '\n'); }
}

const fromClient = createInterface({ input: process.stdin });
fromClient.on('line', (line) => {
  record('send', line);
  agent.stdin.write(line + '\n');
});
fromClient.on('close', () => agent.stdin.end());

const fromAgent = createInterface({ input: agent.stdout });
fromAgent.on('line', (line) => {
  record('recv', line);
  process.stdout.write(line + '\n');
});

// the real agent ends with its pipes drained: only then does this process end, so no line is lost
let status: number | null = null;
let agentOutputDone = false;
function finish(): void {
  if (status === null || !agentOutputDone) { return; }
  process.exitCode = status;
  process.stdin.destroy();
}
agent.on('close', (code) => { status = code ?? 0; finish(); });
fromAgent.on('close', () => { agentOutputDone = true; finish(); });

// a client that stops this process stops the real agent too
for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP'] as const) {
  process.on(signal, () => { agent.kill(signal); });
}
