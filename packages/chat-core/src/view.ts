import type { PastSession, ProposalView, TranscriptTurn, ViewState } from './view-state.js';
import type { AvailableCommand, SessionConfigOption, SessionModeState, SessionNotification } from '@agentclientprotocol/sdk';

/**
 * What the chat core tells its page and what the page tells the core: the one contract between
 * core and view (architecture finding F11). Every message is JSON-serialisable; delivery is
 * ordered and lossless while a port is attached.
 */

/** Something to dispose: a subscription to a port. */
export interface Disposable {
  dispose(): void;
}

/**
 * The version of this contract: the messages below and the state they fold into. It is raised when
 * either changes in a way a host that relays it must follow (2: turns hold ordered parts, the plan is
 * its own part of the state, prompts carry files and can be queued, a prompt can be sent now). A view
 * or core that is told another version says so and folds nothing more.
 */
export const VIEW_CONTRACT_VERSION = 2;

/**
 * The legacy model list of an agent that has no model config option. The SDK 1.x dropped its type:
 * config options supersede it (R1's real traffic carries none). Kept for parity with agents that send no config options.
 */
export interface SessionModelState {
  currentModelId: string;
  availableModels: { modelId: string; name: string; description?: string | null }[];
}

/**
 * The session as the page is told about it, on `ready` and when it changes.
 * @public part of the versioned view surface that hosts outside this workspace name
 */
export interface ViewSession {
  sessionId: string;
  agentName: string;
  title: string | null | undefined;
  cwd: string | undefined;
  modes: SessionModeState | null;
  models: SessionModelState | null;
  configOptions: SessionConfigOption[] | null;
  availableCommands: AvailableCommand[];
}

/** Core to page. */
export type ViewMessage =
  | { type: 'state'; contractVersion: number; activeSessionId: string | null; session: ViewSession | null }
  | { type: 'sessionUpdate'; update: SessionNotification['update']; sessionId: string }
  /** The prompt the person sent, from the page or from a command: the page draws it from this, so a prompt sent any way shows. */
  | { type: 'userPrompt'; text: string; files?: string[] }
  /** A prompt typed while a turn ran: it waits, and is sent (as a `userPrompt`) when the turn ends. */
  | { type: 'promptQueued'; text: string; files?: string[] }
  | { type: 'promptStart' }
  | { type: 'promptEnd'; stopReason: string; usage?: unknown }
  | { type: 'error'; message: string }
  | { type: 'modesUpdate'; modes: SessionModeState }
  | { type: 'modelsUpdate'; models: SessionModelState }
  | { type: 'configOptionsUpdate'; configOptions: SessionConfigOption[] | null }
  | { type: 'loadSessionStart' }
  | { type: 'loadSessionEnd'; ok: boolean }
  | { type: 'sessionInfoUpdate'; title: string | null }
  | { type: 'clearChat' }
  | { type: 'file-attached'; path: string; name: string }
  /** The person took an attached file back out before sending. */
  | { type: 'file-detached'; path: string }
  /** What the agent answered when asked for a hired agent's transcript. */
  | { type: 'hireTranscript'; planId: string; turns: TranscriptTurn[] }
  /** What the person has typed and not sent, as the core keeps it for them. */
  | { type: 'draft'; text: string }
  /** A page of the sessions the agent lists; `append` adds it to the list the page has, otherwise it replaces it. */
  | { type: 'sessionList'; sessions: PastSession[]; nextCursor: string | null; append: boolean }
  /** The agent proposes a change and waits: the page shows the diff with the choices, and answers with `answerPermission`. */
  | ({ type: 'permissionRequest' } & ProposalView)
  /** The proposal has been answered, or is withdrawn (the turn was cancelled, the chat cleared). */
  | { type: 'permissionResolved'; requestId: string }
  /** The whole view state, sent after `state` to a page that says `ready`: a page that comes late, reloads or is relayed is caught up from it, not from a replay of the deltas. */
  | { type: 'snapshot'; state: ViewState };

