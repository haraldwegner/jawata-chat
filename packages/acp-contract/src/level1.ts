import type { RecordedLine } from './recording.js';

/**
 * Level 1 of the contract: jawata's extensions. They sit only in ACP's own extension points (`_meta`
 * on an object, or a method whose name starts with `_`), so a plain client never needs them
 * (ARCHITECTURE-acp-host-contract.md, E1 to E6; the architecture's table is their one source).
 */

/** E1: the group of an advertised command, in `_meta["jawata/group"]`. */
export const META_GROUP = 'jawata/group';
export const COMMAND_GROUPS = ['seat', 'skill', 'utility'] as const;
export type CommandGroup = (typeof COMMAND_GROUPS)[number];

/** E3: a hire as a tool call, in `_meta["jawata/hire"]` of `tool_call` and `tool_call_update`. */
export const META_HIRE = 'jawata/hire';
export const HIRE_STATES = ['running', 'compacting', 'done', 'failed'] as const;
export type HireState = (typeof HIRE_STATES)[number];
export interface HireMeta {
  planId: string;
  seat: string;
  brain: string;
  /** Required: which model ran this hire is what the person reads the cost against, and what a later choice of model is learned from. */
  model: string;
  state: HireState;
  elapsedMs: number;
  tokens: number;
  /** What the agent reports the hire cost, in US dollars at API prices; absent when it reports none (a brain that sends no figure, not zero). */
  costUsd?: number;
  /** The command the person types for this seat, for example `/refactor` (S23: the name a person uses is shown with the seat's). */
  seatCommand: string;
  /** What the hire was asked to do, in words. */
  task: string;
  /** The hire that hired this one; absent for a root (a PM, one per sprint). The panel is a tree built from it (S23). */
  parentPlanId?: string;
  brainSessionId?: string;
  /** 28h item c: the engine's own plan id for this hire, which the hire's journal row is written under (`planId` above is the brain's tool call); absent until the hire has answered, so a recorded outcome can be joined to the journal. */
  enginePlan?: string;
  /** 28h S9: how many hires sit above this one (0 for a root), counted by the agent from the hires it saw. */
  level?: number;
  /** 28h S9: the tool calls the hire's brain has made so far; the agent's count while it runs, the hire's own once it has answered. */
  toolSteps?: number;
  /** 28h S9: the size of the hire's context in tokens while it runs, so a fall in it is visible; absent when the brain reports none and once the hire has ended. */
  contextTokens?: number;
  /** 28h S9 (R7): the person's answer to the hire's proposal, `accepted` or `rejected`; absent until the person has answered. */
  verdict?: string;
}

/** E4 and E5: client-to-agent requests about one hire. */
export const HIRE_METHODS = ['_jawata/hire/stop', '_jawata/hire/transcript', '_jawata/hire/brain'] as const;

/** The brains and models the agent offers (S23); asked with no params. PROVISIONAL until 28h names it. */
export const BRAIN_LIST_METHOD = '_jawata/brains';

/** D53: the brain of the principal is one option, category `model`; a seat's default is set in the studio and a running hire's on its row. */
export const PRINCIPAL_BRAIN_OPTION_ID = 'principal-brain';

/**
 * CR1 (provisional until 28h's D19 names the field): whether the session's autocontinue grant is armed is one select option, `autonomy`,
 * with the values `off` and `on`. A plain ACP config option, so a host that knows nothing of jawata shows it as it shows any selector.
 */
export const AUTONOMY_OPTION_ID = 'autonomy';
export const AUTONOMY_VALUES = ['off', 'on'] as const;

const HIRE_FIELDS: Record<keyof HireMeta, 'string' | 'number'> = {
  planId: 'string', seat: 'string', brain: 'string', model: 'string', state: 'string',
  elapsedMs: 'number', tokens: 'number', costUsd: 'number', seatCommand: 'string', task: 'string', parentPlanId: 'string', brainSessionId: 'string',
  level: 'number', toolSteps: 'number', contextTokens: 'number', verdict: 'string', enginePlan: 'string',
};
/** The fields a hire may leave out. */
const OPTIONAL_HIRE_FIELDS: readonly string[] = ['brainSessionId', 'parentPlanId', 'costUsd', 'level', 'toolSteps', 'contextTokens', 'verdict', 'enginePlan'];

/** E4's reply: the stop was taken. */
export interface HireStopReply { ok: boolean }
/** E5's reply: a hire's transcript, read-only. */
export interface HireTranscriptReply { planId: string; turns: { role: 'user' | 'assistant'; text: string }[] }
/**
 * PROVISIONAL (28i S9): the architecture names the two requests and their `planId` param, not the
 * replies. These shapes are this stage's assumption, for 28h to confirm or change.
 */

/** What is wrong with one hire's meta, or an empty list. */
export function hireViolations(meta: any): string[] {
  const out: string[] = [];
  for (const [field, type] of Object.entries(HIRE_FIELDS)) {
    const v = meta?.[field];
    if (v === undefined) {
      if (!OPTIONAL_HIRE_FIELDS.includes(field)) { out.push(`hire: ${field} is missing`); }
    } else if (typeof v !== type) {
      out.push(`hire: ${field} is not a ${type}`);
    }
  }
  for (const field of Object.keys(meta ?? {})) {
    if (!(field in HIRE_FIELDS)) { out.push(`hire: ${field} is not a field of the contract`); }
  }
  if (meta?.state !== undefined && !(HIRE_STATES as readonly string[]).includes(meta.state)) {
    out.push(`hire: state ${JSON.stringify(meta.state)} is not one of ${HIRE_STATES.join(', ')}`);
  }
  return out;
}

