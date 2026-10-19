#!/usr/bin/env node
// A named run, never part of npm test: drives Claude Code's ACP adapter through one scenario with an
// SDK client, with the agent started through acp-contract's tee, so the traffic is recorded in the
// session format; the raw file is then promoted (account notices dropped, working directory
// replaced, the session list cut to this run's session, and a recording that still holds anything
// local refused). Scenarios give phase B's recordings: thinking (R9), plan (R10), hires (the base of
// R4), model (the base of R5), proposals (R7), history (R6).
// Usage: node scripts/record-claude.mjs <scenario> <out-dir> [--effort <value>]
// The scratch workspace (<out-dir>/workspace) holds `.claude/settings.local.json` with the user's
// hooks disabled, because a hooked Claude never asks an ACP client for permission (finding F6).
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Readable, Writable } from 'node:stream';
import { createRequire } from 'node:module';
import { ClientSideConnection, ndJsonStream } from '@agentclientprotocol/sdk';

const [scenario, outArg, ...rest] = process.argv.slice(2);
const SCENARIOS = {
  thinking: 'Work out carefully, step by step in your private reasoning, how many of the integers from 1 to 200 are divisible by 3 or by 7 but not by both; then answer with the number only.',
  plan: 'Load the task tools with ToolSearch (query select:TaskCreate,TaskUpdate), then use TaskCreate to create exactly three tasks: name a color, name a number, name an animal. Then carry out each task in one short line and mark it completed with TaskUpdate.',
  hires: 'Launch two sub-agents in parallel with the Task tool in a single step. Each sub-agent must answer with exactly the one word done. When both have finished, reply with the word both.',
  model: 'Reply with exactly the one word: pong',
  proposals: 'Use the Write tool to create a.txt containing the word one, and then, separately, the Write tool to create b.txt containing the word two. Do nothing else.',
  history: 'Reply with exactly the one word: pong',
};
if (!SCENARIOS[scenario] || !outArg) {
  console.error('usage: record-claude.mjs <thinking|plan|hires|model|proposals|history> <out-dir> [--effort <value>]');
  process.exit(2);
}
const effortAt = rest.indexOf('--effort');
const effort = effortAt >= 0 ? rest[effortAt + 1] : undefined;
const out = resolve(outArg);
const require = createRequire(import.meta.url);
const tee = require.resolve('@jawata/acp-contract/bin/tee');
const promote = require.resolve('@jawata/acp-contract/bin/promote');
const workspace = join(out, 'workspace');
mkdirSync(join(workspace, '.claude'), { recursive: true });
writeFileSync(join(workspace, '.claude', 'settings.local.json'), JSON.stringify({ disableAllHooks: true, ...(scenario === 'thinking' ? { alwaysThinkingEnabled: true } : {}) }));

const permissionAnswers = scenario === 'proposals' ? ['allow_once', 'reject_once'] : ['allow_once'];
let permissionCount = 0;

async function connect(rawFile) {
  const child = spawn(process.execPath, [tee, '--out', rawFile, '--', 'npx', '-y', '@agentclientprotocol/claude-agent-acp@0.93.0'],
    { cwd: workspace, stdio: ['pipe', 'pipe', 'inherit'], env: { ...process.env, ...(scenario === 'thinking' ? { MAX_THINKING_TOKENS: '8000' } : {}) } });
  const seen = { kinds: new Set(), thought: 0, plan: 0, toolCalls: 0 };
  const client = {
    async requestPermission(p) {
      const want = permissionAnswers[Math.min(permissionCount++, permissionAnswers.length - 1)];
      const option = p.options.find((o) => o.kind === want) ?? p.options[0];
      console.error(`permission ${permissionCount}: answering ${option.kind}`);
      return { outcome: { outcome: 'selected', optionId: option.optionId } };
    },
    async sessionUpdate(n) {
      const u = n.update.sessionUpdate;
      seen.kinds.add(u);
      if (u === 'agent_thought_chunk') { seen.thought++; }
      if (u === 'plan') { seen.plan++; }
      if (u === 'tool_call') { seen.toolCalls++; }
    },
  };
  const stream = ndJsonStream(Writable.toWeb(child.stdin), Readable.toWeb(child.stdout));
  const conn = new ClientSideConnection(() => client, stream);
  await conn.initialize({ protocolVersion: 1, clientInfo: { name: 'jawata-record-claude', version: '0.0.0' }, clientCapabilities: {} });
  return { child, conn, seen };
}
async function close(child) {
  child.stdin.end();
  await new Promise((r) => { child.on('close', r); setTimeout(() => { child.kill('SIGTERM'); }, 15000); });
}
function configOption(res, category) { return (res.configOptions ?? []).find((o) => o.category === category); }
function flatChoices(opt) { return (opt.options ?? []).flatMap((o) => (o.options ? o.options : [o])); }

const raw = join(out, `${scenario}-raw.jsonl`);
if (existsSync(raw)) { rmSync(raw); }
const first = await connect(raw);
const session = await first.conn.newSession({ cwd: workspace, mcpServers: [] });

if (scenario === 'history') {
  await first.conn.prompt({ sessionId: session.sessionId, prompt: [{ type: 'text', text: SCENARIOS.history }] });
  await close(first.child);
  rmSync(raw);
  const second = await connect(raw);
  const listed = await second.conn.listSessions({});
  const target = listed.sessions.find((s) => s.sessionId === session.sessionId);
  console.error(`listed ${listed.sessions.length} sessions; ours is ${target ? 'among them' : 'MISSING'}`);
  await second.conn.loadSession({ sessionId: session.sessionId, cwd: workspace, mcpServers: [] });
  console.error(`replayed update kinds: ${[...second.seen.kinds].join(', ')}`);
  await close(second.child);
} else {
  if (scenario === 'model') {
    const model = configOption(session, 'model');
    const other = flatChoices(model).find((c) => c.value !== model.currentValue);
    console.error(`model ${model.currentValue} -> ${other.value}`);
    await first.conn.setSessionConfigOption({ sessionId: session.sessionId, configId: model.id, value: other.value });
  }
  if (effort) {
    const opt = configOption(session, 'thought_level');
    const choice = flatChoices(opt).find((c) => c.value === effort);
    if (!choice) { console.error(`effort ${effort} is not offered: ${flatChoices(opt).map((c) => c.value).join(', ')}`); process.exit(3); }
    await first.conn.setSessionConfigOption({ sessionId: session.sessionId, configId: opt.id, value: effort });
  }
  const res = await first.conn.prompt({ sessionId: session.sessionId, prompt: [{ type: 'text', text: SCENARIOS[scenario] }] });
  console.error(`stopReason ${res.stopReason}; update kinds: ${[...first.seen.kinds].join(', ')}; thought chunks ${first.seen.thought}; plan updates ${first.seen.plan}; tool calls ${first.seen.toolCalls}`);
  await close(first.child);
}

const promoted = join(out, `${scenario}.jsonl`);
await new Promise((ok, fail) => spawn(process.execPath, [promote, raw, promoted, ...(scenario === 'history' ? ['--keep-session', session.sessionId] : [])], { stdio: 'inherit' }).on('close', (c) => (c === 0 ? ok() : fail(new Error('promote failed')))));
console.error(`recorded ${promoted}`);
