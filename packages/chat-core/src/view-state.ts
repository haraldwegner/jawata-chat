import type { PlanEntry, ToolCallContent, ToolCallStatus, ToolKind } from '@agentclientprotocol/sdk';

import { VIEW_CONTRACT_VERSION, type ViewMessage, type ViewSession } from './view.js';

/**
 * The view state: what a view shows, folded from the messages the core tells it. The core folds it
 * as it posts, so a view that attaches late is given the state itself (a `snapshot`), and a view that
 * keeps no state of its own folds the same messages with the same {@link reduce}. A pure function:
 * no clock, no host, no input but its two arguments.
 */

/** One tool call as it is shown: what it is, how it stands, what went in and what came out. */
export interface ToolCallView {
  toolCallId: string;
  title: string;
  status: ToolCallStatus;
  kind: ToolKind;
  /** What the agent said it would do it with, as it sent it. */
  input?: unknown;
  /** What came back, as it was sent. */
  output?: unknown;
  /** Diffs, terminal output and other content the call produced. */
  content: ToolCallContent[];
}

/** One hired agent as the agents view shows it: what the agent sent in `_meta["jawata/hire"]`, kept by plan. */
export interface HireView {
  planId: string;
  seat: string;
  brain: string;
  model: string;
  /** `running`, `compacting`, `done` or `failed`. */
  state: string;
  elapsedMs: number;
  tokens: number;
  costUsd: number;
  brainSessionId?: string;
}

/** One turn of a hired agent's transcript, read-only. */
export interface TranscriptTurn {
  role: string;
  text: string;
}

/** Whether a hire still works: it is running or compacting. */
export const isWorking = (hire: HireView): boolean => hire.state === 'running' || hire.state === 'compacting';

/** What a tool call's `_meta` says about the hire it is, if it is one; undefined when it says nothing usable. */
function hireIn(meta: unknown): HireView | undefined {
  const h = (meta as { 'jawata/hire'?: Record<string, unknown> } | null | undefined)?.['jawata/hire'];
  if (!h || typeof h.planId !== 'string') { return undefined; }
  const num = (x: unknown) => (typeof x === 'number' ? x : 0);
  const str = (x: unknown) => (typeof x === 'string' ? x : '');
  return {
    planId: h.planId, seat: str(h.seat), brain: str(h.brain), model: str(h.model), state: str(h.state) || 'running',
    elapsedMs: num(h.elapsedMs), tokens: num(h.tokens), costUsd: num(h.costUsd),
    ...(typeof h.brainSessionId === 'string' ? { brainSessionId: h.brainSessionId } : {}),
  };
}

/** The hires with this one added or replaced by its plan, in the order they first appeared. */
function withHire(hires: HireView[], hire: HireView): HireView[] {
  return hires.some(h => h.planId === hire.planId) ? hires.map(h => (h.planId === hire.planId ? hire : h)) : [...hires, hire];
}

/** A change the agent proposes and waits to have accepted or rejected: what it is, the diffs, the choices it offered. */
export interface ProposalView {
  requestId: string;
  title: string;
  diffs: { path: string; oldText?: string | null; newText: string }[];
  options: { optionId: string; name: string; kind: string }[];
}

/** A session the agent says it has (`session/list`), as the history shows it. */
export interface PastSession {
  sessionId: string;
  title?: string | null;
  updatedAt?: string | null;
}

/** The sessions the agent listed, a page at a time. */
interface HistoryView {
  sessions: PastSession[];
  /** The cursor of the next page, if the agent has more. */
  nextCursor: string | null;
}

/** One piece of an answer; an answer is these in the order they came. */
export type PartView =
  | { kind: 'text'; text: string }
  | { kind: 'thought'; text: string }
  | { kind: 'tool'; tool: ToolCallView };

/** One answer of the agent: its parts, and whether the answer is over (what follows begins another). */
interface TurnView {
  parts: PartView[];
  ended: boolean;
}

/** A prompt as the person sent it: the words, and the names of the files that went with them. */
interface PromptView {
  text: string;
  files: string[];
}

/** What the conversation holds, in order. */
type EntryView =
  | ({ kind: 'user' } & PromptView)
  | { kind: 'turn'; turn: TurnView }
  | { kind: 'error'; message: string };

