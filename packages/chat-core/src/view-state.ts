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
  /** The plan of the hire this call started, when it is a hire call. */
  planId?: string;
}

/** One hired agent as the agents view shows it: what the agent sent in `_meta["jawata/hire"]`, kept by plan. */
export interface HireView {
  planId: string;
  seat: string;
  /** The name the engine gave this hire for its conversation; absent from an older engine's cards. */
  name?: string;
  /** The command the person types for this seat, for example `/refactor`; empty when the agent sent none. */
  seatCommand: string;
  /** What the hire was asked to do. */
  task: string;
  /** The hire that hired this one; absent for a root (a pm). */
  parentPlanId?: string;
  brain: string;
  model: string;
  /** `running`, `compacting`, `done` or `failed`. */
  state: string;
  elapsedMs: number;
  tokens: number;
  /** What the agent reported; absent when it reported none (never 0 for a missing figure). */
  costUsd?: number;
  brainSessionId?: string;
  /** How many files the run changed, as the engine counted them when the hire ended; absent when the agent sent no count (never 0 for a missing one). */
  changedFileCount?: number;
}

/** A brain and model the agent offers; the person picks one to replace an agent's. */
export interface BrainChoice {
  brain: string;
  model: string;
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
  return h ? hireFromEntry(h) : undefined;
}

/** A hire as the agent describes it (in `_meta` or as the answer to a brain change); undefined when it carries no plan id. */
export function hireFromEntry(h: Record<string, unknown>): HireView | undefined {
  if (typeof h.planId !== 'string') { return undefined; }
  const num = (x: unknown) => (typeof x === 'number' ? x : 0);
  const str = (x: unknown) => (typeof x === 'string' ? x : '');
  return {
    planId: h.planId, seat: str(h.seat), seatCommand: str(h.seatCommand), task: str(h.task), brain: str(h.brain), model: str(h.model),
    state: str(h.state) || 'running', elapsedMs: num(h.elapsedMs), tokens: num(h.tokens),
    ...(typeof h.name === 'string' && h.name !== '' ? { name: h.name } : {}),
    ...(typeof h.costUsd === 'number' ? { costUsd: h.costUsd } : {}),
    ...(typeof h.parentPlanId === 'string' ? { parentPlanId: h.parentPlanId } : {}),
    ...(typeof h.brainSessionId === 'string' ? { brainSessionId: h.brainSessionId } : {}),
    ...(typeof h.changedFileCount === 'number' ? { changedFileCount: h.changedFileCount } : {}),
  };
}

/** A hire in the tree the panel shows, with how deep it sits. */
export interface TreeRow {
  hire: HireView;
  depth: number;
}

/**
 * The hires that work, as the tree they were hired in: a hire shows when it works, when something under it does, or when it belongs to the
 * `team` given (the latest hiring turn's, which stays shown after it ends); a hire whose parent is not in the list is a root. Each hire
 * stands under its parent, in the order they first appeared.
 */
export function workingTree(hires: HireView[], team: ReadonlySet<string> = new Set()): TreeRow[] {
  const known = new Set(hires.map(h => h.planId));
  const children = new Map<string | undefined, HireView[]>();
  for (const h of hires) {
    const parent = h.parentPlanId && known.has(h.parentPlanId) && h.parentPlanId !== h.planId ? h.parentPlanId : undefined;
    children.set(parent, [...(children.get(parent) ?? []), h]);
  }
  const shows = (h: HireView, seen: Set<string>): boolean =>
    isWorking(h) || team.has(h.planId) || (!seen.has(h.planId) && (children.get(h.planId) ?? []).some(c => shows(c, new Set(seen).add(h.planId))));
  const rows: TreeRow[] = [];
  const walk = (parent: string | undefined, depth: number, seen: Set<string>) => {
    for (const h of children.get(parent) ?? []) {
      if (seen.has(h.planId) || !shows(h, seen)) { continue; }
      rows.push({ hire: h, depth });
      walk(h.planId, depth + 1, new Set(seen).add(h.planId));
    }
  };
  walk(undefined, 0, new Set());
  return rows;
}

