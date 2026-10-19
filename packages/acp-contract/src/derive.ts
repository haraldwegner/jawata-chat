import { checkLevel1, COMMAND_GROUPS, META_GROUP, SEAT_MODEL_PREFIX, type CommandGroup } from './level1.js';
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
  | { op: 'seatModels'; seats: string[]; select: string };

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
    }
  }
  const out = lines.flatMap((l, i) => [l, ...(inserts.get(i) ?? [])]);
  const violations = checkLevel1(out);
  if (violations.length > 0) { throw new Error(`derive: the result breaks Level 1: ${violations.join('; ')}`); }
  return out;
}
