// While the agent starts and its session opens, the page is told it is loading, so it shows no "No agent is connected" with a Connect button
// (his words, 2026-11-17: the connect screen should "only be there when there is no connection").
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chatWith } from '../dist/test-support.js';
import { chatOn } from './play.mjs';

const typesOf = (c) => c.port.toView.map(m => m.type);

test('connecting: the page is told the agent is opening before the session exists, and that it is over once the session is open', async () => {
  const c = chatOn('R1');
  try {
    await c.sessions.connectToAgent('agent');
    const types = typesOf(c);
    const start = types.indexOf('loadSessionStart');
    const state = types.indexOf('state');
    const end = types.lastIndexOf('loadSessionEnd');
    assert.ok(start >= 0, `the page was told the agent is opening: ${types.join(',')}`);
    assert.ok(state > start, `before the session is announced: ${types.join(',')}`);
    assert.ok(end > state, `and told it is over after: ${types.join(',')}`);
    assert.equal(c.port.toView[end].ok, true);
    assert.equal(c.chat.snapshot().loading, false, 'the page is not left loading');
  } finally { c.dispose(); }
});

test('connecting twice: the second, which finds the session open, tells the page nothing of an opening', async () => {
  const c = chatOn('R1');
  try {
    await c.sessions.connectToAgent('agent');
    const before = typesOf(c).filter(t => t === 'loadSessionStart').length;
    await c.sessions.connectToAgent('agent');
    assert.equal(typesOf(c).filter(t => t === 'loadSessionStart').length, before);
  } finally { c.dispose(); }
});

test('an opening that fails ends the loading too, with ok false, so the connect screen comes back', async () => {
  // an agent that ends before it answers anything: the start fails, before any session exists
  const c = chatWith((_input, output) => { void output.getWriter().close(); });
  try {
    await assert.rejects(() => c.sessions.connectToAgent('agent'));
    const types = typesOf(c);
    assert.ok(types.includes('loadSessionStart'), types.join(','));
    const end = c.port.toView.findLast(m => m.type === 'loadSessionEnd');
    assert.ok(end, `the page was told the opening is over: ${types.join(',')}`);
    assert.equal(end.ok, false);
    assert.equal(c.chat.snapshot().loading, false);
  } finally { c.dispose(); }
});
