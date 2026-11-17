/**
 * What the Seats screen shows, worked out from what the host answered (Sprint 28k, Amendment 3, Stage 25j): the groups, each seat's row and the
 * choices of its brain, as functions of the data alone. The rules are the studio's Seats view as 28h released it, less what the ux report takes
 * out (the title, the counts and the clients), with the mouseovers the report rewrites.
 */

/** One seat as the host shows it, with the changes held for Apply laid over what is stored. */
export interface SeatRow {
  readonly name: string;
  /** The word typed for it, without the slash; absent for a seat with no command. */
  readonly command: string | null;
  readonly purpose: string;
  /** When the seat is meant to be used, in the seat's own words. */
  readonly when: string;
  readonly on: boolean;
  readonly brain: string;
  readonly model: string | null;
  /** Whether the person changed this seat, held or applied: what Reset takes back. */
  readonly customised: boolean;
  /** Whether the seat's file accepts a brain whose writes only an instruction holds; a hire of any other seat refuses such a brain. */
  readonly acceptsUncontainedWrites: boolean;
}

/** What the host answers for the seats. */
export interface SeatsState {
  readonly seats: readonly SeatRow[];
  readonly errors: readonly string[];
  /** The rules the stored workflow broke; the engine uses its default tree in their place. */
  readonly refusals: readonly string[];
}

/** One agent program as this machine has it. */
export interface BrainStatus {
  readonly id: string;
  readonly label: string;
  readonly installed: boolean;
  readonly login: 'loggedIn' | 'notLoggedIn' | 'unknown';
  readonly reason: string | null;
  readonly loginCommand: string;
  readonly models: readonly string[] | null;
  readonly hirable: boolean;
  readonly takesModel: boolean;
  readonly writesHeldByInstruction: boolean;
}

/** A brain the chat can run on (Stage 25m): one the engine's brain registry names, ready, or one whose adapter is not on this machine. */
export interface ConversationBrain {
  readonly id: string;
  readonly label: string;
  readonly ready: boolean;
  /** The command that installs its adapter; null for a ready brain. */
  readonly install: string | null;
}

/** What one test run through a brain showed. */
export interface ProbeResult {
  readonly brain: string;
  readonly ok: boolean;
  readonly answer: string | null;
  readonly modelsUsed: readonly string[];
  readonly costUsd: number | null;
  readonly seconds: number;
  readonly error: string | null;
  readonly loginCommand: string;
}

/** One group of the screen, by how a person reaches its seats. */
export interface SeatGroup {
  readonly title: string;
  readonly hint: string;
  readonly seats: readonly SeatRow[];
}

/** One entry of a brain list: the value is `brain|model`, an empty model being the brain's own default. */
export interface BrainOption {
  readonly value: string;
  readonly label: string;
}

/** The two seats a person talks to directly. */
const CONVERSATION = ['main', 'btw'];
/** The two steps of /sprint, as the studio names them; they have no command of their own. */
const SPRINT_STEPS = ['spec-editor', 'spec-auditor'];

export const isConversation = (seat: SeatRow): boolean => CONVERSATION.includes(seat.name);

/** The four groups that have seats in them, in the order a person looks for one. */
export function seatGroups(state: SeatsState): SeatGroup[] {
  const sorted = [...state.seats].sort((a, b) => a.name.localeCompare(b.name));
  return [
    {
      title: 'Who you talk to',
      hint: 'The principal is the agent you talk to in the jawata chat. btw is the side discussion. The brain chosen here is what the next conversation runs on; '
        + 'you can change the principal\'s during a conversation on its row in Agent Control.',
      seats: sorted.filter(isConversation),
    },
    {
      title: 'You type these',
      hint: 'Each has a command you type in the chat. The On switch offers that command in the chat\'s / list or takes it away.',
      seats: sorted.filter(seat => seat.command !== null && !isConversation(seat)),
    },
    {
      title: 'Another seat hires these',
      hint: 'They have no command. A seat hires one for a job, gives it a brief and checks what comes back. You choose only which brain they use.',
      seats: sorted.filter(seat => seat.command === null && !SPRINT_STEPS.includes(seat.name) && !isConversation(seat)),
    },
    {
      title: 'Inside /sprint',
      hint: 'The two steps of /sprint. They have no command of their own.',
      seats: sorted.filter(seat => seat.command === null && SPRINT_STEPS.includes(seat.name)),
    },
  ].filter(group => group.seats.length > 0);
}

