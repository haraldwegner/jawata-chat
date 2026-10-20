import { ndJsonStream } from '@agentclientprotocol/sdk';
import type { AuthMethod } from '@agentclientprotocol/sdk';

import { ChatController } from './chat-controller.js';
import { Emitter } from './emitter.js';
import { createChat } from './create-chat.js';
import { createInProcessLink } from './in-process-link.js';
import { AGENT_KEY, type AgentClosed, type AgentConfigEntry, type AgentFailed, type AgentHandle, type AgentHost, type Chooser, type HostPorts, type Notifier, type TrafficSink } from './ports.js';
import type { Disposable, ViewIntent, ViewMessage, ViewPort } from './view.js';

/**
 * What a test of the chat needs, once: a port that records what the page is told, the normal form
 * the goldens are written in, and an in-memory host. The editor test of the extension and the core's
 * own tests use these same things, so the two cannot drift apart. Not part of the running chat.
 */

/** A port that records instead of drawing. */
export class RecordingPort implements ViewPort {
  readonly toView: ViewMessage[] = [];
  revealed = 0;
  private handler: ((message: unknown) => void | Promise<void>) | undefined;
  post(message: ViewMessage): void { this.toView.push(message); }
  onMessage(handler: (message: unknown) => void | Promise<void>): Disposable {
    this.handler = handler;
    return { dispose: () => { this.handler = undefined; } };
  }
  reveal(): void { this.revealed++; }
  onDispose(): Disposable { return { dispose: () => { /* never disposed */ } }; }
  /** What the page would send. */
  async deliver(message: unknown): Promise<void> { await this.handler?.(message); }
}

/** Left out of a golden: they differ between runs or carry the machine (draftResets counts the clears a run made before the one a golden is about). */
export const IGNORED = ['cwd', 'updatedAt', 'draftResets'];
/** Replaced by the order they first appear in: stable, and the pairing of a tool call with its updates stays checked. */
export const IDS = ['sessionId', 'messageId', 'toolCallId', 'requestId'];
/** Replaced by a digest of the payload and its length: a command list is about 60 KB and is the agent's, not ours. */
export const DIGESTED = ['availableCommands'];

/** A stable fingerprint of a JSON value: FNV-1a (64 bit) over its text with the keys in order. Not a security hash. */
export function digestOf(value: unknown): string {
  const canonical = (v: unknown): unknown => Array.isArray(v) ? v.map(canonical)
    : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([k, x]) => [k, canonical(x)]))
    : v;
  const text = JSON.stringify(canonical(value));
  const mask = (1n << 64n) - 1n;
  let hash = 0xcbf29ce484222325n;
  for (let i = 0; i < text.length; i++) {
    hash = ((hash ^ BigInt(text.charCodeAt(i))) * 0x100000001b3n) & mask;
  }
  return hash.toString(16).padStart(16, '0');
}

/** The message with IGNORED fields removed, each id replaced by its first-seen ordinal, and each DIGESTED payload by its digest, everywhere. */
export function normalize(value: unknown, seen: Map<string, Map<string, number>> = new Map()): unknown {
  if (Array.isArray(value)) { return value.map(v => normalize(v, seen)); }
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .filter(([k]) => !IGNORED.includes(k))
      .map(([k, v]) => {
        if (IDS.includes(k) && typeof v === 'string') {
          const ids = seen.get(k) ?? new Map<string, number>();
          seen.set(k, ids);
          if (!ids.has(v)) { ids.set(v, ids.size + 1); }
          return [k, `${k}#${ids.get(v)}`];
        }
        if (DIGESTED.includes(k) && Array.isArray(v)) { return [k, { digest: digestOf(v), count: v.length }]; }
        return [k, normalize(v, seen)];
      }));
  }
  return value;
}

/** What a golden file holds for a recorded stream: the rules it was normalized by, and the messages. */
export function goldenBody(messages: unknown[]): unknown {
  return JSON.parse(JSON.stringify({ ignored: IGNORED, idsByFirstSeenOrdinal: IDS, digested: DIGESTED, messages: normalize(messages) }));
}

/** A chooser that answers at once and keeps what it was asked: the first (or only) authentication method, yes to a question. */
export class FakeChooser implements Chooser {
  readonly authChoices: { agentName: string; methods: AuthMethod[] }[] = [];
  /** The questions put to the person, and what the person answers (yes unless a test sets it). */
  readonly questions: string[] = [];
  answer = true;
  async confirm(question: string): Promise<boolean> { this.questions.push(question); return this.answer; }
  async chooseAuthMethod(agentName: string, methods: AuthMethod[]): Promise<AuthMethod | undefined> {
    this.authChoices.push({ agentName, methods });
    return methods[0];
  }
  async confirmAuthMethod(): Promise<boolean> { return true; }
}