/**
 * The latest team (Stage 27 (u), his ruling 2026-11-18): the hires the principal made in the latest turn that hired anyone, and every hire
 * under them. They stay shown after they end, so what each did (how it ended, how many files it changed) is visible; an earlier team is
 * counted, not listed. Empty when no turn of the conversation hired anyone.
 */
export function latestTeam(state: Pick<ViewState, 'entries' | 'hires'>): Set<string> {
  const team = new Set<string>();
  for (let i = state.entries.length - 1; i >= 0 && team.size === 0; i--) {
    const entry = state.entries[i];
    if (entry.kind !== 'turn') { continue; }
    for (const part of entry.turn.parts) {
      if (part.kind === 'tool' && part.tool.planId) { team.add(part.tool.planId); }
    }
  }
  let grown = true;
  while (grown) {
    grown = false;
    for (const h of state.hires) {
      if (h.parentPlanId && team.has(h.parentPlanId) && !team.has(h.planId)) { team.add(h.planId); grown = true; }
    }
  }
  return team;
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
  /** Which client the conversation was had in, as the agent names it in `_meta` (`jawata-agent`, `claude-code`, `cursor`); absent when it does not say. */
  client?: string | null;
  /** The name a person knows that client by, as the agent gives it in `_meta` ("Claude Code", "jawata"); the page shows it as the agent wrote it. */
  clientName?: string | null;
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
  /** The pictures sent with it, as data URLs; absent when none was (28h D57 (b)). */
  images?: string[];
}

/** What the conversation holds, in order. */
type EntryView =
  | ({ kind: 'user' } & PromptView)
  | { kind: 'turn'; turn: TurnView }
  | { kind: 'error'; message: string };

/** The side thread (CR3): a few short exchanges with the agent in a session of their own, apart from the conversation. */
interface SideView {
  entries: EntryView[];
  /** A side answer is on its way: the person cannot ask another until it ends. */
  processing: boolean;
}

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
  attachments: { path: string; name: string; image?: string }[];
  /** Prompts typed during a turn, to be sent when it ends, oldest first. */
  queued: PromptView[];
  /** The agents hired in this conversation, as the agent last said about each. Not part of the conversation. */
  hires: HireView[];
  /** The transcripts the person asked for, by plan. */
  transcripts: Record<string, TranscriptTurn[]>;
  /** The brains the agent offers, once the page asked; null until then. Not part of the conversation. */
  brains: BrainChoice[] | null;
  /** Proposals waiting for an answer, oldest first. */
  proposals: ProposalView[];
  /** What the agent last listed as its sessions; null until the page asked. It is the agent's list: the chat keeps none of its own. */
  history: HistoryView | null;
  /** What the person has typed and not sent: kept here so a page that reloads has it back. */
  draft: string;
  /** How many times the chat was cleared or a new conversation begun, which takes the draft: a page that sees this change empties its field. */
  draftResets: number;
  /** What the person typed in the chat and sent, newest first; it belongs to the person, so no clear, load or other conversation takes it. */
  inputHistory: string[];
  /** The side thread, if one is open; null when none is. It belongs to the conversation: a cleared, loaded or other conversation has none. */
  side: SideView | null;
}

/** What the agents added to the state, as it is when there is no conversation. */
const noAgents = () => ({ hires: [] as HireView[], transcripts: {} as Record<string, TranscriptTurn[]>, proposals: [] as ProposalView[] });

