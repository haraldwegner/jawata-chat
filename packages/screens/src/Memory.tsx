import { useCallback, useEffect, useRef, useState } from 'react';
import type { MouseEvent, ReactElement } from 'react';
import { ACTIONS, memoryView, summarize } from './memory-model.js';
import type { MemoryStatus, StoreAction } from './memory-model.js';
import type { Json } from './port.js';
import type { ScreenProps } from './screen.js';

/** One row of a curation list, as the store's list verb answers it. */
type Row = Readonly<Record<string, unknown>>;

/**
 * The mouseovers, word for word as the studio has them, with the changes the ux report's section 5 makes, and Load's told what the engine does
 * (28k 25k): folders named in the Memory preferences replace the discovered files, they are not added to them.
 */
export const MEMORY_TITLES = {
  load: 'Seed the store from your memory files: the instruction files found in your projects, or, when Preferences > jawata > Memory names folders, those folders and nothing else. '
    + 'Idempotent: re-loading replaces, so this is also the re-initialize after a wipe. Say: "load my memory files"',
  backup: 'Take a copy of the whole store right now. Wipe, Clean up, Import and Restore each take their own automatically. Say: "back up the store"',
  cleanUp: 'One hygiene pass: prune aged rejected/superseded entries, merge duplicate groups and compact the store file. Each is also available by prompt.',
  more: 'Less common actions',
  reload: 'Re-read entry counts, store file and size.',
  export: 'Write the whole store to a portable JSON file — opens the save dialog. Say: "export the store to a file"',
  import: 'Re-ingest a previously exported JSON file (deduplicated by id) — opens the file picker. Say: "import the export file"',
  restore: 'List the kept versions, newest first, and put one back. Say: "restore the store"',
  curation: 'The standing RULES, and the entries nobody has vouched for yet — each with the one action its lane\'s lifecycle allows. Say: "list the rules" / "promote that entry"',
  wipe: 'Delete everything in this store. Re-initialize afterwards with Load. Say: "wipe the store"',
  restoreOne: 'Replace every entry in this store with the ones this version holds',
  rules: 'A retired rule keeps its row and its date, which is what answers “what did this say, and until when”. Amending one — a new version, '
    + 'the old kept — is a prompt verb: the amended sentence is the work, and nothing here can write it.',
  retire: 'It stops being offered as guidance from now on. Not deleted and not marked wrong — it stays readable, with the date it stopped applying.',
  source: 'Select as a source for a new rule',
  promote: 'Accept this entry — it is then offered as vouched-for knowledge rather than as a candidate.',
  promoteRule: 'Write a standing rule drawn from the ticked entries. They are NOT superseded — they go on answering as themselves, and the rule '
    + 'records which ones it came from. Tick at least one entry and write the sentence — neither is optional, because a rule with no sources '
    + 'is an assertion nobody can check and a generated sentence is not a rule. Amending one later is a prompt verb: the amended sentence IS the work.',
  raw: 'The unmodified response of the last action',
  holds: 'What the store holds, how far the cataloguer has got, and where the pattern library stands.',
} as const;



/** After a failed read the store is asked again on its own, 5 seconds later and twice as long each time up to a minute, as the studio does. */
const RETRY_MIN_MS = 5000;
const RETRY_MAX_MS = 60000;


/** Said beside a failed read while the store is being asked again. */
const RETRYING = 'Asking again automatically…';

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** The day half of an ISO timestamp: a rule stopped applying on a day, not at a millisecond. */
const onDay = (iso: unknown): string => (typeof iso === 'string' && iso.length >= 10 ? iso.slice(0, 10) : '');

const textOf = (row: Row, key: string): string => (typeof row[key] === 'string' ? row[key] : '');

const entriesOf = (payload: Json): Row[] => {
  const list = payload !== null && typeof payload === 'object' && !Array.isArray(payload) ? payload.entries : undefined;
  return Array.isArray(list) ? list as Row[] : [];
};

