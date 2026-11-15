import { useCallback, useEffect, useRef, useState } from 'react';
import type { ChangeEvent, ReactElement } from 'react';
import { reportingView } from './reporting-model.js';
import type { FieldStatus } from './reporting-model.js';
import type { ScreenProps } from './screen.js';

/** How often the screen asks. The host answers from its last reading, so this costs the recording nothing; it re-reads when the view is focused. */
const POLL_MILLIS = 5000;

const TOTALS_TITLE = 'A failure shape is a kind of error that repeats: tool, kind of failure and error code, counted per workspace. '
  + 'Worth reporting means seen 3 or more times and not yet filed; type /report in any client to file it.';
const SILENCE_TITLE = 'Stops the periodic reminder that failures are piling up, which jawata\'s hooks give in agent sessions outside Eclipse; Eclipse itself shows none. The recording itself keeps running and this page still shows everything.';
const DETAILS_TITLE = 'The figures behind the sentence above.';
const SHAPES_TITLE = 'Ranked by repeats. Three or more repeats that nobody has filed are what the count in the sentence above counts.';

/** The failures jawata recorded on this machine, and the switch for the reminders about them. Nothing here interrupts anyone. */
export function Reporting({ port, handle }: ScreenProps): ReactElement {
  const [status, setStatus] = useState<FieldStatus | null>(null);
  const [loadError, setLoadError] = useState('');
  const [silenceError, setSilenceError] = useState('');
  const [busy, setBusy] = useState(false);
  const reading = useRef(false);

  const refresh = useCallback(async (): Promise<void> => {
    if (reading.current) { return; }
    reading.current = true;
    try {
      setStatus(await port.fieldStatus() as unknown as FieldStatus);
      setLoadError('');
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : String(error));
    } finally {
      reading.current = false;
    }
  }, [port]);

  useEffect(() => {
    handle.refresh = refresh;
    void refresh();
    const timer = setInterval(() => { void refresh(); }, POLL_MILLIS);
    return () => { clearInterval(timer); };
  }, [handle, refresh]);

  const onSilence = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const silenced = event.currentTarget.checked;
    setBusy(true);
    setSilenceError('');
    try {
      setStatus(await port.fieldSetSilence(silenced) as unknown as FieldStatus);
    } catch (error) {
      setSilenceError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  if (loadError && !status) { return <p className="screen-error">Could not read the failure recording: {loadError}</p>; }
  if (!status) { return <p>Reading the recording…</p>; }

  const view = reportingView(status);
  return (
    <div className="screen">
      {loadError ? <p className="screen-error">Could not read the failure recording: {loadError}</p> : null}
      <p className={view.needsALook ? 'screen-verdict screen-attention' : 'screen-verdict'}>{view.verdict}</p>
      {view.caveat ? <p className="screen-attention">{view.caveat}</p> : null}
      <p title={TOTALS_TITLE}>{view.totals}</p>
      <label className="screen-check" title={SILENCE_TITLE}>
        <input type="checkbox" checked={view.silenced} disabled={busy} onChange={event => { void onSilence(event); }} />
        <span>Go silent about failures{view.silenced ? <em> (currently off by your choice)</em> : null}</span>
      </label>
      {silenceError ? <p className="screen-error">{silenceError}</p> : null}
      <p>Nothing leaves this machine unless you type <code>/report</code> in the chat to file one from your own GitHub account.</p>
      <details className="screen-fold">
        <summary title={DETAILS_TITLE}>Details</summary>
        <h3 title={SHAPES_TITLE}>Failure shapes</h3>
        {view.shapes.length === 0
          ? <p>No failures recorded.</p>
          : (
            <ul className="screen-list">
              {view.shapes.map(one => (
                <li key={one.shape}>
                  <code>{one.shape}</code>
                  <span className="screen-count">{one.count}x</span>
                  {one.posted ? <span className="screen-flag">filed</span> : null}
                </li>
              ))}
            </ul>
          )}
      </details>
    </div>
  );
}