export interface ViewState {
  contractVersion: number;
  /** Set when a message spoke another version of the contract than this one: nothing else is folded, and the view says so. */
  mismatch?: number;
  session: ViewSession | null;
  entries: EntryView[];
  /** The agent's current plan; each update replaces it. It is not part of the conversation. */
  plan: PlanEntry[] | null;
  /** A turn is running: the person cannot send, and can cancel. */
  processing: boolean;
  /** A session is being loaded: its history is replaying. */
  loading: boolean;
  /** Files the person attached for the next prompt. */
  attachments: { path: string; name: string }[];
  /** Prompts typed during a turn, to be sent when it ends, oldest first. */
  queued: PromptView[];
  /** The agents hired in this conversation, as the agent last said about each. Not part of the conversation. */
  hires: HireView[];
  /** The transcripts the person asked for, by plan. */
  transcripts: Record<string, TranscriptTurn[]>;
  /** Proposals waiting for an answer, oldest first. */
  proposals: ProposalView[];
  /** What the agent last listed as its sessions; null until the page asked. It is the agent's list: the chat keeps none of its own. */
  history: HistoryView | null;
  /** What the person has typed and not sent: kept here so a page that reloads has it back. */
  draft: string;
}

/** What the agents added to the state, as it is when there is no conversation. */
const noAgents = () => ({ hires: [] as HireView[], transcripts: {} as Record<string, TranscriptTurn[]>, proposals: [] as ProposalView[] });

export function initialViewState(): ViewState {
  return { contractVersion: VIEW_CONTRACT_VERSION, session: null, entries: [], plan: null, processing: false, loading: false, attachments: [], queued: [], ...noAgents(), history: null, draft: '' };
}

/**
 * Folding a long history one message at a time copies the list of turns and an answer's parts for every message, which costs the
 * square of the history. Folding a batch ({@link reduceAll}) lets the arrays that the batch itself made be changed in place; they
 * stop being the batch's own when it ends, so no state that is handed on is ever changed afterwards. One implementation of the
 * rules: a single message is a batch of one whose arrays are all copied.
 */
let owned: WeakSet<object> | null = null;
const ownedHere = (items: object): boolean => owned !== null && owned.has(items);
function made<T>(items: T[]): T[] {
  owned?.add(items);
  return items;
}
/** The items with `item` added at the end. */
function appending<T>(items: T[], item: T): T[] {
  if (ownedHere(items)) { items.push(item); return items; }
  return made([...items, item]);
}
/** The items with the last one replaced by `item`. */
function replacingLast<T>(items: T[], item: T): T[] {
  if (ownedHere(items)) { items[items.length - 1] = item; return items; }
  const copy = items.slice();
  copy[copy.length - 1] = item;
  return made(copy);
}
/** The items with the one at `at` replaced by `item`. */
function replacingAt<T>(items: T[], at: number, item: T): T[] {
  if (ownedHere(items)) { items[at] = item; return items; }
  const copy = items.slice();
  copy[at] = item;
  return made(copy);
}

/** The last entry as an answer that is still going, if it is one. */
function openTurn(state: ViewState): TurnView | undefined {
  const last = state.entries[state.entries.length - 1];
  return last && last.kind === 'turn' && !last.turn.ended ? last.turn : undefined;
}

/** The state with the last answer, if there is one, over. */
function withTurnEnded(state: ViewState): ViewState {
  const last = state.entries[state.entries.length - 1];
  if (!last || last.kind !== 'turn' || last.turn.ended) { return state; }
  return { ...state, entries: replacingLast(state.entries, { kind: 'turn', turn: { ...last.turn, ended: true } }) };
}

/** The state with `change` applied to the open answer's parts; a new answer is begun if none is open. */
function withParts(state: ViewState, change: (parts: PartView[]) => PartView[]): ViewState {
  const open = openTurn(state);
  const parts = change(open ? open.parts : []);
  const turn: TurnView = { parts, ended: false };
  return open
    ? { ...state, entries: replacingLast(state.entries, { kind: 'turn', turn }) }
    : { ...state, entries: appending(state.entries, { kind: 'turn', turn }) };
}

/** Add words to the last part if it is of this kind, else begin a part. */
function appended(parts: PartView[], kind: 'text' | 'thought', text: string): PartView[] {
  const last = parts[parts.length - 1];
  return last && last.kind === kind
    ? replacingLast(parts, { kind, text: last.text + text })
    : appending(parts, { kind, text });
}

function withSession(state: ViewState, change: (session: ViewSession) => ViewSession): ViewState {
  return state.session ? { ...state, session: change(state.session) } : state;
}

function textOf(content: unknown): string | undefined {
  const c = content as { type?: unknown; text?: unknown } | undefined;
  return c && c.type === 'text' && typeof c.text === 'string' ? c.text : undefined;
}

type ToolUpdate = Extract<Extract<ViewMessage, { type: 'sessionUpdate' }>['update'], { sessionUpdate: 'tool_call_update' }>;

