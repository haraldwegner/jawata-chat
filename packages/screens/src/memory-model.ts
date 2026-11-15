/**
 * What the Memory screen says, worked out from what the host read: a function of the data alone, so every sentence the person reads can be
 * tested without a browser. The words and mouseovers are the studio's (MemoryView.svelte), with the changes the ux report's section 5 makes.
 */

/** What the host answers for the knowledge store: which store this host opens, and the engine's own statistics of it. */
export interface MemoryStatus {
  /** The store setting as the host has it: shared, workspace, memory, or the path of a folder. */
  readonly mode: string;
  readonly stats: StoreStats;
}

/** The engine's statistics of the store; only the parts this screen reads. */
export interface StoreStats {
  readonly total?: number;
  readonly store?: { readonly file?: string | null; readonly bytes?: number };
  readonly by_lane?: Readonly<Record<string, number>>;
  readonly catalogue?: {
    readonly byNamespace?: Readonly<Record<string, number>>;
    readonly cures?: { readonly declared?: number; readonly unresolved?: number };
  };
  readonly describing?: {
    readonly describedPerBundle?: Readonly<Record<string, number>>;
    readonly lostBookkeepingWrites?: number;
    readonly describedAreas?: readonly string[];
    readonly describedAreasTruncated?: string;
  };
}

/** A line with the words shown and the mouseover beside them. */
export interface Titled {
  readonly text: string;
  readonly title: string;
}

/** The top of the screen. */
export interface MemoryView {
  readonly summary: Titled;
  readonly warnings: readonly string[];
  readonly lanes: readonly { readonly lane: string; readonly count: number; readonly unclassified: boolean; readonly title: string }[];
  readonly patterns: Titled | null;
  readonly cataloguer: (Titled & { readonly attention: boolean }) | null;
}

/** The kind of entry each lane holds, as the mouseover on its count; a lane not named here shows with the generic line. */
export const LANE_HINTS: Readonly<Record<string, string>> = {
  experience: 'Something lived here: a lesson or a failure mode. It can be superseded by a later one.',
  domain: 'A fact that simply holds: a contract, a convention, how something works.',
  patterns: 'The architect\'s template library: design patterns it reaches for when a design question has no answer in what we have lived. Nothing in ordinary use removes one; a re-seed supersedes rows rather than deleting them.',
  rules: 'Standing guidance. A rule is versioned and retired, never deleted.',
  code: 'What each class member and package is for, written by the cataloguer.',
  '(none)': 'Entries whose type no lane rule covers. They are counted here, not filed under a default, so the gap stays visible.',
};

/** The mouseover of a lane the list above does not name. */
export const LANE_HINT_OTHER = 'A kind of entry the store keeps apart from the others.';