/**
 * The person answering proposals, for a test: whenever the chat tells the port of a proposal, answer it with the next of these
 * option ids (the last again once they are used up). The port is the one the chat is attached to.
 */
export function answerProposals(chat: ChatController, port: ViewPort, optionIds: string[]): void {
  let next = 0;
  const post = port.post.bind(port);
  port.post = (message: ViewMessage) => {
    post(message);
    if (message.type === 'permissionRequest') {
      const optionId = optionIds[Math.min(next++, optionIds.length - 1)];
      void Promise.resolve().then(() => chat.handle({ type: 'answerPermission', requestId: message.requestId, optionId }));
    }
  };
}

/** A notifier that runs the job at once and keeps what it was told, in order. */
export class FakeNotifier implements Notifier {
  readonly told: string[] = [];
  async progress<T>(title: string, job: () => Promise<T>): Promise<T> { this.told.push(`progress: ${title}`); return job(); }
  info(message: string): void { this.told.push(`info: ${message}`); }
  error(message: string): void { this.told.push(`error: ${message}`); }
}

/** Runs an agent over the given streams: `input` is what the chat sends, `output` is where the agent writes. */
export type AgentRunner = (input: ReadableStream<Uint8Array>, output: WritableStream<Uint8Array>) => void;

/** The command a conformance run gives an agent host to start a program that cannot start; the in-memory host takes it as such. */
export const CANNOT_START = 'cannot-start';

/** An agent host with no processes: "starting" an agent runs the given function over a pair of in-memory streams. */
export class InMemoryAgents extends Emitter implements AgentHost {
  private readonly running = new Map<string, AgentHandle>();
  private next = 1;
  /** How many agent programs were started. */
  spawned = 0;
  constructor(private readonly run: AgentRunner) { super(); }
  spawnAgent(name: string, config?: AgentConfigEntry): AgentHandle {
    const id = `fake_${this.next++}`;
    this.spawned++;
    // a program that cannot start reports an error, as a real one does
    if (config?.command === CANNOT_START) { void Promise.resolve().then(() => this.emit('agent-error', { agentId: id, error: new Error('cannot start') } satisfies AgentFailed)); }
    const toAgent = new TransformStream<Uint8Array, Uint8Array>();
    const fromAgent = new TransformStream<Uint8Array, Uint8Array>();
    this.run(toAgent.readable, fromAgent.writable);
    const handle: AgentHandle = { id, name, stream: ndJsonStream(toAgent.writable, fromAgent.readable) };
    this.running.set(id, handle);
    return handle;
  }
  /** The agents that have been started and not ended. */
  get alive(): number { return this.running.size; }
  onClosed(listener: (event: AgentClosed) => void): Disposable {
    this.on('agent-closed', listener);
    return { dispose: () => { this.off('agent-closed', listener); } };
  }
  onError(listener: (event: AgentFailed) => void): Disposable {
    this.on('agent-error', listener);
    return { dispose: () => { this.off('agent-error', listener); } };
  }
  killAgent(agentId: string): boolean {
    const existed = this.running.delete(agentId);
    if (existed) { this.emit('agent-closed', { agentId, code: 0 }); }
    return existed;
  }
}

/** A whole host in memory: the agent is the given runner, the person answers as the chooser does, and what the chat logs and sends the agent's way is kept. */
export interface FakeHost extends HostPorts {
  agents: InMemoryAgents;
  chooser: FakeChooser;
  notifier: FakeNotifier;
  logged: string[];
  traffic: { direction: 'send' | 'recv'; message: unknown }[];
  /** The host actions the page asked for, in order. */
  asked: string[];
}

export function fakeHost(run: AgentRunner, cwd = '/workspace'): FakeHost {
  const logged: string[] = [];
  const traffic: FakeHost['traffic'] = [];
  const asked: string[] = [];
  const agent: AgentConfigEntry = { command: 'in-memory' };
  const sink: TrafficSink = (direction, message) => { traffic.push({ direction, message }); };
  return {
    agents: new InMemoryAgents(run),
    settings: { agents: () => ({ [AGENT_KEY]: agent }), workspaceCwd: () => cwd, agentSetup: 'the fake settings' },
    chooser: new FakeChooser(),
    notifier: new FakeNotifier(),
    log: { log: (m) => { logged.push(m); }, logError: (m, e) => { logged.push(`ERROR ${m} ${e instanceof Error ? e.message : String(e ?? '')}`); } },
    actions: {
      configureAgent: async () => { asked.push('configureAgent'); },
    },
    sinks: () => [sink],
    clientInfo: { name: 'chat-core-test', version: '0' },
    logged, traffic, asked,
  };
}