export function initialViewState(): ViewState {
  return { contractVersion: VIEW_CONTRACT_VERSION, session: null, entries: [], plan: null, processing: false, loading: false, attachments: [], queued: [], ...noAgents(), history: null, draft: '', draftResets: 0, inputHistory: [], side: null, brains: null };
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

/** A picture's data URL, from a content block that carries one; undefined for any other block (28h D57 (b)). */
function imageOf(content: unknown): string | undefined {
  const c = content as { type?: unknown; mimeType?: unknown; data?: unknown } | undefined;
  return c && c.type === 'image' && typeof c.mimeType === 'string' && typeof c.data === 'string' && c.data ? `data:${c.mimeType};base64,${c.data}` : undefined;
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
function withUpdatedTool(state: ViewState, update: ToolUpdate, planId?: string): ViewState {
  for (let i = state.entries.length - 1; i >= 0; i--) {
    const entry = state.entries[i];
    if (entry.kind !== 'turn') { continue; }
    // the call an update names is almost always one of the latest
    let at = entry.turn.parts.length - 1;
    while (at >= 0) { const p = entry.turn.parts[at]; if (p.kind === 'tool' && p.tool.toolCallId === update.toolCallId) { break; } at--; }
    if (at < 0) { continue; }
    const part = entry.turn.parts[at] as Extract<PartView, { kind: 'tool' }>;
    const merged = mergedTool(part.tool, update);
    const parts = replacingAt(entry.turn.parts, at, { kind: 'tool', tool: planId ? { ...merged, planId } : merged });
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
      const image = imageOf(update.content);
      const text = textOf(update.content);
      if (text === undefined && image === undefined) { return state; }
      const ended = withTurnEnded(state);
      const last = ended.entries[ended.entries.length - 1];
      if (image !== undefined) {
        // a picture the agent replays belongs to the message it came with (28h D57 (b)): Claude replays it as a block of its own
        return last && last.kind === 'user'
          ? { ...ended, entries: replacingLast(ended.entries, { ...last, images: [...(last.images ?? []), image] }) }
          : { ...ended, entries: appending(ended.entries, { kind: 'user', text: '', files: [], images: [image] }) };
      }
      if (text === undefined) { return state; }
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
        ...(hire ? { planId: hire.planId } : {}),
      };
      const withTool = withParts(state, parts => appending(parts, { kind: 'tool', tool }));
      return hire ? { ...withTool, hires: withHire(withTool.hires, hire) } : withTool;
    }
    case 'tool_call_update': {
      const hire = hireIn(update._meta);
      const noted = hire ? { ...state, hires: withHire(state.hires, hire) } : state;
      return withUpdatedTool(noted, update, hire?.planId);
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

/**
 * The state with `change` applied to the side thread's entries by the conversation's own rules (an answer's parts, a tool call, an
 * ended turn), and its running flag set when given. The side thread keeps no plan or hires: what the change puts there is dropped.
 */
function withSide(state: ViewState, change: (inner: ViewState) => ViewState, processing?: boolean): ViewState {
  const side = state.side ?? { entries: [], processing: false };
  const inner = change({ ...state, entries: side.entries });
  return { ...state, side: { entries: inner.entries, processing: processing ?? side.processing } };
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
      return { ...(same ? state : { ...initialViewState(), history: state.history, draft: state.draft, draftResets: state.draftResets, inputHistory: state.inputHistory }), contractVersion: message.contractVersion, session: message.session };
    }
    case 'snapshot':
      return message.state.contractVersion === VIEW_CONTRACT_VERSION ? message.state : { ...state, mismatch: message.state.contractVersion };
    case 'sessionUpdate':
      return reduceUpdate(state, message.update);
    case 'userPrompt': {
      const sent: PromptView = { text: message.text, files: message.files ?? [] };
      const ended = withTurnEnded(state);
      const images = message.images && message.images.length > 0 ? { images: message.images } : {};
      return { ...ended, attachments: [], queued: withoutQueuedHead(state.queued, sent), entries: appending(ended.entries, { kind: 'user', ...sent, ...images }) };
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
      return { ...state, entries: [], plan: null, loading: true, processing: false, queued: [], side: null, ...noAgents() };
    case 'loadSessionEnd':
      return { ...withTurnEnded(state), loading: false };
    case 'clearChat':
      return { ...state, entries: [], plan: null, processing: false, attachments: [], queued: [], side: null, ...noAgents(), draft: '', draftResets: state.draftResets + 1 };
    case 'draft':
      return { ...state, draft: message.text };
    case 'inputHistory':
      return { ...state, inputHistory: message.entries };
    case 'sessionList': {
      const before = message.append && state.history ? state.history.sessions : [];
      return { ...state, history: { sessions: [...before, ...message.sessions], nextCursor: message.nextCursor } };
    }
    case 'permissionRequest':
      return { ...state, proposals: [...state.proposals, { requestId: message.requestId, title: message.title, diffs: message.diffs, options: message.options }] };
    case 'permissionResolved':
      return { ...state, proposals: state.proposals.filter(p => p.requestId !== message.requestId) };
    case 'brainList':
      return { ...state, brains: message.brains };
    case 'hireChanged':
      return { ...state, hires: withHire(state.hires, message.hire) };
    case 'hireTranscript':
      return { ...state, transcripts: { ...state.transcripts, [message.planId]: message.turns } };
    case 'sideAsked':
      return withSide(state, inner => {
        const ended = withTurnEnded(inner);
        return { ...ended, entries: appending(ended.entries, { kind: 'user', text: message.text, files: [] }) };
      }, true);
    case 'sideUpdate':
      return state.side ? withSide(state, inner => reduceUpdate(inner, message.update)) : state;
    case 'sideEnd':
      return state.side ? withSide(state, withTurnEnded, false) : state;
    case 'sideError':
      return state.side ? withSide(state, inner => {
        const ended = withTurnEnded(inner);
        return { ...ended, entries: appending(ended.entries, { kind: 'error', message: message.message }) };
      }, false) : state;
    case 'sideClosed':
      return { ...state, side: null };
    case 'file-attached':
      return { ...state, attachments: [...state.attachments, { path: message.path, name: message.name, ...(message.image ? { image: message.image } : {}) }] };
    case 'file-detached':
      return { ...state, attachments: state.attachments.filter(a => a.path !== message.path) };
  }
}

/** What goes on now, as the working line says it beside its dots and seconds. */
export interface Activity {
  kind: 'thinking' | 'tool' | 'delegating' | 'waiting';
  /** The words on the line: "Thinking", the tool's title, "Delegating to Rafael · pm", "Waiting on Rafael · pm". */
  label: string;
  /** What opening the line shows: the thought so far, what went into the tool, the prompt the hire was sent. Absent when there is no more. */
  detail?: string;
}

/** A hire as the line names it: its name and its seat, or its seat alone. */
const hireName = (hire: HireView): string => (hire.name ? `${hire.name} · ${hire.seat}` : hire.seat);

/**
 * What the agent does now, from the send until answer text starts: the tool in use (a hire call says whom it delegates to and the prompt
 * it sent), else the hire it waits on while one works, else that it thinks. Nothing while answer text is the latest part, and nothing
 * between turns: the answer replaces the line.
 */
export function activityLine(state: ViewState): Activity | null {
  if (!state.processing) { return null; }
  const parts = openTurn(state)?.parts ?? [];
  const last = parts[parts.length - 1];
  if (last && last.kind === 'text') { return null; }
  for (let i = parts.length - 1; i >= 0; i--) {
    const part = parts[i];
    if (part.kind === 'text') { break; }
    if (part.kind !== 'tool' || (part.tool.status !== 'pending' && part.tool.status !== 'in_progress')) { continue; }
    const hire = part.tool.planId ? state.hires.find(h => h.planId === part.tool.planId) : undefined;
    if (hire) { return { kind: 'delegating', label: `Delegating to ${hireName(hire)}`, ...(hire.task ? { detail: hire.task } : {}) }; }
    const input = part.tool.input === undefined ? '' : typeof part.tool.input === 'string' ? part.tool.input : JSON.stringify(part.tool.input, null, 2);
    return { kind: 'tool', label: part.tool.title, ...(input && input !== '{}' ? { detail: input } : {}) };
  }
  const working = state.hires.filter(isWorking);
  if (working.length > 0) {
    const latest = working[working.length - 1];
    const others = working.length > 1 ? ` and ${working.length - 1} more` : '';
    return { kind: 'waiting', label: `Waiting on ${hireName(latest)}${others}`, ...(latest.task ? { detail: latest.task } : {}) };
  }
  return { kind: 'thinking', label: 'Thinking', ...(last && last.kind === 'thought' && last.text.trim() ? { detail: last.text } : {}) };
}