/** A size in the units a person reads. */
export function formatBytes(bytes?: number): string {
  if (bytes === undefined || bytes === null || bytes < 0) { return '–'; }
  if (bytes < 1024) { return `${bytes} B`; }
  if (bytes < 1024 * 1024) { return `${(bytes / 1024).toFixed(1)} KB`; }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Which store this is, in words, and its mouseover. */
function scopeOf(mode: string, file: string): Titled {
  switch (mode) {
    case 'shared':
      return { text: 'shared by every workspace', title: `One store for your whole user, so what is learned in one workspace can be recalled in all. File: ${file}` };
    case 'workspace':
      return { text: 'one store per workspace', title: `One store per workspace. File: ${file}` };
    case 'memory':
      return { text: 'held in memory only', title: 'Eclipse was started with a store that is kept in memory: everything in it is gone when Eclipse closes.' };
    default:
      return { text: 'the store in a folder of its own', title: `The store in the folder Eclipse was told to use, ${mode}. File: ${file}` };
  }
}

/** The lanes in the engine's order, except that a bracketed collector such as "(none)" reads last. */
function lanesOf(stats: StoreStats): MemoryView['lanes'] {
  const lanes = stats.by_lane ?? {};
  return Object.keys(lanes)
    .sort((a, b) => Number(a.startsWith('(')) - Number(b.startsWith('(')))
    .map(lane => ({
      lane: lane === '(none)' ? 'unclassified' : lane,
      count: lanes[lane] ?? 0,
      unclassified: lane.startsWith('('),
      title: LANE_HINTS[lane] ?? LANE_HINT_OTHER,
    }));
}

function patternsOf(stats: StoreStats): Titled | null {
  const cures = stats.catalogue?.cures;
  if (cures?.declared === undefined) { return null; }
  const namespaces = Object.entries(stats.catalogue?.byNamespace ?? {}).map(([namespace, count]) => `${namespace}: ${count}`).join(' · ');
  return {
    text: `Pattern library: ${cures.declared} cures${cures.unresolved ? `, ${cures.unresolved} unresolved` : ', all resolved'}`,
    title: 'The architect\'s template library. How many of this store\'s rows are patterns is the figure above; a per-namespace figure is what '
      + `that source last SEEDED, so it drifts when a pattern is added here or retired upstream. ${namespaces}`,
  };
}

function cataloguerOf(stats: StoreStats): (Titled & { readonly attention: boolean }) | null {
  const describing = stats.describing;
  const perBundle = describing?.describedPerBundle;
  const areas = describing?.describedAreas;
  if (!perBundle && !areas) { return null; }
  const bundles = Object.entries(perBundle ?? {}).sort(([a], [b]) => Number(a === 'unattributed') - Number(b === 'unattributed'));
  const units = bundles.reduce((sum, [, count]) => sum + count, 0);
  const cut = describing?.describedAreasTruncated;
  const lost = describing?.lostBookkeepingWrites ?? 0;
  const parts = [`Cataloguer: ${units} units described${perBundle ? ` in ${bundles.length} bundles` : ''}`];
  if (areas) {
    parts.push(areas.length > 0 ? `${areas.length} areas summarised${cut ? ' (list cut)' : ''}` : 'no area summarised yet');
  }
  if (lost > 0) { parts.push(`${lost} writes LOST`); }
  return {
    text: parts.join(' · '),
    attention: lost > 0 || !!cut,
    title: `Source units the cataloguer has described, per bundle: ${bundles.length > 0 ? bundles.map(([bundle, count]) => `${bundle} ${count}`).join(', ') : 'none'}. `
      + 'How many units a bundle holds only a loaded project can say, so no percentage is claimed. An area with a summary written is one the '
      + `cataloguer recorded for a whole package; an area not listed is not described yet${cut ? `, EXCEPT that this list is cut: ${cut}` : ''}. `
      + 'Which areas are still missing needs a loaded project: experience(kind=describe, action=next) answers it, one row per package in scope.',
  };
}

/** Works out the top of the screen and what the store holds. */
export function memoryView(status: MemoryStatus): MemoryView {
  const stats = status.stats;
  // the store says itself when it is kept in memory; whether a file is the shared one or this workspace's only the setting says
  const scope = scopeOf(stats.store?.file === 'in-memory' ? 'memory' : status.mode, stats.store?.file ?? '–');
  const warnings: string[] = [];
  const lost = stats.describing?.lostBookkeepingWrites ?? 0;
  if (lost > 0) {
    warnings.push(`${lost} cataloguer bookkeeping write(s) were LOST — those units will be offered again, so the cataloguer's figures may be lower than the work done.`);
  }
  const cut = stats.describing?.describedAreasTruncated;
  if (cut) {
    warnings.push(`The list of described areas is cut: ${cut}`);
  }
  return {
    summary: { text: `${stats.total ?? '–'} entries · ${formatBytes(stats.store?.bytes)} · ${scope.text}`, title: scope.title },
    warnings,
    lanes: lanesOf(stats),
    patterns: patternsOf(stats),
    cataloguer: cataloguerOf(stats),
  };
}

const count = (value: unknown): number | undefined => (typeof value === 'number' ? value : undefined);

type Answer = Record<string, unknown>;

/** Removed rows, the same sentence for a wipe and a prune. */
const removed = (p: Answer): string[] => (count(p.removed) !== undefined ? [`Removed ${String(p.removed)} entr(ies)`] : []);

/** The store actions the page asks its host for: the host's allowed list, so an action with no row below fails to compile. */
export type StoreAction = 'load' | 'backup' | 'export' | 'import' | 'restore' | 'list' | 'promote' | 'promote_rule' | 'retire_rule' | 'wipe' | 'cleanUp';

/** What the page knows about one store action. */
interface ActionRow {
  /** How the action is named while it runs and in the status heading. */
  readonly words: string;
  /** Whether its answer can change what the store holds, so the figures are read again after it. */
  readonly changesStore: boolean;
  /** The sentences its answer says. */
  readonly summary: (p: Answer) => string[];
  /**
   * Which of the lines every answer shares are added: all of them; all but the copy taken before the action, for the action that IS the copy;
   * or none, for an action whose parts each say their own.
   */
  readonly sharedLines: 'all' | 'no-copy' | 'none';
}

/** The three steps of Clean up, each answered on its own. */
const CLEAN_UP_STEPS: Readonly<Record<'prune' | 'dedup' | 'compact', (p: Answer) => string[]>> = {
  prune: removed,
  dedup: (p) => (count(p.group_count) !== undefined ? [`${String(p.group_count)} duplicate group(s), ${count(p.merged) ?? 0} merged`] : []),
  compact: (p) => {
    if (p.compacted === true) {
      const before = count(p.bytes_before);
      const after = count(p.bytes_after);
      return [before !== undefined && after !== undefined ? `Store compacted: ${formatBytes(before)} → ${formatBytes(after)}` : 'Store compacted'];
    }
    return p.compacted === false ? [`Not compacted${typeof p.reason === 'string' ? ` — ${p.reason}` : ''}`] : [];
  },
};

/** Every store action the page can ask for, in one table: a new action is a new row, and what the page knows about it sits in that row. */
export const ACTIONS: { readonly [K in StoreAction]: ActionRow } = {
  load: {
    words: 'load',
    changesStore: true,
    sharedLines: 'all',
    summary: (p) => {
      const lines: string[] = [];
      const loaded = count(p.loaded);
      const files = count(p.files);
      const unchanged = count(p.unchanged);
      if (loaded !== undefined) {
        lines.push(`Loaded ${loaded}${files !== undefined ? ` of ${files}` : ''} file(s)`
          + (unchanged ? `, ${unchanged} unchanged (skipped)` : '')
          + (Array.isArray(p.linked) || count(p.linked) !== undefined ? `, ${count(p.linked) ?? 0} reached via links` : ''));
      }
      if (Array.isArray(p.skipped) && p.skipped.length > 0) { lines.push(`${p.skipped.length} source(s) skipped — see raw response`); }
      return lines;
    },
  },
  backup: {
    words: 'backup',
    changesStore: true,
    // the copy this action takes is its whole answer, so the line about a copy taken before an action is not added to it
    sharedLines: 'no-copy',
    summary: (p) => (typeof p.backup === 'string'
      ? [`Copy taken: ${p.backup}${count(p.kept) !== undefined ? ` — ${String(p.kept)} of ${String(count(p.depth) ?? '?')} kept` : ''}`] : []),
  },
  export: {
    words: 'export',
    changesStore: false,
    sharedLines: 'all',
    summary: (p) => {
      const exported = count(p.exported) ?? count(p.count);
      return [`Exported${exported !== undefined ? ` ${exported} entr(ies)` : ''}${typeof p.path === 'string' ? ` to ${p.path}` : ''}`];
    },
  },
  import: {
    words: 'import',
    changesStore: true,
    sharedLines: 'all',
    summary: (p) => {
      const imported = count(p.imported) ?? count(p.count);
      return [
        ...(imported !== undefined ? [`Imported ${imported} entr(ies)`] : []),
        ...(count(p.skipped) !== undefined ? [`${String(p.skipped)} duplicate(s) skipped`] : []),
      ];
    },
  },
  restore: {
    words: 'restore',
    changesStore: true,
    sharedLines: 'all',
    summary: (p) => {
      const lines: string[] = [];
      if (Array.isArray(p.backups)) {
        lines.push(p.backups.length === 0 ? 'No copies yet.' : `${p.backups.length} version(s), newest first — ${String(count(p.depth) ?? '?')} kept`);
      }
      if (typeof p.restored === 'string') {
        lines.push(`Restored from ${p.restored}`);
        if (count(p.rows) !== undefined) { lines.push(`The store now holds ${String(p.rows)} entr(ies)`); }
      }
      return lines;
    },
  },
  list: {
    words: 'curation',
    changesStore: false,
    sharedLines: 'all',
    summary: (p) => (count(p.rules) !== undefined
      ? [`${String(p.rules)} rule(s), ${count(p.entries) ?? 0} entr(ies), ${count(p.awaitingReview) ?? 0} awaiting review`] : []),
  },
  promote: {
    words: 'promote',
    changesStore: true,
    sharedLines: 'all',
    summary: (p) => {
      if (p.changed === true) { return [`Promoted to ${String(p.status ?? 'accepted')}.`]; }
      return p.changed === false ? [`Nothing changed — it is already ${String(p.status ?? 'accepted')}, or the entry is gone.`] : [];
    },
  },
  promote_rule: {
    words: 'promote to rule',
    changesStore: true,
    sharedLines: 'all',
    summary: (p) => {
      if (typeof p.id !== 'string') { return []; }
      const sources = Array.isArray(p.derived_from) ? p.derived_from.length : undefined;
      return [`Promoted as v${String(p.rule_version ?? 1)}${sources !== undefined ? `, drawn from ${sources} entr(ies)` : ''}. `
        + 'The sources are NOT superseded — they go on answering as themselves.'];
    },
  },
  retire_rule: {
    words: 'retire',
    changesStore: true,
    sharedLines: 'all',
    summary: (p) => {
      if (p.retired === true) { return ['Retired — it stops being offered as guidance, and stays readable.']; }
      return p.retired === false ? [`Nothing changed${typeof p.note === 'string' ? ` — ${p.note}` : ''}.`] : [];
    },
  },
  wipe: { words: 'wipe', changesStore: true, sharedLines: 'all', summary: removed },
  cleanUp: {
    words: 'clean up',
    changesStore: true,
    sharedLines: 'none',
    summary: (p) => (['prune', 'dedup', 'compact'] as const).flatMap(step => answered(CLEAN_UP_STEPS[step], p[step], 'all')),
  },
};

/** One answer in sentences: the cancellation, or its error, its own lines, and the lines every answer shares that the row asks for. */
function answered(own: (p: Answer) => string[], payload: unknown, shared: ActionRow['sharedLines']): string[] {
  if (payload === null || typeof payload !== 'object') { return []; }
  const p = payload as Answer;
  if (p.cancelled === true) { return ['Cancelled: nothing was changed.']; }
  if (shared === 'none') { return own(p); }
  const lines: string[] = [];
  if (typeof p.error === 'string') { lines.push(`Error: ${p.error}`); }
  lines.push(...own(p));
  const refresh = p.refresh as Answer | undefined;
  if (refresh && Array.isArray(refresh.staled) && refresh.staled.length > 0) {
    lines.push(`${refresh.staled.length} stale Java pointer(s) flagged automatically`);
  }
  if (shared === 'all') {
    if (typeof p.backup === 'string') {
      lines.push(`A copy of the previous state was kept: ${p.backup}`);
    } else if (p.backup === null && typeof p.backupNote === 'string') {
      lines.push(`No copy was taken — ${p.backupNote}`);
    }
  }
  return lines;
}

/**
 * What the last action did, in sentences; the unmodified answer stays behind the raw-response fold.
 *
 * @param kind    the action, as the page asked the host for it
 * @param payload the host's answer
 */
export function summarize(kind: StoreAction, payload: unknown): string[] {
  return answered(ACTIONS[kind].summary, payload, ACTIONS[kind].sharedLines);
}
