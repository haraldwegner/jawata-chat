import type { Disposable } from './view.js';
import type {
  CreateTerminalRequest, CreateTerminalResponse, KillTerminalRequest, KillTerminalResponse,
  ReadTextFileRequest, ReadTextFileResponse, ReleaseTerminalRequest, ReleaseTerminalResponse,
  Stream, TerminalOutputRequest,
  TerminalOutputResponse, WaitForTerminalExitRequest, WaitForTerminalExitResponse,
  WriteTextFileRequest, WriteTextFileResponse, AuthMethod,
} from '@agentclientprotocol/sdk';

/**
 * What the host gives the chat core (architecture S4: ports and adapters). The core names these and
 * knows nothing else about its host; an in-memory fake implements them in the core's own tests.
 */

/** The one agent the chat starts: program, arguments, environment. */
export interface AgentConfigEntry {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

/** The key the one agent is stored under; sessions are keyed by it. */
export const AGENT_KEY = 'agent';

/** An agent the host has started, reachable over its byte stream. */
export interface AgentHandle {
  id: string;
  name: string;
  /** The messages of the agent's stdio, framed as the protocol does (the SDK's own stream shape). */
  stream: Stream;
}

/**
 * Starts and ends the agent program, and says when it has ended. The host owns processes; the core
 * never sees one, and keeps its own register of the agents it started.
 */
export interface AgentHost {
  /**
   * Optional. Settles when the host is done getting ready for an agent to be started (the editors' extensions use it to wait for the
   * service the agent's program talks to). The core awaits it before it starts a program; it must always settle and must not reject:
   * a host that could not get ready says so itself and lets the start go on as it would without this port.
   */
  ready?(): Promise<void>;
  spawnAgent(name: string, config: AgentConfigEntry, cwd?: string): AgentHandle;
  killAgent(agentId: string): boolean;
  /** Told when an agent's program has ended, by its own account or because it was killed. Stop being told with the returned handle. */
  onClosed(listener: (event: AgentClosed) => void): Disposable;
  /** Told when an agent's program reports an error. */
  onError(listener: (event: AgentFailed) => void): Disposable;
}

/** An agent's program has ended. */
export interface AgentClosed {
  agentId: string;
  /** The exit code; null when the program was ended by a signal. */
  code: number | null;
}

/** An agent's program reported an error. */
export interface AgentFailed {
  agentId: string;
  error: Error;
}

/**
 * The host's settings and workspace.
 * @public named by hosts outside this repository, which implement it
 */
export interface Settings {
  /** The configured agents, by name; empty when none is set. */
  agents(): Record<string, AgentConfigEntry>;
  /** The folder the agent works in. */
  workspaceCwd(): string;
  /** Where the person sets the agent up, in the host's own words, as a noun phrase: "the jawataChat.agent setting". */
  readonly agentSetup: string;
}

/** The choices that need a person and are the host's to put: an authentication method, a yes to something that loses messages. A proposal is not one of them: it is shown in the chat. */
export interface Chooser {
  /** Ask a question that is answered with one action or by cancelling; false when cancelled. */
  confirm(question: string, yes: string): Promise<boolean>;
  /** Pick one of several methods; undefined when cancelled. */
  chooseAuthMethod(agentName: string, methods: AuthMethod[]): Promise<AuthMethod | undefined>;
  /** Confirm the only method; false when cancelled. */
  confirmAuthMethod(agentName: string, method: AuthMethod): Promise<boolean>;
}

/** The host's file system, offered to the agent only if the host has one. */
export interface FsPort {
  readTextFile(request: ReadTextFileRequest): Promise<ReadTextFileResponse>;
  writeTextFile(request: WriteTextFileRequest): Promise<WriteTextFileResponse>;
}

/** The host's terminals, offered to the agent only if the host has them. */
export interface TerminalPort {
  createTerminal(request: CreateTerminalRequest): Promise<CreateTerminalResponse>;
  terminalOutput(request: TerminalOutputRequest): Promise<TerminalOutputResponse>;
  waitForTerminalExit(request: WaitForTerminalExitRequest): Promise<WaitForTerminalExitResponse>;
  killTerminal(request: KillTerminalRequest): Promise<KillTerminalResponse>;
  releaseTerminal(request: ReleaseTerminalRequest): Promise<ReleaseTerminalResponse>;
}

/**
 * What the page can ask of the host beyond the conversation: the one place the host decides what it is.
 * @public named by hosts outside this repository, which implement it
 */
export interface HostActions {
  /** Open the place where the agent is configured. */
  configureAgent(): Promise<void>;
}

/** How the core tells the person what is going on and what went wrong. */
export interface Notifier {
  /** Run a job while the person is shown, with this title, that it is under way. */
  progress<T>(title: string, job: () => Promise<T>): Promise<T>;
  info(message: string): void;
  error(message: string): void;
}

/** The host's log. */
export interface Log {
  log(message: string): void;
  logError(message: string, error?: unknown): void;
}

/** Something that sees every message of a connection, in either direction. */
export type TrafficSink = (direction: 'send' | 'recv', message: unknown) => void;

/**
 * Everything the core takes from its host, in one value.
 *
 * HOW EACH CALL CROSSES A LINE (ledger 28i-C11-5, folded at C12). Every member is classified in {@link HOST_CALLS}, which the compiler
 * holds to these interfaces: a member added here does not compile until it is classified. A host whose half lives across a line, as
 * Eclipse's Java side does when the core runs in the page, reads that record: what ANSWERS AT ONCE (the settings, `sinks`,
 * `clientInfo`, and `agents.spawnAgent`, whose handle and stream must exist when it returns, and `agents.killAgent`) needs a page-side
 * stand-in or a value read before the chat is built; what returns a PROMISE or tells a LISTENER crosses as it is; a NOTICE (the log,
 * `notifier.info` and `error`) needs no answer. The agent's stream carries the protocol's messages, framed as the SDK frames them, not
 * raw bytes. `syncReadFailures` in the test support probes the reads that answer at once.
 */
export interface HostPorts {
  agents: AgentHost;
  settings: Settings;
  chooser: Chooser;
  fs?: FsPort;
  terminal?: TerminalPort;
  log: Log;
  notifier: Notifier;
  actions: HostActions;
  /** The sinks for one connection's traffic (the traffic log, a recording). */
  sinks(agentId: string): TrafficSink[];
  /** What the core tells the agent it is. */
  clientInfo: { name: string; version: string };
}

/** How a host call crosses a line: answered at once, a promise, a listener told later, or a notice that needs no answer. */
type CallKind = 'at-once' | 'promise' | 'listener' | 'notice';
/** Every member of a port, each classified. */
type KindsOf<T> = { readonly [K in keyof Required<T>]: CallKind };

/**
 * Every member of {@link HostPorts}, classified by how it crosses a line. The type requires every member of every port, so a member
 * added to a port and left out here, or classified under a name the port does not have, fails to compile.
 * @public a host outside this repository (Eclipse's Java side) reads it to know what it must answer at once
 */
export const HOST_CALLS: {
  readonly agents: KindsOf<AgentHost>; readonly settings: KindsOf<Settings>; readonly chooser: KindsOf<Chooser>;
  readonly fs: KindsOf<FsPort>; readonly terminal: KindsOf<TerminalPort>; readonly log: KindsOf<Log>; readonly notifier: KindsOf<Notifier>;
  readonly actions: KindsOf<HostActions>; readonly sinks: CallKind; readonly clientInfo: CallKind;
} = {
  agents: { ready: 'promise', spawnAgent: 'at-once', killAgent: 'at-once', onClosed: 'listener', onError: 'listener' },
  settings: { agents: 'at-once', workspaceCwd: 'at-once', agentSetup: 'at-once' },
  chooser: { confirm: 'promise', chooseAuthMethod: 'promise', confirmAuthMethod: 'promise' },
  fs: { readTextFile: 'promise', writeTextFile: 'promise' },
  terminal: { createTerminal: 'promise', terminalOutput: 'promise', waitForTerminalExit: 'promise', killTerminal: 'promise', releaseTerminal: 'promise' },
  log: { log: 'notice', logError: 'notice' },
  notifier: { progress: 'promise', info: 'notice', error: 'notice' },
  actions: { configureAgent: 'promise' },
  sinks: 'at-once',
  clientInfo: 'at-once',
};
type SameKeys<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;
// every member of HostPorts has its entry above
const hostCallsCoverHostPorts: SameKeys<keyof typeof HOST_CALLS, keyof HostPorts> = true;
void hostCallsCoverHostPorts;
