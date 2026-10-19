// Plays a recorded session on the in-memory host: the same flow the editor test drives through the real one.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { replayAgent, readSession } from '@jawata/acp-contract';
import { answerProposals, chatWith } from '../dist/test-support.js';

const require = createRequire(import.meta.url);

export function sessionFile(name) {
  return require.resolve(`@jawata/acp-contract/sessions/${name}.jsonl`);
}

/** A chat on a host whose agent plays the named session. */
export function chatOn(name) {
  const session = readSession(sessionFile(name));
  const c = chatWith((input, output) => replayAgent(session, output, input));
  // the person answers the proposals as the recording says they did
  const answers = session.filter(l => l.dir === 'send' && l.msg.result?.outcome?.optionId).map(l => l.msg.result.outcome.optionId);
  if (answers.length > 0) { answerProposals(c.chat, c.port, answers); }
  return { ...c, session };
}

/** The prompt-and-answer sessions: connect, send one prompt, wait for the turn to end. */
export async function played(name) {
  const c = chatOn(name);
  try {
    await c.sessions.connectToAgent('agent');
    await c.chat.sendPrompt('replay');
    await new Promise(r => setTimeout(r, 100));
    return c.port.toView;
  } finally { c.dispose(); }
}

/** R6: list, then open (load) the session the recording loads, and wait for the replay to end. */
export async function loaded(name) {
  const c = chatOn(name);
  try {
    const sessionId = readFileSync(sessionFile(name), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)).find(l => l.msg.method === 'session/load').msg.params.sessionId;
    await c.sessions.listSessions('agent');
    await c.sessions.loadSession('agent', sessionId);
    for (let i = 0; i < 100 && !c.port.toView.some(m => m.type === 'loadSessionEnd'); i++) { await new Promise(r => setTimeout(r, 50)); }
    await new Promise(r => setTimeout(r, 100));
    return c.port.toView;
  } finally { c.dispose(); }
}
