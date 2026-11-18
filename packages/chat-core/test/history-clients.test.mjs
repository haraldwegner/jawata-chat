// His rulings, 2026-11-18: History lists the person's conversations from every client and names the client of each; a Claude or Cursor session
// opens as a replay of its recorded turns, and the person is told that a new message there starts with fresh context.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AgentSideConnection, ndJsonStream } from '@agentclientprotocol/sdk';
import { chatWith } from '../dist/test-support.js';

/** An agent that lists sessions from several clients, each naming its client in `_meta`, and loads any of them. */
function listingAgent() {
  const run = (input, output) => {
    new AgentSideConnection((conn) => ({
      async initialize() { return { protocolVersion: 1, agentCapabilities: { loadSession: true, sessionCapabilities: { list: {} } }, agentInfo: { name: 'f', version: '1' } }; },
      async newSession() { return { sessionId: 'new-1' }; },
      async listSessions() {
        return {
          sessions: [
            { sessionId: 'cc-1', cwd: '/w', title: 'Fix the build', updatedAt: '2026-11-18T09:00:00Z', _meta: { 'jawata/client': 'claude-code', 'jawata/clientName': 'Claude Code' } },
            { sessionId: 'j-1', cwd: '/w', title: 'Are you there?', updatedAt: '2026-11-16T19:51:00Z', _meta: { 'jawata/client': 'jawata-agent', 'jawata/clientName': 'jawata' } },
          ],
          nextCursor: '2026-11-16T19:51:00Z',
        };
      },
      async loadSession({ sessionId }) {
        await conn.sessionUpdate({ sessionId, update: { sessionUpdate: 'user_message_chunk', content: { type: 'text', text: 'earlier' } } });
        return {};
      },
      async prompt() { return { stopReason: 'end_turn' }; },
      async cancel() { /* nothing runs */ },
    }), ndJsonStream(output, input));
  };
  return run;
}

test('the page is told the client each listed session was had in', async () => {
  const c = chatWith(listingAgent());
  try {
    await c.port.deliver({ type: 'listSessions' });
    const listed = c.port.toView.find(m => m.type === 'sessionList');
    assert.deepEqual(listed.sessions.map(s => [s.sessionId, s.client]), [['cc-1', 'claude-code'], ['j-1', 'jawata-agent']]);
    assert.equal(listed.nextCursor, '2026-11-16T19:51:00Z');
  } finally { c.dispose(); }
});

test('opening a Claude Code session tells the person it continues with fresh context; opening one of the chat\'s own says nothing of the kind', async () => {
  const c = chatWith(listingAgent());
  try {
    await c.port.deliver({ type: 'listSessions' });
    await c.port.deliver({ type: 'openSession', sessionId: 'cc-1' });
    const told = c.host.notifier.told;
    assert.ok(told.some(t => /Claude Code/.test(t) && /fresh context/.test(t)), told.join(' | '));
    c.host.notifier.told.length = 0;
    await c.port.deliver({ type: 'openSession', sessionId: 'j-1' });
    assert.ok(!c.host.notifier.told.some(t => /fresh context/.test(t)), c.host.notifier.told.join(' | '));
  } finally { c.dispose(); }
});