/** The knowledge store: what it holds, and the actions that keep it healthy. A question before a destructive action is the host's own dialog. */
export function Memory({ port, handle }: ScreenProps): ReactElement {
  const [status, setStatus] = useState<MemoryStatus | null>(null);
  const [statusError, setStatusError] = useState('');
  const [seconds, setSeconds] = useState(0);
  const [busy, setBusy] = useState<StoreAction | ''>('');
  const [reloading, setReloading] = useState(false);
  const [failures, setFailures] = useState(0);
  const retryDelay = useRef(RETRY_MIN_MS);
  const more = useRef<HTMLDetailsElement>(null);
  const [output, setOutput] = useState<{ title: StoreAction | ''; lines: string[]; raw: string }>({ title: '', lines: [], raw: '' });
  const [versions, setVersions] = useState<{ names: string[]; depth: number } | null>(null);
  const [curation, setCuration] = useState<{ rules: Row[]; entries: Row[] } | null>(null);
  const [sources, setSources] = useState<ReadonlySet<string>>(new Set());
  const [ruleSentence, setRuleSentence] = useState('');
  const reading = useRef(false);

  const refresh = useCallback(async (): Promise<void> => {
    if (reading.current) { return; }
    reading.current = true;
    setReloading(true);
    try {
      setStatus(await port.knowledgeStatus() as unknown as MemoryStatus);
      setStatusError('');
      setFailures(0);
    } catch (error) {
      setStatusError(messageOf(error));
      setFailures(count => count + 1);
    } finally {
      reading.current = false;
      setReloading(false);
    }
  }, [port]);

  useEffect(() => {
    handle.refresh = refresh;
    void refresh();
  }, [handle, refresh]);

  // a read that failed is tried again on its own, backing off, so a view opened before the engine answers is not left dead
  useEffect(() => {
    if (failures === 0) { retryDelay.current = RETRY_MIN_MS; return undefined; }
    const timer = setTimeout(() => { void refresh(); }, retryDelay.current);
    retryDelay.current = Math.min(retryDelay.current * 2, RETRY_MAX_MS);
    return () => { clearTimeout(timer); };
  }, [failures, refresh]);

  // the More menu closes on a click outside it and on Escape, as the studio's does
  useEffect(() => {
    const close = (event: Event): void => {
      const menu = more.current;
      if (!menu?.open) { return; }
      if ('key' in event ? event.key === 'Escape' : !menu.contains(event.target as Node)) { menu.removeAttribute('open'); }
    };
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', close);
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', close); };
  }, []);

  // the first read can take seconds: the wait text grows by a dot a second, and starts over after ten
  useEffect(() => {
    if (status) { return undefined; }
    const timer = setInterval(() => { setSeconds(value => value + 1); }, 1000);
    return () => { clearInterval(timer); };
  }, [status]);

  const show = (title: StoreAction, payload: unknown): void => {
    setOutput({ title, lines: summarize(title, payload), raw: typeof payload === 'string' ? payload : JSON.stringify(payload, null, 2) });
  };

  const readVersions = async (): Promise<Json> => {
    const listed = await port.experienceVerb('restore', {});
    const p = listed !== null && typeof listed === 'object' && !Array.isArray(listed) ? listed : {};
    setVersions({ names: Array.isArray(p.backups) ? p.backups.map(String) : [], depth: typeof p.depth === 'number' ? p.depth : 0 });
    return listed;
  };

  const readCuration = async (): Promise<{ rules: number; entries: number; awaitingReview: number }> => {
    const [ruleList, entryList] = await Promise.all([
      port.experienceVerb('list', { type: 'rule', limit: 200 }),
      port.experienceVerb('list', { limit: 200 }),
    ]);
    const rules = entriesOf(ruleList);
    const entries = entriesOf(entryList).filter(entry => entry.type !== 'rule');
    setCuration({ rules, entries });
    return { rules: rules.length, entries: entries.length, awaitingReview: entries.filter(entry => entry.status === 'candidate').length };
  };

  /** Runs one action and says what it did; a list shown on the screen is read again, because the action may have changed it. */
  const run = async (title: StoreAction, action: () => Promise<unknown>, changes = ACTIONS[title].changesStore): Promise<unknown> => {
    if (busy) { return undefined; }
    setBusy(title);
    show(title, '…');
    try {
      const answer = await action();
      show(title, answer);
      const cancelled = answer !== null && typeof answer === 'object' && (answer as Record<string, unknown>).cancelled === true;
      if (!cancelled && changes) {
        await refresh();
        if (versions && title !== 'restore') { await readVersions(); }
        if (curation) { await readCuration(); }
      }
      return answer;
    } catch (error) {
      show(title, { error: messageOf(error) });
      return undefined;
    } finally {
      setBusy('');
    }
  };

  const verb = (name: StoreAction, args: Json = {}): Promise<unknown> => run(name, () => port.experienceVerb(name, args));

  const exportStore = async (): Promise<void> => {
    const path = await port.saveDialog({ title: 'Export memory store', name: 'jawata-memory-export.json', extensions: ['json'] });
    if (path) { await verb('export', { path }); }
  };

  const importStore = async (): Promise<void> => {
    const path = await port.openDialog({ title: 'Import memory export', extensions: ['json'] });
    if (path) { await verb('import', { path }); }
  };

  const restoreOne = async (name: string): Promise<void> => {
    await run('restore', async () => {
      const answer = await port.experienceVerb('restore', { name });
      const cancelled = answer !== null && typeof answer === 'object' && !Array.isArray(answer) && answer.cancelled === true;
      if (!cancelled) { await readVersions(); }
      return answer;
    });
  };

  const promoteToRule = async (): Promise<void> => {
    const answer = await verb('promote_rule', { ids: [...sources], summary: ruleSentence.trim() });
    // cleared only when it went through, so a failure leaves the draft and the selection where the person can try again
    if (answer !== undefined) {
      setRuleSentence('');
      setSources(new Set());
    }
  };

  const toggleSource = (id: string, on: boolean): void => {
    const next = new Set(sources);
    if (on) { next.add(id); } else { next.delete(id); }
    setSources(next);
  };

  /** Closes the More menu after one of its buttons was pressed. */
  const closeMore = (event: MouseEvent<HTMLElement>): void => {
    event.currentTarget.closest('details')?.removeAttribute('open');
  };

  if (!status) {
    return statusError
      ? <div className="screen"><p className="screen-error">Could not read the store: {statusError}</p><p>{RETRYING}</p></div>
      : <p>{`Reading the store…${'.'.repeat(seconds % 10)}`}</p>;
  }

  const view = memoryView(status);
  const idle = busy === '';
  const awaiting = curation ? curation.entries.filter(entry => entry.status === 'candidate').length : 0;
  return (
    <div className="screen">
      <p title={view.summary.title}><strong>{view.summary.text}</strong></p>
      {view.warnings.map(warning => <p key={warning} className="screen-attention">{warning}</p>)}
      {statusError ? <p className="screen-error">Could not read the store: {statusError} {RETRYING}</p> : null}

      <div className="screen-actions">
        <button type="button" disabled={!idle} title={MEMORY_TITLES.load} onClick={() => { void verb('load'); }}>Load</button>
        <button type="button" disabled={!idle} title={MEMORY_TITLES.backup} onClick={() => { void verb('backup'); }}>Back up now</button>
        <button type="button" disabled={!idle} title={MEMORY_TITLES.cleanUp} onClick={() => { void verb('cleanUp'); }}>Clean up</button>
        <details className="screen-more" ref={more}>
          <summary title={MEMORY_TITLES.more}>More ▾</summary>
          <div onClick={closeMore}>
            <button type="button" disabled={!idle || reloading} title={MEMORY_TITLES.reload} onClick={() => { void refresh(); }}>{reloading ? 'Loading…' : 'Reload status'}</button>
            <button type="button" disabled={!idle} title={MEMORY_TITLES.export} onClick={() => { void exportStore(); }}>Export…</button>
            <button type="button" disabled={!idle} title={MEMORY_TITLES.import} onClick={() => { void importStore(); }}>Import…</button>
            <button type="button" disabled={!idle} title={MEMORY_TITLES.restore} onClick={() => { void run('restore', readVersions, false); }}>{versions ? 'Refresh versions' : 'Restore…'}</button>
            <button type="button" disabled={!idle} title={MEMORY_TITLES.curation} onClick={() => { void run('list', readCuration); }}>{curation ? 'Refresh curation' : 'Curation…'}</button>
            <button type="button" className="screen-danger" disabled={!idle} title={MEMORY_TITLES.wipe} onClick={() => { void verb('wipe'); }}>Wipe…</button>
          </div>
        </details>
        {busy ? <span>running “{ACTIONS[busy].words}”…</span> : null}
      </div>

      {versions ? (
        <section>
          <h3>Versions{versions.depth ? ` — ${versions.names.length} kept, ${versions.depth} deep` : ''}</h3>
          {versions.names.length === 0
            ? <p>No copies yet. One is taken automatically before Wipe, Clean up, Import and Restore — and “Back up now” takes one on demand.</p>
            : (
              <>
                <ul className="screen-list">
                  {versions.names.map(name => (
                    <li key={name}>
                      <code>{name}</code>
                      <button type="button" className="screen-danger" disabled={!idle} title={MEMORY_TITLES.restoreOne} onClick={() => { void restoreOne(name); }}>Restore</button>
                    </li>
                  ))}
                </ul>
                <p>Newest first. A name is when the copy was taken and the action it preceded, so “…-wipe.zip” is the state as it stood just before that wipe.</p>
              </>
            )}
        </section>
      ) : null}

      {curation ? (
        <section>
          <h3 title={MEMORY_TITLES.rules}>Rules — {curation.rules.length}</h3>
          {curation.rules.length === 0
            ? <p>No rules yet. Tick the entries a rule is drawn from in the list below, write the sentence, and promote them.</p>
            : (
              <ul className="screen-list">
                {curation.rules.map(rule => (
                  <li key={String(rule.id)}>
                    <span><strong>v{String(rule.rule_version ?? 1)}</strong> {textOf(rule, 'summary')}{rule.retired_at ? <em> — stopped applying {onDay(rule.retired_at)}</em> : null}</span>
                    {rule.retired_at ? null : (
                      <button type="button" disabled={!idle} title={MEMORY_TITLES.retire}
                        onClick={() => { void verb('retire_rule', { id: String(rule.id), summary: textOf(rule, 'summary') }); }}>Retire</button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          <h3>Entries — {curation.entries.length}, {awaiting} awaiting review</h3>
          {curation.entries.length === 0
            ? <p>No entries in this store yet — “Load” seeds it from your files.</p>
            : (
              <>
                <ul className="screen-list">
                  {curation.entries.map(entry => (
                    <li key={String(entry.id)}>
                      <label className="screen-check" title={MEMORY_TITLES.source}>
                        <input type="checkbox" checked={sources.has(String(entry.id))} disabled={!idle}
                          onChange={event => { toggleSource(String(entry.id), event.currentTarget.checked); }} />
                        <span><strong>{textOf(entry, 'type')}</strong> {textOf(entry, 'summary')}</span>
                      </label>
                      {entry.status === 'candidate'
                        ? <button type="button" disabled={!idle} title={MEMORY_TITLES.promote} onClick={() => { void verb('promote', { id: String(entry.id) }); }}>Promote</button>
                        : null}
                    </li>
                  ))}
                </ul>
                <p>Up to 200 shown, in the store's own order.</p>
              </>
            )}
          <div className="screen-actions">
            <label>
              <span>Promote {sources.size} selected into a rule </span>
              <input type="text" value={ruleSentence} disabled={!idle} placeholder="the rule itself — one sentence a reader can follow and act on"
                onChange={event => { setRuleSentence(event.currentTarget.value); }} />
            </label>
            <button type="button" disabled={!idle || sources.size === 0 || ruleSentence.trim() === ''} title={MEMORY_TITLES.promoteRule}
              onClick={() => { void promoteToRule(); }}>Promote to rule</button>
          </div>
        </section>
      ) : null}

      <section>
        <h3>Status{output.title ? ` of “${ACTIONS[output.title].words}”` : ''}</h3>
        {output.raw === '…'
          ? <p>running…</p>
          : output.lines.length > 0
            ? <ul className="screen-list">{output.lines.map(line => <li key={line}>{line}</li>)}</ul>
            : output.raw ? null : <p>No action run yet — what the last action did appears here.</p>}
        {output.raw && output.raw !== '…' ? (
          <details className="screen-fold">
            <summary title={MEMORY_TITLES.raw}>raw response</summary>
            <pre>{output.raw}</pre>
          </details>
        ) : null}
      </section>

      <section>
        <h3 title={MEMORY_TITLES.holds}>What the store holds</h3>
        {view.lanes.length > 0 ? (
          <p className="screen-lanes">
            {view.lanes.map(lane => <span key={lane.lane} title={lane.title}><strong>{lane.count}</strong> {lane.lane}</span>)}
          </p>
        ) : null}
        {view.patterns ? <p title={view.patterns.title}>{view.patterns.text}</p> : null}
        {view.cataloguer ? <p className={view.cataloguer.attention ? 'screen-attention' : undefined} title={view.cataloguer.title}>{view.cataloguer.text}</p> : null}
      </section>
    </div>
  );
}
