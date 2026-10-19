import type {
  AvailableCommand,
  InitializeResponse,
  PromptResponse,
  SessionConfigOption,
  SessionModeState,
} from '@agentclientprotocol/sdk';
import type { SessionModelState } from './view.js';
import type { TranscriptTurn } from './view-state.js';

/** What an agent can do with sessions, read from its `initialize` answer. */
export interface AgentCapabilitySummary {
  list: boolean;
  load: boolean;
  resume: boolean;
}

/** A session the chat holds with an agent, and what the agent has told it about the session so far. */
export interface SessionInfo {
  sessionId: string;
  /** What the agent said about the session, and may say again: the commands it offers, what the person can choose, its title. */
  availableCommands: AvailableCommand[];
  /** What the agent lets the person choose for this session (ACP session config options). `null`: it sent none. Where it sent these and also `modes` or `models`, these win. */
  configOptions: SessionConfigOption[] | null;
  models: SessionModelState | null;
  modes: SessionModeState | null;
  /** The latest title a `session_info_update` brought, if any. */
  title?: string;
  /** Which agent holds the session: the name the chat knows it by, the process, and the name to show. */
  agentName: string;
  agentId: string;
  agentDisplayName: string;
  initResponse: InitializeResponse;
  /** The folder the session works in, and when the chat opened it. */
  cwd: string;
  createdAt: string;
}

/** What `session_info_update` may change. */
interface SessionInfoUpdate {
  title?: string | null;
  updatedAt?: string | null;
}

/** What the session manager announces, by event name, with the arguments each event carries. */
export type SessionEvents = {
  'agent-connected': [agentName: string];
  'agent-disconnected': [agentName: string];
  'agent-error': [agentId: string, error: Error];
  'agent-closed': [agentId: string, code: number | null];
  'active-session-changed': [sessionId: string | null];
  'clear-chat': [];
  'mode-changed': [sessionId: string, modeId: string];
  'model-changed': [sessionId: string, modelId: string];
  'config-options-changed': [sessionId: string, options: SessionConfigOption[] | null];
  'available-commands-changed': [sessionId: string, commands: AvailableCommand[]];
  'session-info-changed': [sessionId: string, update: SessionInfoUpdate];
  'session-load-start': [sessionId: string, agentName: string];
  'session-load-end': [sessionId: string, agentName: string, ok: boolean];
};

/**
 * What the chat controller needs of the sessions, and nothing more: the active session to read, the
 * verbs of a conversation, and the events to listen for. A session it is given is a snapshot (and
 * typed read-only at the top), so it cannot write a fact about a session: a write at any depth
 * reaches only the copy.
 */
export interface ChatSessions {
  on<K extends keyof SessionEvents>(event: K, listener: (...args: SessionEvents[K]) => void): unknown;
  off<K extends keyof SessionEvents>(event: K, listener: (...args: SessionEvents[K]) => void): unknown;
  getActiveSessionId(): string | null;
  getActiveSession(): Readonly<SessionInfo> | undefined;
  getSession(sessionId: string): Readonly<SessionInfo> | undefined;
  sendPrompt(sessionId: string, text: string, files?: string[]): Promise<PromptResponse>;
  cancelTurn(sessionId: string): Promise<void>;
  setMode(sessionId: string, modeId: string): Promise<void>;
  setModel(sessionId: string, modelId: string): Promise<void>;
  setConfigOption(sessionId: string, configId: string, value: string): Promise<SessionConfigOption[] | null>;
  /** The sessions the agent lists (`session/list`), a page at a time. */
  listSessions(agentName: string, page?: { cwd?: string; cursor?: string }): Promise<{ sessions: { sessionId: string; title?: string | null; updatedAt?: string | null }[]; nextCursor?: string }>;
  /** End one hired agent (`_jawata/hire/stop`). */
  stopHire(sessionId: string, planId: string): Promise<void>;
  /** A hired agent's transcript (`_jawata/hire/transcript`). */
  hireTranscript(sessionId: string, planId: string): Promise<TranscriptTurn[]>;
}

/** What the conversation flow needs of the sessions: how one begins, ends and is opened. */
export interface SessionLifecycle {
  /** Connect to the agent and open a session with it; the session open already is reused. */
  connectToAgent(agentName: string): Promise<SessionInfo>;
  /** End the session and open a fresh one with the same agent; the page is told to clear. */
  newConversation(): Promise<SessionInfo | null>;
  disconnectAgent(agentName: string): Promise<void>;
  /** Open a session the agent has: loaded, so its conversation is replayed, where the agent can; resumed, without it, where it can only do that. Refused when it can do neither. */
  open(agentName: string, sessionId: string): Promise<'loaded' | 'resumed'>;
  getActiveSession(): Readonly<SessionInfo> | undefined;
  getActiveSessionId(): string | null;
  getActiveAgentName(): string | null;
}