/** An update names only what changed: what it leaves out stays as it was. */
function mergedTool(old: ToolCallView, update: ToolUpdate): ToolCallView {
  return {
    ...old,
    title: update.title || old.title,
    status: update.status ?? old.status,
    kind: update.kind ?? old.kind,
    ...(update.rawInput !== undefined ? { input: update.rawInput } : {}),
    ...(update.rawOutput !== undefined ? { output: update.rawOutput } : {}),
    content: update.content ?? old.content,
  };
}

/** The state with the tool call this update names merged with what it says; unchanged if no answer holds that call. */
function withUpdatedTool(state: ViewState, update: ToolUpdate): ViewState {
  for (let i = state.entries.length - 1; i >= 0; i--) {
    const entry = state.entries[i];
    if (entry.kind !== 'turn') { continue; }
    // the call an update names is almost always one of the latest
    let at = entry.turn.parts.length - 1;
    while (at >= 0) { const p = entry.turn.parts[at]; if (p.kind === 'tool' && p.tool.toolCallId === update.toolCallId) { break; } at--; }
    if (at < 0) { continue; }
    const part = entry.turn.parts[at] as Extract<PartView, { kind: 'tool' }>;
    const parts = replacingAt(entry.turn.parts, at, { kind: 'tool', tool: mergedTool(part.tool, update) });
    return { ...state, entries: replacingAt(state.entries, i, { kind: 'turn', turn: { ...entry.turn, parts } }) };
  }
  return state;
}

function reduceUpdate(state: ViewState, update: Extract<ViewMessage, { type: 'sessionUpdate' }>['update']): ViewState {
  switch (update.sessionUpdate) {
    case 'agent_message_chunk': {
      const text = textOf(update.content);
      if (!text) { return state; }
      // leading whitespace alone does not begin an answer
      if (!openTurn(state) && !text.trim()) { return state; }
      return withParts(state, parts => appended(parts, 'text', text));
    }
    case 'agent_thought_chunk': {
      const text = textOf(update.content);
      if (text === undefined) { return state; }
      // a thought of no words, which begins no thought, shows nothing: "nothing when it sends none"
      const goingOn = openTurn(state)?.parts.at(-1)?.kind === 'thought';
      if (!goingOn && !text.trim()) { return state; }
      return withParts(state, parts => appended(parts, 'thought', text));
    }
    case 'user_message_chunk': {
      // only a replayed session carries the person's earlier messages; they end the answer before them
      const text = textOf(update.content);
      if (text === undefined) { return state; }
      const ended = withTurnEnded(state);
      const last = ended.entries[ended.entries.length - 1];
      if (last && last.kind === 'user') {
        return { ...ended, entries: replacingLast(ended.entries, { ...last, text: last.text + text }) };
      }
      return { ...ended, entries: appending(ended.entries, { kind: 'user', text, files: [] }) };
    }
    case 'tool_call': {
      const hire = hireIn(update._meta);
      const tool: ToolCallView = {
        toolCallId: update.toolCallId,
        title: update.title || 'Tool Call',
        status: update.status ?? 'pending',
        kind: update.kind ?? 'other',
        ...(update.rawInput !== undefined ? { input: update.rawInput } : {}),
        ...(update.rawOutput !== undefined ? { output: update.rawOutput } : {}),
        content: update.content ?? [],
      };
      const withTool = withParts(state, parts => appending(parts, { kind: 'tool', tool }));
      return hire ? { ...withTool, hires: withHire(withTool.hires, hire) } : withTool;
    }
    case 'tool_call_update': {
      const hire = hireIn(update._meta);
      const noted = hire ? { ...state, hires: withHire(state.hires, hire) } : state;
      return withUpdatedTool(noted, update);
    }
    case 'plan':
      return { ...state, plan: update.entries };
    case 'current_mode_update':
      return withSession(state, s => s.modes ? { ...s, modes: { ...s.modes, currentModeId: update.currentModeId } } : s);
    case 'config_option_update':
      return withSession(state, s => ({ ...s, configOptions: update.configOptions }));
    case 'available_commands_update':
      return withSession(state, s => ({ ...s, availableCommands: update.availableCommands }));
    case 'session_info_update':
      return update.title === undefined ? state : withSession(state, s => ({ ...s, title: update.title }));
    default:
      return state;
  }
}

/** The first prompt in the queue is the one that was just sent, if it says what was sent. */
function withoutQueuedHead(queued: PromptView[], sent: PromptView): PromptView[] {
  const head = queued[0];
  return head && head.text === sent.text && head.files.join('\n') === sent.files.join('\n') ? queued.slice(1) : queued;
}

/**
 * Fold many messages into the state in one pass: the same rules as {@link reduce}, at a cost that grows with the number of
 * messages and not with its square. What comes out is a state like any other; none of it is changed afterwards.
 */
