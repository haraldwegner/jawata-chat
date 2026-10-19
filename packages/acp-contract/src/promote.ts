import { formatLine, type RecordedLine } from './recording.js';

/** What a working directory becomes in a promoted recording. */
export const WORKSPACE_PLACEHOLDER = '/workspace';

export interface PromoteOptions {
  /** Cut every `session/list` answer to this one session: no one else's titles or paths are promoted. */
  keepSession?: string;
  /** Values that must not survive: the machine's own names (user, home, host, git email), supplied by the caller. */
  forbidden?: string[];
}

const SECRET_SHAPES = /sk-[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|Bearer [A-Za-z0-9._-]{20,}/;
const LOCAL_PATHS = /\/home\/[^/"\\\s]+|\/var\/home\/[^/"\\\s]+|\/Users\/[^/"\\\s]+|\/root\b|\/tmp\/[^\s"\\]*|-(?:home|Users)-[A-Za-z0-9_]+|[A-Za-z]:\\\\users\\\\[^"\\]+/i;
/** The adapter's per-user temp folder, whose name carries the user id. */
const TEMP_ROOT = /\/tmp\/claude-\d+/g;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

/** The text an answer streams in, one string per unbroken run of chunks, so a path split across chunks is seen whole. */
function chunkRuns(lines: RecordedLine[]): string[] {
  const runs: string[] = [];
  let run = '';
  for (const l of lines) {
    const u = l.msg.params?.update;
    if (l.dir === 'recv' && /_message_chunk$|_thought_chunk$/.test(u?.sessionUpdate ?? '') && typeof u.content?.text === 'string') {
      run += u.content.text;
    } else if (run) { runs.push(run); run = ''; }
  }
  if (run) { runs.push(run); }
  return runs;
}

/**
 * Turn a raw recording into a contract recording. The redactions: the adapter's `_auth/*` notices are
 * dropped (they carry the account's email); the session's working directory, wherever it appears,
 * becomes WORKSPACE_PLACEHOLDER, and the folder name the adapter derives from it becomes
 * `-workspace` (they carry the local user and project path); the adapter's per-user temp folder
 * becomes `/claude-tmp`; and a session list is cut to one
 * session when asked. Then the result is REFUSED if anything local is left: a home-directory or temp
 * path, the account email of a dropped notice, any value the caller names as local, or a
 * secret-shaped string, in the messages or in text streamed across chunks. Every other message is
 * kept unchanged and in order.
 */
export function promoteRecording(raw: RecordedLine[], options: PromoteOptions = {}): RecordedLine[] {
  const opening = raw.find(l => l.dir === 'send' && (l.msg.method === 'session/new' || l.msg.method === 'session/load'));
  const cwd = opening?.msg.params?.cwd as string | undefined;
  if (cwd !== undefined && cwd.length < 3) {
    throw new Error(`promote: refusing to redact a working directory as short as ${JSON.stringify(cwd)}`);
  }
  // the directory as it appears inside JSON text (a Windows path's backslashes are escaped there)
  const inJson = cwd === undefined ? undefined : JSON.stringify(cwd).slice(1, -1);
  // the adapter also names per-project folders after the directory, every character that is not a
  // letter or digit turned into a dash
  const mangled = cwd === undefined ? undefined : cwd.replace(/[^A-Za-z0-9]/g, '-');
  const dropped = raw.filter(l => (l.msg.method ?? '').startsWith('_auth/'));
  const emails = [...new Set(dropped.flatMap(l => JSON.stringify(l).match(EMAIL) ?? []))];
  const promoted = raw
    .filter(l => !(l.msg.method ?? '').startsWith('_auth/'))
    .map(l => {
      const kept = options.keepSession !== undefined && Array.isArray(l.msg.result?.sessions)
        ? { ...l, msg: { ...l.msg, result: { ...l.msg.result, sessions: l.msg.result.sessions.filter((s: any) => s.sessionId === options.keepSession) } } }
        : l;
      if (!inJson) { return JSON.parse(JSON.stringify(kept).replace(TEMP_ROOT, '/claude-tmp')) as RecordedLine; }
      let text = JSON.stringify(kept).split(inJson).join(WORKSPACE_PLACEHOLDER);
      if (mangled) { text = text.split(mangled).join('-workspace'); }
      return JSON.parse(text.replace(TEMP_ROOT, '/claude-tmp')) as RecordedLine;
    });
  const texts = [...promoted.map(l => JSON.stringify(l)), ...chunkRuns(promoted)];
  for (const text of texts) {
    const path = LOCAL_PATHS.exec(text);
    if (path) { throw new Error(`promote: refusing a recording that still holds a local path: ${path[0]} (in: …${text.slice(Math.max(0, path.index - 60), path.index + path[0].length + 20)})`); }
    const secret = SECRET_SHAPES.exec(text);
    if (secret) { throw new Error(`promote: refusing a recording that holds a secret-shaped string: ${secret[0].slice(0, 6)}…`); }
    for (const needle of [...emails, ...(options.forbidden ?? [])]) {
      if (needle && text.toLowerCase().includes(needle.toLowerCase())) { throw new Error(`promote: refusing a recording that still holds ${needle}`); }
    }
  }
  return promoted;
}

export function formatSession(lines: RecordedLine[]): string {
  return lines.map(l => formatLine(l.dir, l.msg)).join('\n') + '\n';
}
