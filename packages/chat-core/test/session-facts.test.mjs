// What an agent says about a session (its commands, options and title) is written down by the sessions themselves,
// in one place, whoever else listens: a controller is not needed for it, and does not do it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SessionRegistry } from '../dist/session-registry.js';
import { chatOn } from './play.mjs';

const update = (sessionId, body) => ({ sessionId, update: body });

/** A connected chat whose controller is gone: only the sessions are left to hear the agent. */
async function sessionsAlone() {
  const c = chatOn('R1');
  await c.sessions.connectToAgent('agent');
  c.chat.dispose();
  return { ...c, id: c.sessions.getActiveSessionId() };
}

test('commands, options and a title the agent announces reach the session with no controller listening', async () => {
  const c = await sessionsAlone();
  try {
    const heard = [];
    c.sessions.on('available-commands-changed', (id, commands) => heard.push(['commands', id, commands.length]));
    c.sessions.on('config-options-changed', (id, options) => heard.push(['options', id, options.length]));
    c.sessions.on('session-info-changed', (id, info) => heard.push(['info', id, info.title]));

    c.updates.publish(update(c.id, { sessionUpdate: 'available_commands_update', availableCommands: [{ name: 'x', description: 'd' }] }));
    c.updates.publish(update(c.id, { sessionUpdate: 'config_option_update', configOptions: [{ id: 'm', name: 'Mode', type: 'select', currentValue: 'a', options: [] }] }));
    c.updates.publish(update(c.id, { sessionUpdate: 'session_info_update', title: 'Named' }));

    const session = c.sessions.getSession(c.id);
    assert.deepEqual(session.availableCommands.map(x => x.name), ['x']);
    assert.deepEqual(session.configOptions.map(x => x.id), ['m']);
    assert.equal(session.title, 'Named');
    assert.deepEqual(heard, [['commands', c.id, 1], ['options', c.id, 1], ['info', c.id, 'Named']]);

    c.updates.publish(update(c.id, { sessionUpdate: 'session_info_update', title: null }));
    assert.equal(c.sessions.getSession(c.id).title, undefined, 'a null title removes it');
  } finally { c.dispose(); }
});

test('the mode the agent says it is in reaches the session through the same route, and the page is told', async () => {
  const c = await sessionsAlone();
  try {
    const before = c.sessions.getSession(c.id).modes;
    assert.ok(before && before.availableModes.length > 1, 'R1 advertises modes');
    const other = before.availableModes.find(m => m.id !== before.currentModeId).id;
    const heard = [];
    c.sessions.on('mode-changed', (id, modeId) => heard.push([id, modeId]));
    c.updates.publish(update(c.id, { sessionUpdate: 'current_mode_update', currentModeId: other }));
    assert.equal(c.sessions.getSession(c.id).modes.currentModeId, other);
    assert.deepEqual(heard, [[c.id, other]]);
  } finally { c.dispose(); }
});

test('a mode announced before the session is in the table is held like the other facts', () => {
  const table = new SessionRegistry();
  assert.equal(table.note(update('later', { sessionUpdate: 'current_mode_update', currentModeId: 'plan' })), undefined);
  const session = { sessionId: 'later', agentId: 'a', agentName: 'agent', agentDisplayName: 'A', cwd: '/', createdAt: '', initResponse: {}, modes: { currentModeId: 'default', availableModes: [{ id: 'default', name: 'Default' }, { id: 'plan', name: 'Plan' }] }, models: null, configOptions: null, availableCommands: [] };
  table.add(session);
  assert.equal(session.modes.currentModeId, 'plan');
});

test('a fact that arrives before the session is in the table is held and becomes part of the session when it is added', () => {
  const table = new SessionRegistry();
  const say = (update) => table.note({ sessionId: 'later', update });
  assert.equal(say({ sessionUpdate: 'available_commands_update', availableCommands: [{ name: 'early', description: '' }] }), undefined, 'no session yet, so nothing took it');
  say({ sessionUpdate: 'session_info_update', title: 'Early title' });
  say({ sessionUpdate: 'config_option_update', configOptions: [] });
  const session = { sessionId: 'later', agentId: 'a', agentName: 'agent', agentDisplayName: 'A', cwd: '/', createdAt: '', initResponse: {}, modes: null, models: null, configOptions: null, availableCommands: [] };
  table.add(session);
  assert.deepEqual(session.availableCommands.map(x => x.name), ['early']);
  assert.equal(session.title, 'Early title');
  assert.deepEqual(session.configOptions, [], 'options held as none arrive as an empty list');
});