/** A recording port that is also the page's line: what the core posts is recorded and reaches the page, and what the page sends reaches the core. */
export class LoopbackPort extends RecordingPort {
  private readonly link = createInProcessLink();
  override post(message: ViewMessage): void { super.post(message); this.link.port.post(message); }
  override onMessage(handler: (message: unknown) => void | Promise<void>): Disposable { return this.link.port.onMessage(handler); }
  override deliver(message: unknown): Promise<void> { return this.link.deliver(message); }
  /** The page's side of the line: the shape a view takes as its transport. */
  readonly page = { onMessage: this.link.page.onMessage, send: (intent: ViewIntent): void => { void this.deliver(intent); } };
}

/** A whole chat on an in-memory host whose agent is `run`: the sessions, the controller, and the port attached to it. */
export function chatWith(run: AgentRunner, port: RecordingPort = new RecordingPort()) {
  const host = fakeHost(run);
  const built = createChat(host);
  built.controller.attach(port);
  return { host, updates: built.updates, sessions: built.sessions, chat: built.controller, port, dispose: () => built.dispose() };
}

/** Wait, up to `ms`, for `done()` to hold; `sleep` is the caller's (this package has no timers of its own). */
async function until(done: () => boolean, sleep: (ms: number) => Promise<void>, ms = 5000): Promise<boolean> {
  for (let waited = 0; waited < ms; waited += 20) {
    if (done()) { return true; }
    await sleep(20);
  }
  return done();
}

/**
 * What an agent host must do, held against a real host and the in-memory one alike: the list of what it does not do, empty when it
 * conforms. Every host (VS Code, Theia, Eclipse) is checked with this one function, so a misnamed or never-sent event is found in the
 * host's own tests and not by an agent whose death goes unnoticed.
 * @param host the agent host under test
 * @param config how to start a program that stays running until it is ended
 * @param sleep waits for the given milliseconds (a real host needs real time to end a program)
 * @param cannotStart how to start a program that cannot start (the in-memory host takes {@link CANNOT_START}); its failure must reach onError or onClosed
 */
export async function agentHostFailures(host: AgentHost, config: AgentConfigEntry, sleep: (ms: number) => Promise<void>, cannotStart: AgentConfigEntry): Promise<string[]> {
  const failures: string[] = [];
  const closed: AgentClosed[] = [];
  const dropped: AgentClosed[] = [];
  const hearing = host.onClosed(event => closed.push(event));
  const handle = host.spawnAgent('conformance', config);
  if (!handle.id || handle.name !== 'conformance' || !handle.stream) { failures.push('spawnAgent returns a handle with an id, the name it was given and a stream'); }

  if (host.killAgent('nobody') !== false) { failures.push('killAgent of an unknown agent answers false'); }
  if (host.killAgent(handle.id) !== true) { failures.push('killAgent of a running agent answers true'); }
  if (!await until(() => closed.some(e => e.agentId === handle.id), sleep)) { failures.push('onClosed is told when an agent is ended by killAgent'); }
  if (closed.filter(e => e.agentId === handle.id).length > 1) { failures.push('onClosed is told once for one ending'); }
  if (host.killAgent(handle.id) !== false) { failures.push('killAgent of an agent already ended answers false'); }

  // a program that cannot start is told, as an error or as an ending (a shell reports a missing program as an exit): never silently
  const told: string[] = [];
  const watching = [host.onError(event => told.push(event.agentId)), host.onClosed(event => told.push(event.agentId))];
  const broken = host.spawnAgent('conformance', cannotStart);
  if (!await until(() => told.includes(broken.id), sleep)) { failures.push('onError or onClosed is told when an agent\'s program cannot start'); }
  watching.forEach(w => w.dispose());
  host.killAgent(broken.id);

  hearing.dispose();
  const second = host.onClosed(event => dropped.push(event));
  second.dispose();
  const again = host.spawnAgent('conformance', config);
  host.killAgent(again.id);
  await sleep(200);
  if (dropped.length > 0) { failures.push('a registration that was disposed is told nothing'); }
  return failures;
}

/** What a notifier must do, held against every host: the list of what it does not do. */
export async function notifierFailures(notifier: Notifier): Promise<string[]> {
  const failures: string[] = [];
  if (await notifier.progress('conformance', async () => 42) !== 42) { failures.push('progress gives back what its job gives'); }
  const refused = await notifier.progress('conformance', async () => { throw new Error('the job failed'); }).then(() => undefined, (e: Error) => e.message);
  if (refused !== 'the job failed') { failures.push('progress passes on the error its job throws'); }
  try { notifier.info('conformance'); notifier.error('conformance'); } catch { failures.push('info and error never throw'); }
  return failures;
}
