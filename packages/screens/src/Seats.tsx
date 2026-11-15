import { useCallback, useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import {
  BRAIN_HINT, brainOptions, CONVERSATION_BRAIN_HINT, firstSentence, invocationHint, isConversation, onHint, probeSentence, RESET_HINT,
  seatGroups, seatName, WHEN_HINT,
} from './seats-model.js';
import type { BrainStatus, ProbeResult, SeatRow, SeatsState } from './seats-model.js';
import type { ScreenProps } from './screen.js';
import type { Json } from './port.js';

const message = (error: unknown): string => error instanceof Error ? error.message : String(error);

/**
 * Which seats are on and which brain each one runs on (Sprint 28k, Amendment 3, Stage 25j). Every change is held by the host until the page's
 * Apply and dropped by its Cancel; the host's answer is the seats as they would be, so what the page shows is what Apply would store.
 */
export function Seats({ port, handle }: ScreenProps): ReactElement {
  const [state, setState] = useState<SeatsState | null>(null);
  const [brains, setBrains] = useState<readonly BrainStatus[] | null>(null);
  const [loadError, setLoadError] = useState('');
  const [actionError, setActionError] = useState('');
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState<Readonly<Record<string, boolean>>>({});
  const [lastTest, setLastTest] = useState<Readonly<Record<string, ProbeResult>>>({});

  /** The brains are asked after the list is shown, so a slow program never holds the page; the last answer stays shown meanwhile. */
  const readBrains = useCallback((): void => {
    port.brainsStatus([]).then(answer => { setBrains(answer as unknown as BrainStatus[]); }, (error: unknown) => {
      setBrains(now => now ?? []);
      setActionError(`brain check: ${message(error)}`);
    });
  }, [port]);

  /** A fresh reading of the seats and of the brains, as the page opens and each time it is focused. */
  const refresh = useCallback(async (): Promise<void> => {
    readBrains();
    try {
      setState(await port.seatsView() as unknown as SeatsState);
      setLoadError('');
    } catch (error) {
      setLoadError(message(error));
    }
  }, [port, readBrains]);

  useEffect(() => {
    handle.refresh = refresh;
    void refresh();
  }, [handle, refresh]);

  const change = async (seat: SeatRow, proposed: Json): Promise<void> => {
    setBusy(true);
    setActionError('');
    try {
      setState(await port.seatChange(seat.name, proposed) as unknown as SeatsState);
    } catch (error) {
      setActionError(`${seat.name}: ${message(error)}`);
    } finally {
      setBusy(false);
    }
  };

  /** Test first, hold only if the brain answered: a choice that cannot run is never kept for Apply. */
  const chooseBrain = async (seat: SeatRow, value: string): Promise<void> => {
    const [brain, model] = value.split('|');
    setTesting(now => ({ ...now, [seat.name]: true }));
    try {
      const result = await port.brainProbe(brain, isConversation(seat) || !model ? null : model) as unknown as ProbeResult;
      setLastTest(now => ({ ...now, [seat.name]: result }));
      if (result.ok) { await change(seat, { setting: 'brain', brain, model: model || null }); }
    } catch (error) {
      setActionError(`${seat.name}: ${message(error)}`);
    } finally {
      setTesting(now => ({ ...now, [seat.name]: false }));
    }
  };

  if (loadError && !state) { return <p className="screen-error">Could not read the seats: {loadError}</p>; }
  if (!state) { return <p>Loading seats…</p>; }

  const labelOf = (id: string): string => brains?.find(one => one.id === id)?.label ?? id;
  return (
    <div className="screen">
      {loadError ? <p className="screen-error">Could not read the seats: {loadError}</p> : null}
      {actionError ? <p className="screen-error">{actionError}</p> : null}
      {state.errors.map(error => <p key={error} className="screen-error">{error}</p>)}
      {seatGroups(state).map(group => (
        <section key={group.title} className="seat-group">
          <h3 title={group.hint}>{group.title}</h3>
          {group.seats.map(seat => {
            const status = brains?.find(one => one.id === seat.brain);
            const test = lastTest[seat.name];
            const brainHint = isConversation(seat) ? CONVERSATION_BRAIN_HINT : BRAIN_HINT;
            return (
              <div key={seat.name} className={seat.on ? 'seat-line' : 'seat-line seat-off'}>
                {seat.command
                  ? (
                    <label className="screen-check seat-on" title={onHint(seat)}>
                      <input type="checkbox" checked={seat.on} disabled={busy}
                        onChange={event => { void change(seat, { setting: 'enabled', value: event.currentTarget.checked }); }} />
                      <span>On</span>
                    </label>
                  )
                  : <span className="seat-on" />}
                <details className="screen-fold seat-row">
                  <summary>
                    <span className="seat-name" title={invocationHint(seat)}>{seatName(seat)}</span>
                    <span className="seat-first">{firstSentence(seat.purpose)}</span>
                  </summary>
                  <p>{seat.purpose}</p>
                  <dl className="seat-facts">
                    <dt title={WHEN_HINT}>When</dt>
                    <dd title={WHEN_HINT}>{seat.when}</dd>
                    <dt title={brainHint}>Brain</dt>
                    <dd title={brainHint}>
                      {brains === null
                        ? 'checking which brains this machine has…'
                        : (
                          <select className="seat-brain" value={`${seat.brain}|${seat.model ?? ''}`} disabled={busy || testing[seat.name] === true}
                            onChange={event => { void chooseBrain(seat, event.currentTarget.value); }}>
                            {brainOptions(seat, brains).map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                          </select>
                        )}
                      {testing[seat.name] ? <span className="seat-note">Testing — one word through the brain…</span> : null}
                      {!testing[seat.name] && test ? <span className={test.ok ? 'seat-note' : 'seat-note screen-error'}>{probeSentence(test, labelOf(test.brain))}</span> : null}
                      {!testing[seat.name] && test && !test.ok
                        ? <span className="seat-note">To log in, run <code>{test.loginCommand}</code> in a terminal, then choose it again. The previous choice is kept.</span>
                        : null}
                      {!test && status && status.installed && status.login === 'notLoggedIn'
                        ? (
                          <>
                            <span className="seat-note screen-error">{status.label} is not logged in: {status.reason}</span>
                            <span className="seat-note">To log in, run <code>{status.loginCommand}</code> in a terminal, then open this page again.</span>
                          </>
                        )
                        : null}
                      {!test && status && !status.installed ? <span className="seat-note screen-error">{status.reason}</span> : null}
                    </dd>
                  </dl>
                  {seat.customised
                    ? <button type="button" disabled={busy} title={RESET_HINT} onClick={() => { void change(seat, { setting: 'reset' }); }}>Reset to shipped</button>
                    : null}
                </details>
              </div>
            );
          })}
        </section>
      ))}
    </div>
  );
}