test('the controller writes no fact about a session: it holds no call that sets one', () => {
  const source = readFileSync(new URL('../src/chat-controller.ts', import.meta.url), 'utf8');
  assert.ok(!/applyAvailableCommands|applyConfigOptions|applySessionInfoUpdate|setCommands|setOptions|setTitle/.test(source));
  const types = readFileSync(new URL('../src/session-types.ts', import.meta.url), 'utf8');
  const interfaceBody = types.slice(types.indexOf('export interface ChatSessions'));
  assert.ok(!/apply|set(Commands|Options|Title)/.test(interfaceBody.replace(/setMode|setModel|setConfigOption/g, '')), 'the narrow interface the controller depends on offers no writer of session facts');
});

test('ending the agent announces it once: one disconnect and one change of the active session', async () => {
  const c = chatOn('R1');
  try {
    await c.sessions.connectToAgent('agent');
    const heard = [];
    for (const event of ['agent-disconnected', 'active-session-changed', 'agent-closed']) { c.sessions.on(event, (...a) => heard.push(event)); }
    await c.sessions.disconnectAgent('agent');
    assert.deepEqual(heard.filter(e => e !== 'agent-closed'), ['agent-disconnected', 'active-session-changed']);
  } finally { c.dispose(); }
});

// the compiler, not a text pattern, is what keeps a reader of the sessions from writing a fact into one
test('a holder of ChatSessions can read a session and cannot write to it: the compiler refuses', () => {
  const tsc = fileURLToPath(new URL('../node_modules/typescript/bin/tsc', import.meta.url));
  const types = fileURLToPath(new URL('../dist/session-types.js', import.meta.url));
  const dir = mkdtempSync(join(tmpdir(), 'chat-sessions-control-'));
  const compile = (name, body) => {
    writeFileSync(join(dir, name), `import type { ChatSessions } from '${types}';\n${body}\n`);
    return spawnSync(process.execPath, [tsc, '--ignoreConfig', '--noEmit', '--target', 'es2022', '--module', 'nodenext', '--moduleResolution', 'nodenext', '--lib', 'es2022', '--types', '', '--skipLibCheck', join(dir, name)], { encoding: 'utf8' });
  };
  try {
    const reads = compile('reads.ts', 'export const title = (s: ChatSessions) => s.getActiveSession()?.title ?? s.getSession("x")?.availableCommands.length;');
    assert.equal(reads.status, 0, reads.stdout + reads.stderr);
    for (const [name, body] of [
      ['active-title.ts', 'export function f(s: ChatSessions) { const a = s.getActiveSession(); if (a) { a.title = "x"; } }'],
      ['commands.ts', 'export function f(s: ChatSessions) { const a = s.getSession("x"); if (a) { a.availableCommands = []; } }'],
      ['options.ts', 'export function f(s: ChatSessions) { const a = s.getSession("x"); if (a) { a.configOptions = null; } }'],
    ]) {
      const r = compile(name, body);
      assert.notEqual(r.status, 0, `${name} compiled: a fact was written through ChatSessions`);
      assert.match(r.stdout + r.stderr, /read-only/, name);
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a session handed out is a snapshot: writing into it at any depth changes nothing in the sessions', async () => {
  const c = await sessionsAlone();
  try {
    c.updates.publish(update(c.id, { sessionUpdate: 'available_commands_update', availableCommands: [{ name: 'a', description: '' }, { name: 'b', description: '' }] }));
    const handed = c.sessions.getSession(c.id);
    handed.availableCommands.splice(0);
    handed.title = 'tampered';
    handed.initResponse.agentInfo = null;
    const active = c.sessions.getActiveSession();
    active.availableCommands.push({ name: 'z', description: '' });
    const again = c.sessions.getSession(c.id);
    assert.deepEqual(again.availableCommands.map(x => x.name), ['a', 'b']);
    assert.notEqual(again.title, 'tampered');
    assert.ok(again.initResponse.agentInfo, 'the initialize answer is untouched');
    assert.notEqual(handed, again, 'every call is a copy of its own');
  } finally { c.dispose(); }
});

