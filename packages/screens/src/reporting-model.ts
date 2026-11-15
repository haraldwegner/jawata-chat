/**
 * What the Reporting screen says, worked out from what the host read: a function of the data alone, so every sentence the person reads can be
 * tested without a browser.
 */

/** A failure shape is worth reporting from this many repeats, while nobody has filed it. The screen's mouseover says the same number. */
export const WORTH_REPORTING_AT = 3;

/** One kind of failure the engine recorded. */
export interface FailureShape {
  readonly shape: string;
  readonly count: number;
  readonly posted: boolean;
}

/** How the knowledge store answered the host's reading. */
export interface StoreReading {
  readonly health: 'healthy' | 'slow' | 'unavailable' | 'unknown';
  readonly millis: number;
  /** Why the store is slow or not answering, in the host's words; absent when it is neither. */
  readonly why?: string;
  /** Slower than this, a store counts as slow. */
  readonly slowAboveMillis?: number;
}

/** What the host answers for the failure recording. */
export interface FieldStatus {
  readonly pile: { readonly shapes: readonly FailureShape[]; readonly silenced: boolean };
  readonly store: StoreReading;
}

/** The sentences of the screen. */
export interface ReportingView {
  readonly needsALook: boolean;
  readonly verdict: string;
  /** Why the store needs a look, said beside the verdict; empty when it needs none. */
  readonly caveat: string;
  readonly totals: string;
  readonly shapes: readonly FailureShape[];
  readonly silenced: boolean;
}

const plural = (count: number, noun: string): string => `${count} ${noun}${count === 1 ? '' : 's'}`;

function storeInASentence(store: StoreReading): string {
  switch (store.health) {
    case 'healthy': return `Knowledge store answering${store.millis > 0 ? ` (${store.millis} ms)` : ''}.`;
    case 'slow': return 'Knowledge store slow.';
    case 'unavailable': return 'Knowledge store not answering.';
    default: return 'Knowledge store not checked yet.';
  }
}

/** The studio's caveat for a slow or silent store, less the workspace it names: inside Eclipse there is one. */
function storeCaveat(store: StoreReading): string {
  if ((store.health !== 'slow' && store.health !== 'unavailable') || !store.why) { return ''; }
  return store.health === 'slow' && store.slowAboveMillis ? `${store.why} (over ${store.slowAboveMillis} ms)` : store.why;
}

/** Works out the screen's sentences, the list most repeated first. */
export function reportingView(status: FieldStatus): ReportingView {
  const shapes = [...status.pile.shapes].sort((a, b) => b.count - a.count);
  const toReport = shapes.filter(one => !one.posted && one.count >= WORTH_REPORTING_AT).length;
  const filed = shapes.filter(one => one.posted).length;
  const attention = [
    toReport > 0 ? `${plural(toReport, 'failure shape')} worth reporting` : '',
    status.store.health === 'slow' ? 'the knowledge store is slow' : '',
    status.store.health === 'unavailable' ? 'the knowledge store is not answering' : '',
  ].filter(entry => entry !== '');
  return {
    needsALook: attention.length > 0,
    verdict: attention.length > 0 ? `Needs a look: ${attention.join(' · ')}` : `Nothing needs a look. ${storeInASentence(status.store)}`,
    caveat: storeCaveat(status.store),
    totals: `${plural(shapes.length, 'failure shape')} recorded · ${filed} filed · ${toReport} still to report`,
    shapes,
    silenced: status.pile.silenced,
  };
}
