import { AgentSideConnection, ndJsonStream, type Agent } from '@agentclientprotocol/sdk';
import type { RecordedLine } from './recording.js';

/**
 * The recorded answer to one client request: the request itself, what the agent sent before its
 * response, the response, and what followed until the client's next request. The client's answers
 * to agent requests stay in place as markers.
 */
export interface Segment {
  request: RecordedLine;
  before: RecordedLine[];
  result: unknown;
  after: RecordedLine[];
}

/** Cut a session into segments, one per client request, queued by method in recorded order. */
export function segmentsOf(session: RecordedLine[]): Map<string, Segment[]> {
  const byMethod = new Map<string, Segment[]>();
  let open: { id: unknown; seg: Segment; answered: boolean } | undefined;
  for (const line of session) {
    const m = line.msg;
    if (line.dir === 'send' && m.method !== undefined && m.id !== undefined) {
      open = { id: m.id, seg: { request: line, before: [], result: undefined, after: [] }, answered: false };
      byMethod.set(m.method, [...(byMethod.get(m.method) ?? []), open.seg]);
      continue;
    }
    if (!open) { continue; }
    if (line.dir === 'send') {
      if (m.method === undefined && m.id !== undefined) { (open.answered ? open.seg.after : open.seg.before).push(line); }
      continue;
    }
    if (!open.answered && m.id === open.id && m.method === undefined) {
      open.seg.result = m.result;
      open.answered = true;
    } else {
      (open.answered ? open.seg.after : open.seg.before).push(line);
    }
  }
  return byMethod;
}

/** Which Agent handler answers each recorded client method. */
const HANDLERS: Record<string, keyof Agent> = {
  'initialize': 'initialize',
  'authenticate': 'authenticate',
  'session/new': 'newSession',
  'session/load': 'loadSession',
  'session/list': 'listSessions',
  'session/prompt': 'prompt',
  'session/set_mode': 'setSessionMode',
  'session/set_config_option': 'setSessionConfigOption',
};

/**
 * Play a recorded session as an ACP agent over the given streams, through the SDK's own agent
 * side. Each client request is answered with the next recorded segment for its method; every
 * recorded agent message is sent as recorded (requests by method, notifications by method). An
 * agent request is sent without waiting and its answer awaited where the recording received it,
 * and what follows a response finishes before the next request is answered.
 */
export function replayAgent(session: RecordedLine[], output: WritableStream<Uint8Array>, input: ReadableStream<Uint8Array>): AgentSideConnection {
  const queues = segmentsOf(session);
  let conn!: AgentSideConnection;
  let tail: Promise<void> = Promise.resolve();

  const play = async (lines: RecordedLine[]) => {
    const pending = new Map<unknown, Promise<unknown>>();
    for (const l of lines) {
      const m = l.msg;
      if (l.dir === 'send') {
        await pending.get(m.id);
      } else if (m.method !== undefined && m.id !== undefined) {
        pending.set(m.id, m.method === 'session/request_permission'
          ? conn.requestPermission(m.params)
          : conn.extMethod(m.method, m.params));
      } else if (m.method === 'session/update') {
        await conn.sessionUpdate(m.params);
      } else if (m.method !== undefined) {
        await conn.extNotification(m.method, m.params);
      } else {
        throw new Error(`replay: cannot play a recorded agent line: ${JSON.stringify(m).slice(0, 120)}`);
      }
    }
    await Promise.all(pending.values());
  };

  const answer = async (method: string) => {
    await tail;
    const seg = queues.get(method)?.shift();
    if (!seg) { throw new Error(`replay: no recorded answer left for ${method}`); }
    await play(seg.before);
    // the response goes out when this handler returns; what followed it plays after that
    tail = new Promise<void>((resolve, reject) => setTimeout(() => play(seg.after).then(resolve, reject), 0));
    return seg.result as never;
  };

  const agent: Partial<Agent> = { cancel: async () => {} };
  for (const method of queues.keys()) {
    const handler = HANDLERS[method];
    if (handler) {
      (agent as Record<string, unknown>)[handler] = () => answer(method);
    } else if (method.startsWith('_')) {
      // the SDK hands an extension method over without its leading underscore
      agent.extMethod = async (m: string) => (await answer(m.startsWith('_') ? m : `_${m}`)) as Record<string, unknown>;
    }
  }
  agent.authenticate ??= async () => ({});
  conn = new AgentSideConnection(() => agent as Agent, ndJsonStream(output, input));
  return conn;
}
