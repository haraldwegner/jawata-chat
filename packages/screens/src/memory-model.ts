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
      return { text: 'this workspace\'s own store', title: `One store for this workspace only, so what is learned here is not recalled in another. File: ${file}` };
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
  const scope = scopeOf(status.mode, stats.store?.file ?? '–');
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

/**
 * What the last action did, in sentences; the unmodified answer stays behind the raw-response fold.
 *
 * @param kind    the verb, as the page asked the host for it
 * @param payload the host's answer
 */
export function summarize(kind: string, payload: unknown): string[] {
  if (payload === null || typeof payload !== 'object') { return []; }
  const p = payload as Record<string, unknown>;
  if (p.cancelled === true) { return ['Cancelled: nothing was changed.']; }
  if (kind === 'cleanUp') {
    return ['prune', 'dedup', 'compact'].flatMap(step => summarize(step, p[step]));
  }
  const lines: string[] = [];
  if (typeof p.error === 'string') { lines.push(`Error: ${p.error}`); }
  switch (kind) {
    case 'load': {
      const loaded = count(p.loaded);
      const files = count(p.files);
      const unchanged = count(p.unchanged);
      if (loaded !== undefined) {
        lines.push(`Loaded ${loaded}${files !== undefined ? ` of ${files}` : ''} file(s)`
          + (unchanged ? `, ${unchanged} unchanged (skipped)` : '')
          + (Array.isArray(p.linked) || count(p.linked) !== undefined ? `, ${count(p.linked) ?? 0} reached via links` : ''));
      }
      if (Array.isArray(p.skipped) && p.skipped.length > 0) { lines.push(`${p.skipped.length} source(s) skipped — see raw response`); }
      break;
    }
    case 'wipe':
    case 'prune':
      if (count(p.removed) !== undefined) { lines.push(`Removed ${p.removed} entr(ies)`); }
      break;
    case 'dedup':
      if (count(p.group_count) !== undefined) { lines.push(`${p.group_count} duplicate group(s), ${count(p.merged) ?? 0} merged`); }
      break;
    case 'compact':
      if (p.compacted === true) {
        const before = count(p.bytes_before);
        const after = count(p.bytes_after);
        lines.push(before !== undefined && after !== undefined ? `Store compacted: ${formatBytes(before)} → ${formatBytes(after)}` : 'Store compacted');
      } else if (p.compacted === false) {
        lines.push(`Not compacted${typeof p.reason === 'string' ? ` — ${p.reason}` : ''}`);
      }
      break;
    case 'export': {
      const exported = count(p.exported) ?? count(p.count);
      lines.push(`Exported${exported !== undefined ? ` ${exported} entr(ies)` : ''}${typeof p.path === 'string' ? ` to ${p.path}` : ''}`);
      break;
    }
    case 'import': {
      const imported = count(p.imported) ?? count(p.count);
      if (imported !== undefined) { lines.push(`Imported ${imported} entr(ies)`); }
      if (count(p.skipped) !== undefined) { lines.push(`${p.skipped} duplicate(s) skipped`); }
      break;
    }
    case 'retire_rule':
      if (p.retired === true) {
        lines.push('Retired — it stops being offered as guidance, and stays readable.');
      } else if (p.retired === false) {
        lines.push(`Nothing changed${typeof p.note === 'string' ? ` — ${p.note}` : ''}.`);
      }
      break;
    case 'promote':
      if (p.changed === true) {
        lines.push(`Promoted to ${String(p.status ?? 'accepted')}.`);
      } else if (p.changed === false) {
        lines.push(`Nothing changed — it is already ${String(p.status ?? 'accepted')}, or the entry is gone.`);
      }
      break;
    case 'list':
      if (count(p.rules) !== undefined) {
        lines.push(`${String(p.rules)} rule(s), ${count(p.entries) ?? 0} entr(ies), ${count(p.awaitingReview) ?? 0} awaiting review`);
      }
      break;
    case 'promote_rule':
      if (typeof p.id === 'string') {
        const sources = Array.isArray(p.derived_from) ? p.derived_from.length : undefined;
        lines.push(`Promoted as v${String(p.rule_version ?? 1)}${sources !== undefined ? `, drawn from ${sources} entr(ies)` : ''}. `
          + 'The sources are NOT superseded — they go on answering as themselves.');
      }
      break;
    case 'backup':
      if (typeof p.backup === 'string') {
        lines.push(`Copy taken: ${p.backup}${count(p.kept) !== undefined ? ` — ${String(p.kept)} of ${String(count(p.depth) ?? '?')} kept` : ''}`);
      }
      break;
    case 'restore':
      if (Array.isArray(p.backups)) {
        lines.push(p.backups.length === 0 ? 'No copies yet.' : `${p.backups.length} version(s), newest first — ${String(count(p.depth) ?? '?')} kept`);
      }
      if (typeof p.restored === 'string') {
        lines.push(`Restored from ${p.restored}`);
        if (count(p.rows) !== undefined) { lines.push(`The store now holds ${String(p.rows)} entr(ies)`); }
      }
      break;
    default:
      break;
  }
  const refresh = p.refresh as Record<string, unknown> | undefined;
  if (refresh && Array.isArray(refresh.staled) && refresh.staled.length > 0) {
    lines.push(`${refresh.staled.length} stale Java pointer(s) flagged automatically`);
  }
  if (kind !== 'backup') {
    if (typeof p.backup === 'string') {
      lines.push(`A copy of the previous state was kept: ${p.backup}`);
    } else if (p.backup === null && typeof p.backupNote === 'string') {
      lines.push(`No copy was taken — ${p.backupNote}`);
    }
  }
  return lines;
}