/** The seat's name with how it is called, the name a person uses being mandatory: `architect (/refactor)`. */
export const seatName = (seat: SeatRow): string => seat.command ? `${seat.name} (/${seat.command})` : seat.name;

/** How a person reaches the seat, said in the mouseover of its name. */
export function invocationHint(seat: SeatRow): string {
  if (seat.command) { return `Type /${seat.command} in the chat to run this seat.`; }
  if (isConversation(seat)) { return seat.when ? `Nobody hires it: it starts ${seat.when}.` : 'Nobody hires it: it starts on its own.'; }
  return SPRINT_STEPS.includes(seat.name)
    ? 'Runs as one of the two steps of /sprint. It has no command of its own.'
    : 'Has no command. Another seat hires it for a job, gives it a brief, and checks what it returns.';
}

/** The switch's mouseover, in the ux report's words. */
export const onHint = (seat: SeatRow): string =>
  `Ticked: /${seat.command} is offered in the chat's / list and the seat can be hired. Unticked: it is not offered and a hire of it is refused. `
  + 'The seat itself is kept. Takes effect on Apply.';

export const WHEN_HINT = 'When this seat is meant to be used: the point in your work at which an agent is sent to it.';
export const BRAIN_HINT = 'Typed as a command, a seat runs on your own agent; this is the brain a HIRE of it starts: the agent program, and the model, '
  + 'logged in with your account on this machine. The list is read from the programs installed here. '
  + 'Choosing one first runs a one-word test through it (Claude Code: under a cent, measured) and is kept for Apply only if it answers.';
export const CONVERSATION_BRAIN_HINT = 'The brain and model a new conversation with this seat starts on. The models listed are the ones that brain\'s own '
  + 'session offers; the chat can change the model of a running conversation. '
  + 'Choosing one first runs a one-word test through it (Claude Code: under a cent, measured) and is kept for Apply only if it answers.';
/** The mouseover of a missing adapter's notice, in the studio's words (28h ec8d474), with jawata for the studio and page for tab, as no host is named here. */
export const ADAPTER_HINT = 'The chat talks to a brain through its agent adapter. jawata downloads no agent program: you run the command, then open this page again.';
export const RESET_HINT = 'Takes back your changes to this seat and uses the version shipped with the plug-in. Takes effect on Apply.';

/** The first sentence of a seat's purpose, shown on its row; the whole of it sits in the fold. */
export function firstSentence(text: string): string {
  const end = text.search(/[.!?](\s|$)/);
  return end < 0 ? text : text.slice(0, end + 1);
}

function loginNote(brain: BrainStatus): string {
  if (brain.login === 'notLoggedIn') { return ' (not logged in)'; }
  if (brain.login === 'unknown') { return ' (login not checkable)'; }
  return '';
}

/**
 * The brains a seat can be given: each one installed here that a hire of THIS seat can start, with its default model and the models it names
 * for itself. A brain whose writes only an instruction holds is offered only to a seat whose file accepts that, because a hire of any other
 * seat refuses it. The saved choice is always offered, even when this machine cannot start it now, so the list never says something else is
 * chosen. A brain the chat can also run on takes its models from the engine's one catalogue, what that brain's own session offers (28h D57
 * (c)), so every seat is offered the list main is; only a brain with no session of its own falls back to the models its check read.
 */