export function reduceAll(state: ViewState, messages: ViewMessage[]): ViewState {
  const outer = owned;
  owned = new WeakSet();
  try {
    let folded = state;
    for (const message of messages) { folded = reduce(folded, message); }
    return folded;
  } finally { owned = outer; }
}

/** Fold one message into the state. */
export function reduce(state: ViewState, message: ViewMessage): ViewState {
  if (state.mismatch !== undefined) { return state; }
  switch (message.type) {
    case 'state': {
      if (message.contractVersion !== VIEW_CONTRACT_VERSION) { return { ...state, mismatch: message.contractVersion }; }
      // the state of the same session changes what is shown about it; another session, or none, begins a conversation afresh
      const same = (message.session?.sessionId ?? null) === (state.session?.sessionId ?? null);
      return { ...(same ? state : { ...initialViewState(), history: state.history, draft: state.draft }), contractVersion: message.contractVersion, session: message.session };
    }
    case 'snapshot':
      return message.state.contractVersion === VIEW_CONTRACT_VERSION ? message.state : { ...state, mismatch: message.state.contractVersion };
    case 'sessionUpdate':
      return reduceUpdate(state, message.update);
    case 'userPrompt': {
      const sent: PromptView = { text: message.text, files: message.files ?? [] };
      const ended = withTurnEnded(state);
      return { ...ended, attachments: [], queued: withoutQueuedHead(state.queued, sent), entries: appending(ended.entries, { kind: 'user', ...sent }) };
    }
    case 'promptQueued':
      return { ...state, attachments: [], queued: [...state.queued, { text: message.text, files: message.files ?? [] }] };
    case 'promptStart':
      return { ...withTurnEnded(state), processing: true };
    case 'promptEnd':
      return { ...withTurnEnded(state), processing: false };
    case 'error': {
      const ended = withTurnEnded(state);
      return { ...ended, entries: appending(ended.entries, { kind: 'error', message: message.message }) };
    }
    case 'modesUpdate':
      return withSession(state, s => ({ ...s, modes: message.modes }));
    case 'modelsUpdate':
      return withSession(state, s => ({ ...s, models: message.models }));
    case 'configOptionsUpdate':
      return withSession(state, s => ({ ...s, configOptions: message.configOptions }));
    case 'sessionInfoUpdate':
      return withSession(state, s => ({ ...s, title: message.title }));
    case 'loadSessionStart':
      return { ...state, entries: [], plan: null, loading: true, processing: false, queued: [], ...noAgents() };
    case 'loadSessionEnd':
      return { ...withTurnEnded(state), loading: false };
    case 'clearChat':
      return { ...state, entries: [], plan: null, processing: false, attachments: [], queued: [], ...noAgents() };
    case 'draft':
      return { ...state, draft: message.text };
    case 'sessionList': {
      const before = message.append && state.history ? state.history.sessions : [];
      return { ...state, history: { sessions: [...before, ...message.sessions], nextCursor: message.nextCursor } };
    }
    case 'permissionRequest':
      return { ...state, proposals: [...state.proposals, { requestId: message.requestId, title: message.title, diffs: message.diffs, options: message.options }] };
    case 'permissionResolved':
      return { ...state, proposals: state.proposals.filter(p => p.requestId !== message.requestId) };
    case 'hireTranscript':
      return { ...state, transcripts: { ...state.transcripts, [message.planId]: message.turns } };
    case 'file-attached':
      return { ...state, attachments: [...state.attachments, { path: message.path, name: message.name }] };
    case 'file-detached':
      return { ...state, attachments: state.attachments.filter(a => a.path !== message.path) };
  }
}

/** What the waiting line says. */
export interface WaitingLine {
  /** The title of the tool call that is under way, if one is; otherwise the line says only that the agent is thinking. */
  tool?: string;
}

/**
 * The line the chat shows while the agent is working and has not begun to write its answer: from the
 * send until answer text starts, which includes the time after a tool call has ended and the time after
 * a thought. Nothing while answer text is the latest part, and nothing between turns. While a tool
 * call is pending or running it names the tool.
 */
export function waitingLine(state: ViewState): WaitingLine | null {
  if (!state.processing) { return null; }
  const turn = openTurn(state);
  const parts = turn ? turn.parts : [];
  if (parts.length > 0 && parts[parts.length - 1].kind === 'text') { return null; }
  for (let i = parts.length - 1; i >= 0; i--) {
    const part = parts[i];
    if (part.kind === 'text') { break; }
    if (part.kind === 'tool' && (part.tool.status === 'pending' || part.tool.status === 'in_progress')) { return { tool: part.tool.title }; }
  }
  return {};
}
