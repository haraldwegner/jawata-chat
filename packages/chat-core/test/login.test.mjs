// An agent that asks the person to sign in first: the chat asks which way (or confirms the only way), signs in, and tries again;
// a person who declines, or an agent that refuses, ends the agent. The agent here is a small fake, over the SDK, with no recording.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AgentSideConnection, RequestError, ndJsonStream } from '@agentclientprotocol/sdk';
import { chatWith } from '../dist/test-support.js';

/** An agent that refuses `session/new` until `authenticate` has been called with one of its methods. */
function agentThatWantsASignIn({ methods, refuseSignIn = false }) {
  const calls = [];
  const run = (input, output) => {
    let signedIn = false;
    new AgentSideConnection(() => ({
      async initialize() { return { protocolVersion: 1, agentCapabilities: {}, authMethods: methods, agentInfo: { name: 'needs-login', version: '1' } }; },
      async authenticate({ methodId }) {
        calls.push(['authenticate', methodId]);
        if (refuseSignIn) { throw new Error('wrong password'); }
        signedIn = true;
        return {};
      },
      async newSession() {
        calls.push(['newSession', signedIn]);
        if (!signedIn) { throw new RequestError(-32000, 'Authentication required'); }
        return { sessionId: 'signed-in-session' };
      },
      async prompt() { return { stopReason: 'end_turn' }; },
      async cancel() { /* nothing runs */ },
    }), ndJsonStream(output, input));
  };
  return { run, calls };
}

const one = [{ id: 'oauth', name: 'Sign in with the browser', description: 'opens a page' }];
const two = [...one, { id: 'key', name: 'Use a key' }];

test('with one way to sign in the person confirms it, the chat signs in and the session opens', async () => {
  const agent = agentThatWantsASignIn({ methods: one });
  const c = chatWith(agent.run);
  try {
    const session = await c.sessions.connectToAgent('agent');
    assert.equal(session.sessionId, 'signed-in-session');
    assert.deepEqual(agent.calls, [['newSession', false], ['authenticate', 'oauth'], ['newSession', true]]);
    assert.deepEqual(c.host.chooser.authChoices, [], 'with one way there is nothing to choose between');
  } finally { c.dispose(); }
});

test('with several ways the person chooses one, and that one is used', async () => {
  const agent = agentThatWantsASignIn({ methods: two });
  const c = chatWith(agent.run);
  try {
    c.host.chooser.chooseAuthMethod = async (agentName, methods) => { c.host.chooser.authChoices.push({ agentName, methods }); return methods[1]; };
    await c.sessions.connectToAgent('agent');
    assert.deepEqual(agent.calls.filter(x => x[0] === 'authenticate'), [['authenticate', 'key']]);
    assert.equal(c.host.chooser.authChoices[0].methods.length, 2);
  } finally { c.dispose(); }
});

test('a person who declines ends the agent: the connect fails, no sign-in is attempted, and no session is held', async () => {
  const agent = agentThatWantsASignIn({ methods: one });
  const c = chatWith(agent.run);
  try {
    c.host.chooser.confirmAuthMethod = async () => false;
    await assert.rejects(c.sessions.connectToAgent('agent'), /Authentication cancelled by user/);
    assert.deepEqual(agent.calls.filter(x => x[0] === 'authenticate'), []);
    assert.equal(c.sessions.getActiveSessionId(), null);
    assert.equal(c.host.agents.alive, 0, 'the agent was ended');
  } finally { c.dispose(); }
});

test('an agent that refuses the sign-in ends too, and the reason is in the error', async () => {
  const agent = agentThatWantsASignIn({ methods: one, refuseSignIn: true });
  const c = chatWith(agent.run);
  try {
    await assert.rejects(c.sessions.connectToAgent('agent'), /Authentication failed/);
    assert.equal(c.host.agents.alive, 0);
  } finally { c.dispose(); }
});

test('an agent that asks for a sign-in and offers no way to do it is an error that says so', async () => {
  const agent = agentThatWantsASignIn({ methods: [] });
  const c = chatWith(agent.run);
  try {
    await assert.rejects(c.sessions.connectToAgent('agent'), /did not advertise any auth methods/);
  } finally { c.dispose(); }
});
