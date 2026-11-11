import type { BrainChoice, HireView, PastSession, ProposalView, TranscriptTurn, ViewState } from './view-state.js';
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
 * The version of this contract: the messages below, the intents a page sends and the state they fold into.
 *
 * THE RULE, written here once: the number is raised by every change to the shape of what passes between the core and a page, whether
 * or not the change looks small. That is a message type or an intent type added, removed or given other fields, and a field of the
 * state added, removed or given another meaning. An older page that is not told it is older ignores a message it does not know, and the
 * agent waits on an answer nobody gives; a page or core that is told another version says so and folds nothing more. The number is
 * pinned by `test/contract-shape.test.mjs`, which records the names for each number (messages, intents, state fields): a change to
 * the names without a new number is red. The fields inside each message and intent are recorded too, from VIEW_MESSAGE_FIELDS and VIEW_INTENT_FIELDS below (ledger C20-3).
 *
 * 2: turns hold ordered parts, the plan is its own part of the state, prompts carry files and can be queued, a prompt can be sent now.
 * 3: hires and their transcripts, proposals to answer, the agent's session list, the typed draft and its resets.
 * 4: the session list can ask the page to show it (`show`), for a command that opens the sessions without the button.
 * 5: the page says its number when it says ready, and the core serves only a page of its own number (ledger 28i-C13-8).
 * 6: the page tells the core when it has stopped drawing the chat (`pageFailed`), so the host's log has it (ledger 28i-C13-10).
 * 7: the side thread (CR3): a side question goes out as a prompt of a second session and its answer is shown apart from the main thread
 *    (`askSide`, `closeSide`; `sideAsked`, `sideUpdate`, `sideEnd`, `sideError`, `sideClosed`; the state's `side`).
 * 8: the Agent Control panel (CR2): the hires are a tree and carry a seat command, a task and an optional cost; the person can ask for the
 *    brains on offer and replace an agent's (`listBrains`, `chooseBrain`; `brainList`, `hireChanged`; the state's `brains`).
 * 10: what the person typed and sent, kept across conversations for the input's arrows (28h D56 (g)): `inputHistory`, and the state's `inputHistory`.
 */
export const VIEW_CONTRACT_VERSION = 10;

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
  /** The brains and models the agent offers. */
  | { type: 'brainList'; brains: BrainChoice[] }
  /** One hire as the agent now describes it (the answer to a brain change). */
  | { type: 'hireChanged'; hire: HireView }
  /** What the person has typed and not sent, as the core keeps it for them. */
  | { type: 'draft'; text: string }
  /** What the person typed in the chat and sent, newest first, as the core keeps it for them across conversations: the page's arrows walk it. */
  | { type: 'inputHistory'; entries: string[] }
  /** A page of the sessions the agent lists; `append` adds it to the list the page has, otherwise it replaces it. */
  | { type: 'sessionList'; sessions: PastSession[]; nextCursor: string | null; append: boolean; /** The list was asked for from outside the page (a command): the page shows it. */ show?: boolean }
  /** The agent proposes a change and waits: the page shows the diff with the choices, and answers with `answerPermission`. */
  | ({ type: 'permissionRequest' } & ProposalView)
  /** The proposal has been answered, or is withdrawn (the turn was cancelled, the chat cleared). */
  | { type: 'permissionResolved'; requestId: string }
  /** The person asked a side question: the side thread shows it and waits for the answer. */
  | { type: 'sideAsked'; text: string }
  /** What the agent says in the side session; the main thread is not told it. */
  | { type: 'sideUpdate'; update: SessionNotification['update'] }
  /** The side session's answer is over. */
  | { type: 'sideEnd'; stopReason: string }
  /** The side question could not be answered. */
  | { type: 'sideError'; message: string }
  /** The side thread is closed: it is forgotten, and the next side question begins a new one. */
  | { type: 'sideClosed' }
  /** The whole view state, sent after `state` to a page that says `ready`: a page that comes late, reloads or is relayed is caught up from it, not from a replay of the deltas. */
  | { type: 'snapshot'; state: ViewState };

/** Page to core. The page asks for things by name; it never names a host command (Theia and Eclipse have other ids). */
export type ViewIntent =
  /** The page has loaded and can be told things; it names the contract it was built for, and a core of another number does not serve it. */
  | { type: 'ready'; contractVersion?: number }
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
  | { type: 'answerPermission'; requestId: string; optionId: string }
  /** Ask a short side question without disturbing the running step; it goes out as a prompt of its own and is answered in the side thread. */
  | { type: 'askSide'; text: string }
  /** Close the side thread. */
  | { type: 'closeSide' }
  /** Open the side discussion's panel; `text`, when there is any, is its first question. */
  | { type: 'openSide'; text?: string }
  /** Let the person pick files to attach to the next prompt. */
  | { type: 'chooseFiles' }
  /** A picture pasted into the message field; `data` is its bytes in base64. */
  | { type: 'attachPasted'; name: string; mimeType: string; data: string }
  /** Ask which brains and models the agent offers. */
  | { type: 'listBrains' }
  /** Replace the brain and model of one hire. */
  | { type: 'chooseBrain'; planId: string; brain: string; model: string }
  /** The page hit an error it could not draw past and shows the person a notice; the core writes it down. */
  | { type: 'pageFailed'; message: string };

/** The names of a message's fields, `type` left out. */
type FieldsOf<M> = Exclude<keyof M, 'type'>;
/** True when A and B hold the same names, false otherwise (false, not never, so a failing entry can be named). */
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
/** The types of a union whose recorded fields differ from the union's: never when every entry matches. */
type Mismatched<U extends { type: string }, R extends { readonly [T in U['type']]: readonly string[] }> =
  { [T in U['type']]: Same<R[T][number], FieldsOf<Extract<U, { type: T }>>> extends true ? never : T }[U['type']];

