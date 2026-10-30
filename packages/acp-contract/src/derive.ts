import { AUTONOMY_OPTION_ID, AUTONOMY_VALUES, checkLevel1, COMMAND_GROUPS, META_GROUP, SEAT_MODEL_PREFIX, type CommandGroup } from './level1.js';
import type { RecordedLine } from './recording.js';

/**
 * One declarative change to a promoted recording. `at` is a line index of the BASE file, so ops do not
 * disturb each other's positions.
 */
export type Op =
  /** Merge `value` into the object at `path` of line `at` (objects merge, anything else is replaced). */
  | { op: 'set'; at: number; path: (string | number)[]; value: unknown }
  /** Add `lines` after base line `at`. */
  | { op: 'insertAfter'; at: number; lines: RecordedLine[] }
  /** Tag every advertised command with its group: the names listed, else `default` (E1). */
  | { op: 'commandGroups'; seat: string[]; utility: string[]; default: CommandGroup }
  /** Replace the model option with one `seat-model:<seat>` option per seat, and point a recorded change at `select` (E6). */
  | { op: 'seatModels'; seats: string[]; select: string }
  /** Add the `autonomy` option (off at first), and make the recorded model change the person setting it to `select`; the answer shows the new value (CR1). */
  | { op: 'autonomy'; select: 'on' | 'off'; /** Add a second exchange after the answer: the person sets it back to off. */ ends?: boolean }
  /** After the last line, open a second session with the same agent and ask it `question`; it answers `answer` (the side thread, CR3). */
  | { op: 'side'; question: string; answer: string };

export interface Overlay {
  /** The promoted recording this derives from, relative to the sessions folder. */
  base: string;
  ops: Op[];
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));
const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

function merge(target: any, value: unknown): unknown {
  if (!isObject(target) || !isObject(value)) { return clone(value); }
  for (const [k, v] of Object.entries(value)) { target[k] = k in target ? merge(target[k], v) : clone(v); }
  return target;
}

function setAt(line: RecordedLine, path: (string | number)[], value: unknown): void {
  let node: any = line;
  for (const key of path.slice(0, -1)) { node = node[key] ??= {}; }
  const last = path[path.length - 1]!;
  node[last] = last in node ? merge(node[last], value) : clone(value);
}

/** The id of the second session a `side` op opens; fixed so that the derived file is the same each time. */
const SIDE_SESSION_ID = 'side-session-0001';

function autonomyOption(current: string): unknown {
  return {
    id: AUTONOMY_OPTION_ID, name: 'Autocontinue', type: 'select', currentValue: current,
    description: 'Whether the agent goes on from one checkpoint to the next by itself.',
    options: [{ value: 'off', name: 'Off' }, { value: 'on', name: 'On' }],
  };
}

function mapOptions(line: RecordedLine, f: (options: any[]) => any[]): void {
  const m = line.msg;
  if (Array.isArray(m.result?.configOptions)) { m.result.configOptions = f(m.result.configOptions); }
  if (Array.isArray(m.params?.update?.configOptions)) { m.params.update.configOptions = f(m.params.update.configOptions); }
}

/**
 * Derive a session: apply the overlay's ops to a copy of the base and check the result against the
 * Level-1 types. A derivation that breaks one is refused, naming it. Deterministic: the same base and
 * overlay always give the same lines.
 */
