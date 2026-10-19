import { readFileSync } from 'node:fs';

/** Who sent a message: `send` is client to agent, `recv` is agent to client. */
export type Direction = 'send' | 'recv';

/**
 * One line of a recorded session, the format the chat's traffic tap writes and the replay
 * agent and the checker read: one ACP message and its direction per JSON line.
 */
export interface RecordedLine {
  dir: Direction;
  msg: { jsonrpc: '2.0'; id?: number | string; method?: string; params?: any; result?: any; error?: any };
}

/** One recorded line as it is written: the one place the on-disk format is produced. */
export function formatLine(dir: Direction, msg: RecordedLine['msg']): string {
  return JSON.stringify({ dir, msg } satisfies RecordedLine);
}

/** Parse a recorded session. Refuses a malformed line, naming its line number. */
export function parseSession(text: string): RecordedLine[] {
  return text.split('\n').flatMap((raw, i) => {
    if (!raw.trim()) { return []; }
    let line: any;
    try {
      line = JSON.parse(raw);
    } catch (e) {
      throw new Error(`line ${i + 1}: not JSON (${(e as Error).message})`);
    }
    if (line?.dir !== 'send' && line?.dir !== 'recv') { throw new Error(`line ${i + 1}: dir is neither send nor recv`); }
    if (line.msg?.jsonrpc !== '2.0') { throw new Error(`line ${i + 1}: msg is not a JSON-RPC 2.0 message`); }
    return [line as RecordedLine];
  });
}

export function readSession(path: string): RecordedLine[] {
  return parseSession(readFileSync(path, 'utf8'));
}

/**
 * The shape of a session, one string per line: direction, method (or response / error), and the
 * fields the contract names — a tool call's kind, status and whether it has a title; the option
 * kinds of a permission request; the jawata groups of advertised commands; and the key
 * set of every request's params and every response's result. Prose (answer text, prompt text,
 * ids, paths) is not part of the shape. The replay test and 28h's checker compare sessions by it.
 */
export function shapeOf(lines: RecordedLine[]): string[] {
  const keys = (o: unknown) => (o && typeof o === 'object' ? Object.keys(o).sort().join(',') : '');
  return lines.map(({ dir, msg }) => {
    const parts: string[] = [dir, msg.method ?? (msg.error ? 'error' : 'response')];
    const u = msg.params?.update;
    if (u?.sessionUpdate) {
      parts.push(u.sessionUpdate);
      if (u.sessionUpdate === 'tool_call' || u.sessionUpdate === 'tool_call_update') {
        parts.push(`kind=${u.kind ?? ''}`, `status=${u.status ?? ''}`, `title=${u.title ? 'yes' : 'no'}`);
      }
      if (u.sessionUpdate === 'available_commands_update') {
        // the set of jawata groups the list carries; the names depend on the machine and are not part of the shape
        parts.push(`groups=${[...new Set((u.availableCommands ?? []).map((c: any) => c._meta?.['jawata/group']).filter(Boolean))].sort().join(',')}`);
      }
    } else if (msg.method === 'session/request_permission') {
      parts.push(`options=${(msg.params?.options ?? []).map((o: any) => o.kind).join(',')}`);
    } else if (msg.method !== undefined) {
      parts.push(`params=${keys(msg.params)}`);
    } else if (msg.result !== undefined) {
      parts.push(`result=${keys(msg.result)}`);
    }
    return parts.join(' ');
  });
}

/** The unprompted notices a live agent sends at varying places in a turn: the command list and the usage figures. */
const isUnpromptedNotice = (shape: string): boolean =>
  shape.startsWith('recv session/update available_commands_update') || shape.startsWith('recv session/update usage_update');

/** A notice is kept by its kind and, for a command list, by the jawata groups it carries. */
const noticeKey = (shape: string): string => (shape.split(' ').slice(0, 3).join(' ') + ' ' + (/groups=\S*/.exec(shape)?.[0] ?? '')).trim();

export interface ShapeComparison {
  same: boolean;
  /** The zero-based position, among the ordinary messages, of the first difference. */
  at?: number;
  got?: string;
  expected?: string;
}

/**
 * Compare two shapes the way two runs of one turn are compared (finding F12). Ordinary messages
 * must match in order. The unprompted notices (the command list, the usage figures) are compared as
 * a set, by how many of each kind arrived (and, for a command list, which jawata groups it carries),
 * not by position, and not by their other content: the names a command list holds depend on the
 * machine.
 */
export function compareShapes(actual: string[], expected: string[]): ShapeComparison {
  const split = (shapes: string[]) => ({
    ordinary: shapes.filter(s => !isUnpromptedNotice(s)),
    notices: shapes.filter(isUnpromptedNotice).map(noticeKey).sort(),
  });
  const a = split(actual);
  const b = split(expected);
  const at = a.ordinary.findIndex((s, i) => s !== b.ordinary[i]);
  if (at !== -1 || a.ordinary.length !== b.ordinary.length) {
    const i = at === -1 ? Math.min(a.ordinary.length, b.ordinary.length) : at;
    return { same: false, at: i, got: a.ordinary[i] ?? '(end)', expected: b.ordinary[i] ?? '(end)' };
  }
  if (a.notices.join('\n') !== b.notices.join('\n')) {
    return { same: false, got: `${a.notices.length} unprompted notices`, expected: `${b.notices.length} unprompted notices` };
  }
  return { same: true };
}