export function brainOptions(seat: SeatRow, brains: readonly BrainStatus[], conversation: readonly ConversationBrain[] = [],
  catalogue: Readonly<Record<string, readonly string[]>> = {}): BrainOption[] {
  const options: BrainOption[] = [];
  for (const brain of brains.filter(one => one.hirable && one.installed && (!one.writesHeldByInstruction || seat.acceptsUncontainedWrites))) {
    const note = loginNote(brain) + (brain.writesHeldByInstruction ? ' (writes held only by an instruction)' : '');
    options.push({ value: `${brain.id}|`, label: `${brain.label} — ${brain.takesModel ? 'its default model' : 'chooses its own model'}${note}` });
    if (brain.takesModel && !isConversation(seat)) {
      const ownSession = conversation.some(one => one.ready && one.id === brain.id);
      for (const model of (ownSession ? catalogue[brain.id] : brain.models) ?? []) {
        options.push({ value: `${brain.id}|${model}`, label: `${brain.label} — ${model}${note}` });
      }
    }
  }
  const current = `${seat.brain}|${seat.model ?? ''}`;
  if (!options.some(option => option.value === current)) {
    const known = brains.find(one => one.id === seat.brain);
    options.unshift({ value: current, label: `${known?.label ?? seat.brain} — ${seat.model ?? 'its default model'} (not available on this machine)` });
  }
  return options;
}

/**
 * The brains main and btw can be given (28h D56 (f)): each brain the chat can run on here with its own default model first, then each model
 * that brain's own session offers, once they have been asked. The saved choice is always offered; it is marked not available when its brain
 * is not ready here, or when that brain's models were read and do not include it.
 */
export function conversationOptions(seat: SeatRow, conversation: readonly ConversationBrain[], brains: readonly BrainStatus[],
  models: Readonly<Record<string, readonly string[]>>): BrainOption[] {
  const options: BrainOption[] = [];
  for (const one of conversation.filter(brain => brain.ready)) {
    const status = brains.find(brain => brain.id === one.id);
    const label = status?.label ?? one.label;
    const note = status ? loginNote(status) : '';
    options.push({ value: `${one.id}|`, label: `${label} — its default model${note}` });
    for (const model of models[one.id] ?? []) { options.push({ value: `${one.id}|${model}`, label: `${label} — ${model}${note}` }); }
  }
  const current = `${seat.brain}|${seat.model ?? ''}`;
  if (!options.some(option => option.value === current)) {
    const ready = conversation.some(brain => brain.ready && brain.id === seat.brain);
    const label = brains.find(one => one.id === seat.brain)?.label ?? conversation.find(one => one.id === seat.brain)?.label ?? seat.brain;
    const absent = !ready || models[seat.brain] !== undefined;
    options.unshift({ value: current, label: `${label} — ${seat.model ?? 'its default model'}${absent ? ' (not available on this machine)' : ''}` });
  }
  return options;
}

/**
 * What the Seats page says about a brain the chat could run on if its adapter were installed (28h D54 (g)), in the three parts the page draws:
 * the sentence before the command, the command (shown as code, so a person can copy it), and the sentence after. Null for a ready brain.
 */
export function adapterNotice(brain: ConversationBrain): { before: string; command: string; after: string } | null {
  if (brain.ready || !brain.install) { return null; }
  return { before: `${brain.label} is not available for the chat. To use it, run`, command: brain.install, after: 'in a terminal, then open this page again.' };
}

/** What the last test run through a brain showed, in a sentence. */
export function probeSentence(probe: ProbeResult, label: string): string {
  if (!probe.ok) { return `${label} did not answer: ${probe.error ?? 'no reason given'}`; }
  const model = probe.modelsUsed.length > 0 ? ` · ${probe.modelsUsed[0]}` : '';
  const cost = probe.costUsd !== null ? ` · $${probe.costUsd.toFixed(3)}` : '';
  return `Tested: answered “${probe.answer ?? ''}” in ${probe.seconds.toFixed(1)} s${model}${cost}`;
}