export function deriveSession(base: RecordedLine[], ops: Op[]): RecordedLine[] {
  const lines = clone(base);
  const inserts = new Map<number, RecordedLine[]>();
  for (const op of ops) {
    if (op.op === 'set') {
      const line = lines[op.at];
      if (!line) { throw new Error(`derive: set at ${op.at}: the base has ${lines.length} lines`); }
      setAt(line, op.path, op.value);
    } else if (op.op === 'insertAfter') {
      if (op.at >= lines.length) { throw new Error(`derive: insertAfter ${op.at}: the base has ${lines.length} lines`); }
      inserts.set(op.at, [...(inserts.get(op.at) ?? []), ...clone(op.lines)]);
    } else if (op.op === 'commandGroups') {
      for (const l of lines) {
        for (const c of l.msg.params?.update?.availableCommands ?? []) {
          const group = op.seat.includes(c.name) ? 'seat' : op.utility.includes(c.name) ? 'utility' : op.default;
          c._meta = { ...(c._meta ?? {}), [META_GROUP]: group };
        }
      }
      if (!(COMMAND_GROUPS as readonly string[]).includes(op.default)) { throw new Error(`derive: default group ${op.default}`); }
    } else if (op.op === 'seatModels') {
      if (!op.seats.includes(op.select)) { throw new Error(`derive: seatModels: ${op.select} is not among the seats`); }
      for (const l of lines) {
        mapOptions(l, (options) => options.flatMap((o) => (o.id === 'model'
          ? op.seats.map((s) => ({ ...clone(o), id: `${SEAT_MODEL_PREFIX}${s}`, name: `${s} model` }))
          : [o])));
        if (l.dir === 'send' && l.msg.method === 'session/set_config_option' && l.msg.params?.configId === 'model') {
          l.msg.params.configId = `${SEAT_MODEL_PREFIX}${op.select}`;
        }
      }
    } else if (op.op === 'autonomy') {
      let value: string = AUTONOMY_VALUES[0];
      let asked: RecordedLine | undefined;
      for (const l of lines) {
        mapOptions(l, (options) => (options.some((o) => o.id === AUTONOMY_OPTION_ID) ? options : [...options, autonomyOption(value)]));
        if (l.dir === 'send' && l.msg.method === 'session/set_config_option' && l.msg.params?.configId === 'model') {
          l.msg.params.configId = AUTONOMY_OPTION_ID;
          l.msg.params.value = op.select;
          value = op.select;
          asked = l;
        }
      }
      if (op.ends && asked) {
        const answerAt = lines.findIndex((l) => l.dir === 'recv' && l.msg.id === asked!.msg.id && Array.isArray(l.msg.result?.configOptions));
        if (answerAt < 0) { throw new Error('derive: autonomy: the change has no answer carrying the options'); }
        const again = clone(asked);
        again.msg.id = 90;
        again.msg.params.value = 'off';
        const answer = clone(lines[answerAt]!);
        answer.msg.id = 90;
        answer.msg.result.configOptions.find((o: { id: string }) => o.id === AUTONOMY_OPTION_ID).currentValue = 'off';
        inserts.set(answerAt, [...(inserts.get(answerAt) ?? []), again, answer]);
      }
    }
  }
  const out = lines.flatMap((l, i) => [l, ...(inserts.get(i) ?? [])]);
  for (const op of ops) {
    if (op.op !== 'side') { continue; }
    const newId = Math.max(...out.map((l) => (typeof l.msg.id === 'number' ? l.msg.id : 0))) + 1;
    const cwd = out.find((l) => l.dir === 'send' && l.msg.method === 'session/new')?.msg.params?.cwd;
    if (cwd === undefined) { throw new Error('derive: side: the base opens no session to open a second one beside'); }
    const sessionId = SIDE_SESSION_ID;
    out.push(
      { dir: 'send', msg: { jsonrpc: '2.0', id: newId, method: 'session/new', params: { cwd, mcpServers: [], _meta: { 'jawata/side': true } } } },
      { dir: 'recv', msg: { jsonrpc: '2.0', id: newId, result: { sessionId } } },
      { dir: 'send', msg: { jsonrpc: '2.0', id: newId + 1, method: 'session/prompt', params: { sessionId, prompt: [{ type: 'text', text: op.question }] } } },
      { dir: 'recv', msg: { jsonrpc: '2.0', method: 'session/update', params: { sessionId, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: op.answer } } } } },
      { dir: 'recv', msg: { jsonrpc: '2.0', id: newId + 1, result: { stopReason: 'end_turn' } } },
    );
  }
  const violations = checkLevel1(out);
  if (violations.length > 0) { throw new Error(`derive: the result breaks Level 1: ${violations.join('; ')}`); }
  return out;
}