/** Page to core. The page asks for things by name; it never names a host command (Theia and Eclipse have other ids). */
export type ViewIntent =
  | { type: 'ready' }
  /** `files` are paths; the core makes them part of the prompt as the agent expects. */
  | { type: 'sendPrompt'; text: string; files?: string[] }
  /** Stop the running turn and send what is queued now. */
  | { type: 'sendNow' }
  | { type: 'cancelTurn' }
  | { type: 'setMode'; modeId: string }
  | { type: 'setModel'; modelId: string }
  | { type: 'setConfigOption'; configId: string; value: string }
  | { type: 'connectAgent' }
  | { type: 'disconnectAgent' }
  | { type: 'configureAgent' }
  | { type: 'detachFile'; path: string }
  /** End one hired agent; the others go on. */
  | { type: 'stopHire'; planId: string }
  /** Ask for a hired agent's transcript, which the page then shows read-only. */
  | { type: 'openTranscript'; planId: string }
  /** Keep what the person has typed and not sent, so a reloaded page has it back; empty when it was sent. */
  | { type: 'keepDraft'; text: string }
  /** Ask the agent which sessions it has; `cursor` asks for the next page. */
  | { type: 'listSessions'; cursor?: string }
  /** Open a session the agent listed: it is replayed into the chat. */
  | { type: 'openSession'; sessionId: string }
  /** Answer a proposal with one of the choices the agent offered. */
  | { type: 'answerPermission'; requestId: string; optionId: string };

/**
 * Every intent type, once. A message from a page whose type is not in it is not an intent.
 * @public the intent tests enumerate it to see that each type is delivered
 */
export const VIEW_INTENT_TYPES = [
  'ready', 'sendPrompt', 'sendNow', 'cancelTurn', 'setMode', 'setModel', 'setConfigOption',
  'connectAgent', 'disconnectAgent', 'configureAgent', 'detachFile', 'stopHire', 'openTranscript', 'answerPermission', 'listSessions', 'openSession', 'keepDraft',
] as const;

// the list and the union say the same thing: a type added to one and not the other fails to compile here
type SameMembers<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;
const intentTypesMatchTheUnion: SameMembers<(typeof VIEW_INTENT_TYPES)[number], ViewIntent['type']> = true;
void intentTypesMatchTheUnion;

const isString = (v: unknown): v is string => typeof v === 'string';

/** Whether a value that arrived from a page is an intent: one of ours, with the payload its type needs. */
export function isViewIntent(value: unknown): value is ViewIntent {
  if (typeof value !== 'object' || value === null) { return false; }
  const v = value as Record<string, unknown>;
  switch (v.type) {
    case 'ready': case 'cancelTurn': case 'sendNow': case 'connectAgent': case 'disconnectAgent': case 'configureAgent': return true;
    case 'detachFile': return isString(v.path);
    case 'stopHire': case 'openTranscript': return isString(v.planId);
    case 'keepDraft': return isString(v.text);
    case 'listSessions': return v.cursor === undefined || isString(v.cursor);
    case 'openSession': return isString(v.sessionId);
    case 'answerPermission': return isString(v.requestId) && isString(v.optionId);
    case 'sendPrompt': return isString(v.text) && (v.files === undefined || (Array.isArray(v.files) && v.files.every(isString)));
    case 'setMode': return isString(v.modeId);
    case 'setModel': return isString(v.modelId);
    case 'setConfigOption': return isString(v.configId) && isString(v.value);
    default: return false;
  }
}

/**
 * The one place the chat's messages pass between the core and its page, in both directions. The page
 * is a webview in VS Code; another host supplies another port (28k, 32), and a test supplies one that records.
 */
export interface ViewPort {
  /** Tell the page something. */
  post(message: ViewMessage): void;
  /** Hear from the page; dispose the result to stop hearing. What arrives is untrusted: the core checks it is an intent. */
  onMessage(handler: (message: unknown) => void | Promise<void>): Disposable;
  /** Bring the page into view, if the host can. */
  reveal?(): void;
  /** Hear that the page is gone. */
  onDispose(handler: () => void): Disposable;
}

/**
 * The view's side of the line to the core: what it is told, and what it asks. The host supplies it, the webview's message passing in
 * VS Code, a native mount in Theia, a relay in Eclipse, and the view knows nothing of which. (The core's side of the same line is
 * {@link ViewPort}.)
 */
export interface PageTransport {
  /** Hear the core; dispose the result to stop hearing. */
  onMessage(handler: (message: ViewMessage) => void): Disposable;
  /** Ask the core. */
  send(intent: ViewIntent): void;
}