/**
 * Every message type with the names of its fields, once (ledger 28i-C20-3). The compiler holds it to the union above: a message added
 * to one and not the other, or a field added inside a message and not here, fails to compile below. `test/contract-shape.test.mjs`
 * records it for each contract number, so a field changed without a new number is red.
 * @public a relay in another language (Eclipse's Java line) reads it to know what each message carries
 */
export const VIEW_MESSAGE_FIELDS = {
  state: ['contractVersion', 'activeSessionId', 'session'],
  sessionUpdate: ['update', 'sessionId'],
  userPrompt: ['text', 'files'],
  promptQueued: ['text', 'files'],
  promptStart: [],
  promptEnd: ['stopReason', 'usage'],
  error: ['message'],
  modesUpdate: ['modes'],
  modelsUpdate: ['models'],
  configOptionsUpdate: ['configOptions'],
  loadSessionStart: [],
  loadSessionEnd: ['ok'],
  sessionInfoUpdate: ['title'],
  clearChat: [],
  'file-attached': ['path', 'name'],
  'file-detached': ['path'],
  hireTranscript: ['planId', 'turns'],
  brainList: ['brains'],
  hireChanged: ['hire'],
  draft: ['text'],
  inputHistory: ['entries'],
  sessionList: ['sessions', 'nextCursor', 'append', 'show'],
  permissionRequest: ['requestId', 'title', 'diffs', 'options'],
  permissionResolved: ['requestId'],
  sideAsked: ['text'],
  sideUpdate: ['update'],
  sideEnd: ['stopReason'],
  sideError: ['message'],
  sideClosed: [],
  snapshot: ['state'],
} as const satisfies { readonly [T in ViewMessage['type']]: readonly FieldsOf<Extract<ViewMessage, { type: T }>>[] };

/**
 * Every intent type with the names of its fields, once: the same rule as {@link VIEW_MESSAGE_FIELDS}, from page to core.
 * @public a relay reads it to know which intents to pass on
 */
export const VIEW_INTENT_FIELDS = {
  ready: ['contractVersion'],
  sendPrompt: ['text', 'files'],
  sendNow: [],
  cancelTurn: [],
  setMode: ['modeId'],
  setModel: ['modelId'],
  setConfigOption: ['configId', 'value'],
  connectAgent: [],
  disconnectAgent: [],
  configureAgent: [],
  detachFile: ['path'],
  stopHire: ['planId'],
  openTranscript: ['planId'],
  keepDraft: ['text'],
  listSessions: ['cursor'],
  openSession: ['sessionId'],
  askSide: ['text'],
  closeSide: [],
  openSide: ['text'],
  chooseFiles: [],
  attachPasted: ['name', 'mimeType', 'data'],
  listBrains: [],
  chooseBrain: ['planId', 'brain', 'model'],
  answerPermission: ['requestId', 'optionId'],
  pageFailed: ['message'],
} as const satisfies { readonly [T in ViewIntent['type']]: readonly FieldsOf<Extract<ViewIntent, { type: T }>>[] };

// the records and the unions say the same thing: a field missing from a record names its message here and fails to compile
const messageFieldsMatchTheUnion: [Mismatched<ViewMessage, typeof VIEW_MESSAGE_FIELDS>] extends [never] ? true : Mismatched<ViewMessage, typeof VIEW_MESSAGE_FIELDS> = true;
const intentFieldsMatchTheUnion: [Mismatched<ViewIntent, typeof VIEW_INTENT_FIELDS>] extends [never] ? true : Mismatched<ViewIntent, typeof VIEW_INTENT_FIELDS> = true;
void messageFieldsMatchTheUnion;
void intentFieldsMatchTheUnion;

/**
 * Every intent type, once, read off {@link VIEW_INTENT_FIELDS}. A message from a page whose type is not in it is not an intent.
 * @public the intent tests enumerate it to see that each type is delivered
 */
export const VIEW_INTENT_TYPES = Object.keys(VIEW_INTENT_FIELDS) as ViewIntent['type'][];

/** What a page of this build says when it is ready: the one spelling the page, a host and the tests use. */
export const READY_INTENT: ViewIntent = { type: 'ready', contractVersion: VIEW_CONTRACT_VERSION };

const isString = (v: unknown): v is string => typeof v === 'string';

/** Whether a value that arrived from a page is an intent: one of ours, with the payload its type needs. */
export function isViewIntent(value: unknown): value is ViewIntent {
  if (typeof value !== 'object' || value === null) { return false; }
  const v = value as Record<string, unknown>;
  switch (v.type) {
    case 'ready': return v.contractVersion === undefined || typeof v.contractVersion === 'number';
    case 'cancelTurn': case 'sendNow': case 'connectAgent': case 'disconnectAgent': case 'configureAgent': case 'closeSide': case 'chooseFiles': case 'listBrains': return true;
    case 'chooseBrain': return isString(v.planId) && isString(v.brain) && isString(v.model);
    case 'askSide': return isString(v.text);
    case 'openSide': return v.text === undefined || isString(v.text);
    case 'attachPasted': return isString(v.name) && isString(v.mimeType) && isString(v.data);
    case 'detachFile': return isString(v.path);
    case 'stopHire': case 'openTranscript': return isString(v.planId);
    case 'keepDraft': return isString(v.text);
    case 'listSessions': return v.cursor === undefined || isString(v.cursor);
    case 'openSession': return isString(v.sessionId);
    case 'answerPermission': return isString(v.requestId) && isString(v.optionId);
    case 'pageFailed': return isString(v.message);
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
