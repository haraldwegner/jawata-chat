import { useState } from 'react';

import type { ProfileResult, ProfileRow, ProfileSource } from './types.js';

const DIMENSIONS: ReadonlyArray<{ value: string; label: string; hint: string }> = [
  { value: 'cpu', label: 'CPU', hint: 'Where the program spends processor time' },
  { value: 'wall', label: 'Elapsed time', hint: 'Where elapsed time goes, including waiting on locks and I/O' },
  { value: 'alloc', label: 'Allocation', hint: 'Which methods allocate the most' },
  { value: 'lock', label: 'Locks', hint: 'Which methods wait on monitors' },
];

/** What a row measures: milliseconds for elapsed time, a sample count for the others. */
function measureOf(row: ProfileRow): string {
  return row.wallMillis !== undefined ? `${row.wallMillis} ms` : `${row.samples ?? 0} samples`;
}

type State =
  | { kind: 'idle' }
  | { kind: 'recording' }
  | { kind: 'failed'; why: string }
  | { kind: 'done'; result: ProfileResult };

/** The profile page: record the running program for some seconds, read the ranking, click a method to open its source. */
export function ProfileView({ source }: { source: ProfileSource }) {
  const [seconds, setSeconds] = useState(5);
  const [dimension, setDimension] = useState('cpu');
  const [state, setState] = useState<State>({ kind: 'idle' });

  const record = (): void => {
    setState({ kind: 'recording' });
    source.sample({ seconds, dimension }).then(
      result => setState({ kind: 'done', result }),
      (e: unknown) => setState({ kind: 'failed', why: e instanceof Error ? e.message : String(e) }),
    );
  };

  return (
    <div className="profile">
      <div className="profile-controls">
        <label title="How long the program is recorded">
          Seconds
          <input type="number" min={1} max={30} value={seconds} onChange={e => setSeconds(Math.min(30, Math.max(1, Number(e.target.value) || 1)))} />
        </label>
        <label title="What the ranking measures">
          Measure
          <select value={dimension} onChange={e => setDimension(e.target.value)}>
            {DIMENSIONS.map(d => <option key={d.value} value={d.value} title={d.hint}>{d.label}</option>)}
          </select>
        </label>
        <button type="button" className="profile-record" disabled={state.kind === 'recording'} onClick={record}>
          {state.kind === 'recording' ? `Recording ${seconds} s…` : 'Record'}
        </button>
      </div>
      {state.kind === 'failed' && <div className="profile-failed" role="alert">{state.why}</div>}
      {state.kind === 'idle' && <div className="profile-empty">Record the running program to see where its time goes.</div>}
      {state.kind === 'done' && (state.result.rows.length === 0
        ? <div className="profile-empty">The recording found no methods.</div>
        : (
          <table className="profile-rows">
            <thead><tr><th>Method</th><th>Measured</th><th>Share</th></tr></thead>
            <tbody>
              {state.result.rows.map(row => (
                <tr key={row.symbol} className="profile-row">
                  <td>
                    {row.location
                      ? <button type="button" className="profile-open" title="Open this method's source" onClick={() => source.open(row.location!)}>{row.symbol}</button>
                      : <span className="profile-nosource" title="This method has no source in the workspace">{row.symbol}</span>}
                  </td>
                  <td>{measureOf(row)}</td>
                  <td><span className="profile-bar" style={{ width: `${Math.round(row.sharePercent ?? 0)}%` }} />{row.sharePercent !== undefined ? `${Math.round(row.sharePercent)}%` : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ))}
    </div>
  );
}
