// The port conformance suite (ledger C13-10, C17-3): one contract for every host's agent port and notifier, held here against the
// in-memory host; the extension's own tests hold the real host to the same functions.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { agentHostFailures, notifierFailures, CANNOT_START, FakeNotifier, InMemoryAgents } from '../dist/test-support.js';

const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const idle = () => new InMemoryAgents(() => { /* an agent that says nothing and stays */ });

test('the in-memory agent host and notifier conform', async () => {
  assert.deepEqual(await agentHostFailures(idle(), { command: 'unused' }, sleep, { command: CANNOT_START }), []);
  assert.deepEqual(await notifierFailures(new FakeNotifier()), []);
});

test('control: a host that never says an agent has ended is found', async () => {
  const mute = idle();
  mute.onClosed = () => ({ dispose() { /* told nothing */ } });
  assert.ok((await agentHostFailures(mute, { command: 'unused' }, sleep, { command: CANNOT_START })).some(f => /onClosed is told when an agent is ended/.test(f)));
});

test('control: a host whose disposed registration still hears is found', async () => {
  const leaky = idle();
  leaky.onClosed = (listener) => { leaky.on('agent-closed', listener); return { dispose() { /* keeps listening */ } }; };
  assert.ok((await agentHostFailures(leaky, { command: 'unused' }, sleep, { command: CANNOT_START })).some(f => /disposed is told nothing/.test(f)));
});

test('control: a host that never says that a program could not start is found', async () => {
  const quiet = idle();
  quiet.onError = () => ({ dispose() { /* told nothing */ } });
  assert.ok((await agentHostFailures(quiet, { command: 'unused' }, sleep, { command: CANNOT_START })).some(f => /onError or onClosed is told when an agent's program cannot start/.test(f)));
});

test('control: a notifier that swallows its job\'s error is found', async () => {
  const swallowing = { progress: async (_t, job) => { try { return await job(); } catch { return undefined; } }, info() {}, error() {} };
  assert.ok((await notifierFailures(swallowing)).some(f => /passes on the error/.test(f)));
});