function replyViolations(method: string, result: any): string[] {
  if (method === '_jawata/hire/stop') {
    return typeof result?.ok === 'boolean' ? [] : ['stop reply: ok is not a boolean'];
  }
  // the brain request answers with the hire as it now is
  if (method === '_jawata/hire/brain') { return hireViolations(result).map(v => `brain reply: ${v}`); }
  if (method === BRAIN_LIST_METHOD) {
    const choices = Array.isArray(result?.brains) ? result.brains : null;
    if (!choices) { return ['brains reply: brains is not an array']; }
    return choices.flatMap((c: { brain?: unknown; model?: unknown }) => (typeof c?.brain === 'string' && typeof c?.model === 'string' ? [] : ['brains reply: a choice needs a brain and a model']));
  }
  const out: string[] = [];
  if (typeof result?.planId !== 'string') { out.push('transcript reply: planId is not a string'); }
  if (!Array.isArray(result?.turns)) { out.push('transcript reply: turns is not an array'); }
  for (const t of result?.turns ?? []) {
    if (t?.role !== 'user' && t?.role !== 'assistant') { out.push(`transcript reply: role ${JSON.stringify(t?.role)} is not user or assistant`); }
    if (typeof t?.text !== 'string') { out.push('transcript reply: a turn has no text'); }
  }
  return out;
}

/**
 * Check every Level-1 field in a session against the types above. Real recordings carry none and
 * pass. A derived session is refused by `deriveSession` when this returns anything. This checks
 * what is PRESENT; that a jawata agent sends the fields at all is the checker's `require` side (28h).
 */
export function checkLevel1(lines: RecordedLine[]): string[] {
  const out: string[] = [];
  const asked = new Map<unknown, string>();
  lines.forEach(({ dir, msg }, i) => {
    const at = `line ${i + 1}`;
    const u = msg.params?.update;
    const meta = u?._meta ?? {};
    for (const key of Object.keys(meta)) {
      if (key.startsWith('jawata/') && key !== META_HIRE) { out.push(`${at}: _meta key ${key} is not part of the contract`); }
    }
    const hire = meta[META_HIRE];
    if (hire !== undefined) {
      hireViolations(hire).forEach(v => out.push(`${at}: ${v}`));
      if (u.sessionUpdate === 'tool_call' && u.kind !== 'execute') {
        out.push(`${at}: a hire's tool call has kind ${JSON.stringify(u.kind)}, not "execute"`);
      }
    }
    for (const c of u?.availableCommands ?? []) {
      const g = c?._meta?.[META_GROUP];
      if (g !== undefined && !(COMMAND_GROUPS as readonly string[]).includes(g)) {
        out.push(`${at}: command ${c.name}: group ${JSON.stringify(g)} is not one of ${COMMAND_GROUPS.join(', ')}`);
      }
    }
    const options = msg.result?.configOptions ?? u?.configOptions ?? [];
    for (const o of options) {
      if (o?.id === PRINCIPAL_BRAIN_OPTION_ID) {
        if (o.category !== 'model') { out.push(`${at}: option ${o.id}: category is ${JSON.stringify(o.category)}, not "model"`); }
        if (o.type !== 'select') { out.push(`${at}: option ${o.id}: type is ${JSON.stringify(o.type)}, not "select"`); }
      }
      if (o?.id === AUTONOMY_OPTION_ID) {
        if (o.type !== 'select') { out.push(`${at}: option ${AUTONOMY_OPTION_ID}: type is ${JSON.stringify(o.type)}, not "select"`); }
        const values = (Array.isArray(o.options) ? o.options : []).map((c: { value?: unknown }) => c?.value);
        if (values.join(',') !== AUTONOMY_VALUES.join(',')) {
          out.push(`${at}: option ${AUTONOMY_OPTION_ID}: values are ${JSON.stringify(values)}, not ${JSON.stringify(AUTONOMY_VALUES)}`);
        }
        if (!(AUTONOMY_VALUES as readonly unknown[]).includes(o.currentValue)) {
          out.push(`${at}: option ${AUTONOMY_OPTION_ID}: currentValue ${JSON.stringify(o.currentValue)} is not one of ${AUTONOMY_VALUES.join(', ')}`);
        }
      }
    }
    if (typeof msg.method === 'string' && msg.method.startsWith('_jawata/')) {
      if (msg.method === BRAIN_LIST_METHOD) {
        if (dir === 'send') { asked.set(msg.id, msg.method); }
      } else if (!(HIRE_METHODS as readonly string[]).includes(msg.method)) {
        out.push(`${at}: method ${msg.method} is not a jawata extension method`);
      } else if (dir === 'send') {
        if (typeof msg.params?.planId !== 'string') { out.push(`${at}: ${msg.method} needs a planId`); }
        if (msg.method === '_jawata/hire/brain' && (typeof msg.params?.brain !== 'string' || typeof msg.params?.model !== 'string')) {
          out.push(`${at}: ${msg.method} needs a brain and a model`);
        }
        asked.set(msg.id, msg.method);
      }
    } else if (dir === 'recv' && msg.method === undefined && asked.has(msg.id) && msg.result !== undefined) {
      replyViolations(asked.get(msg.id)!, msg.result).forEach(v => out.push(`${at}: ${v}`));
    }
  });
  return out;
}
