import { useCallback, useEffect, useState } from 'react';
import type { DragEvent, MouseEvent, ReactElement } from 'react';
import {
  BACK_HINT, boxTitle, canDrop, FAILS_HINT, failureTargets, FOLD_HINT, hasKids, helpers, HELPERS_HINT, LOCK_HINT, nextRole, parts, placedSeats,
  REFUSAL_HINT, ROLE_HINT, SEAT_BACK_HINT, TOP, TOP_HINT,
} from './workflow-model.js';
import type { WorkflowRow, WorkflowState } from './workflow-model.js';
import type { ScreenProps } from './screen.js';
import type { Json } from './port.js';

const message = (error: unknown): string => error instanceof Error ? error.message : String(error);

/**
 * Who hires whom, as an org chart (Sprint 28k, Amendment 3, Stage 25j). Locked by default. Unlocked, a seat dragged onto another moves with
 * everything under it, a click on the role changes the role and a right-click says where its failures go. Every change is held by the host
 * until the page's Apply; a move the engine would refuse comes back with the engine's reason and the chart stays as it was.
 */
export function Workflow({ port, handle }: ScreenProps): ReactElement {
  const [state, setState] = useState<WorkflowState | null>(null);
  const [loadError, setLoadError] = useState('');
  const [actionError, setActionError] = useState('');
  const [busy, setBusy] = useState(false);
  const [unlocked, setUnlocked] = useState(false);
  const [folded, setFolded] = useState<Readonly<Record<string, boolean>>>({});
  const [dragged, setDragged] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ row: WorkflowRow; x: number; y: number } | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    try {
      setState(await port.workflowView() as unknown as WorkflowState);
      setLoadError('');
    } catch (error) {
      setLoadError(message(error));
    }
  }, [port]);

  useEffect(() => {
    handle.refresh = refresh;
    void refresh();
    const close = (): void => { setMenu(null); };
    window.addEventListener('click', close);
    return () => { window.removeEventListener('click', close); };
  }, [handle, refresh]);

  const change = async (row: WorkflowRow, proposed: Json): Promise<void> => {
    setBusy(true);
    setActionError('');
    try {
      setState(await port.seatChange(row.name, proposed) as unknown as WorkflowState);
    } catch (error) {
      // the engine's reasons for a placement that would break the tree; nothing was held and the chart stays as it was
      setActionError(message(error));
    } finally {
      setBusy(false);
    }
  };

  const place = (row: WorkflowRow, patch: { parent?: string; role?: string; escalatesTo?: string | null }): Promise<void> => {
    const next = { parent: row.parent, role: row.role, escalatesTo: row.escalatesTo, ...patch };
    return change(row, { setting: 'workflow', parent: next.parent, role: next.role, escalatesTo: next.escalatesTo === '' ? null : next.escalatesTo });
  };

  if (loadError && !state) { return <p className="screen-error">Could not read the workflow: {loadError}</p>; }
  if (!state) { return <p>Loading the workflow…</p>; }

  const seats = placedSeats(state);
  const anyPlaced = seats.some(row => row.placed);

  const drop = (target: string): void => {
    setOver(null);
    const row = seats.find(seat => seat.name === dragged);
    setDragged(null);
    if (row && canDrop(row.name, target, seats)) { void place(row, { parent: target }); }
  };
  const dropTarget = (target: string) => ({
    onDragOver: (event: DragEvent) => { if (unlocked && dragged) { event.preventDefault(); setOver(target); } },
    onDragLeave: () => { setOver(null); },
    onDrop: (event: DragEvent) => { event.preventDefault(); drop(target); },
  });
  const openMenu = (event: MouseEvent, row: WorkflowRow): void => {
    event.preventDefault();
    if (unlocked) { setMenu({ row, x: event.clientX, y: event.clientY }); }
  };
  const backToDefault = async (): Promise<void> => {
    for (const row of seats.filter(seat => seat.placed)) { await change(row, { setting: 'workflowDefault' }); }
  };

  const box = (row: WorkflowRow): ReactElement => (
    <div key={row.name} className={['wf-box', row.placed ? 'wf-changed' : '', over === row.name ? 'wf-over' : ''].join(' ').trim()}
      draggable={unlocked} role="treeitem" aria-selected="false" title={boxTitle(row)}
      onContextMenu={event => { openMenu(event, row); }} onDragStart={() => { setDragged(row.name); }} {...dropTarget(row.name)}>
      <span className="wf-name">{row.name}</span>
      <button className="wf-role" type="button" disabled={!unlocked || busy} title={ROLE_HINT}
        onClick={() => { void place(row, { role: nextRole(row.role) }); }}>{row.role}</button>
      {hasKids(row.name, seats)
        ? <button className="wf-fold" type="button" title={FOLD_HINT}
          onClick={() => { setFolded(now => ({ ...now, [row.name]: !now[row.name] })); }}>{folded[row.name] ? '▸' : '▾'}</button>
        : null}
    </div>
  );
  const children = (parent: string): ReactElement | null => {
    const below = parts(parent, seats, folded);
    if (below.branches.length === 0 && below.leaves.length === 0) { return null; }
    return (
      <ul>
        {below.branches.map(row => <li key={row.name}>{box(row)}{children(row.name)}</li>)}
        {below.leaves.length > 0 ? <li><div className="wf-stack">{below.leaves.map(box)}</div></li> : null}
      </ul>
    );
  };

  return (
    <div className="screen">
      <div className="screen-actions">
        {unlocked && anyPlaced ? <button type="button" disabled={busy} title={BACK_HINT} onClick={() => { void backToDefault(); }}>Back to default</button> : null}
        <button type="button" className={unlocked ? 'wf-unlocked' : ''} title={LOCK_HINT} onClick={() => { setUnlocked(now => !now); }}>
          {unlocked ? 'Unlocked' : 'Locked'}
        </button>
      </div>
      {loadError ? <p className="screen-error">Could not read the workflow: {loadError}</p> : null}
      {actionError ? <p className="screen-error">{actionError}</p> : null}
      {state.errors.map(error => <p key={error} className="screen-error">{error}</p>)}
      {state.refusals.map(refusal => <p key={refusal} className="screen-error" title={REFUSAL_HINT}>{refusal}</p>)}
      <div className="wf-frame">
        <div className={unlocked ? 'wf-org wf-org-unlocked' : 'wf-org'} role="tree">
          <ul>
            <li>
              <div className="wf-root">
                <div className={over === TOP ? 'wf-box wf-over' : 'wf-box'} role="treeitem" aria-selected="false" title={TOP_HINT} {...dropTarget(TOP)}>
                  <span className="wf-name">{TOP}</span>
                </div>
                {helpers(state).length > 0
                  ? (
                    <div className="wf-helpers">
                      <span className="wf-label" title={HELPERS_HINT}>Helpers</span>
                      {helpers(state).map(row => <span key={row.name} className="wf-helper" title={row.helper ?? ''}>{row.command ? `/${row.command}` : row.name}</span>)}
                    </div>
                  )
                  : null}
              </div>
              {children(TOP)}
            </li>
          </ul>
        </div>
      </div>
      {menu
        ? (
          <div className="wf-menu" role="menu" style={{ left: `${menu.x}px`, top: `${menu.y}px` }} onClick={event => { event.stopPropagation(); }}>
            <div title={FAILS_HINT}>If {menu.row.name} fails, goes to</div>
            <select value={menu.row.escalatesTo ?? ''} disabled={busy}
              onChange={event => { const row = menu.row; const target = event.currentTarget.value; setMenu(null); void place(row, { escalatesTo: target }); }}>
              <option value="">nowhere</option>
              {failureTargets(menu.row, state.rows).map(name => <option key={name} value={name}>{name}</option>)}
            </select>
            {menu.row.placed
              ? <button type="button" title={SEAT_BACK_HINT} onClick={() => { const row = menu.row; setMenu(null); void change(row, { setting: 'workflowDefault' }); }}>Back to default</button>
              : null}
          </div>
        )
        : null}
    </div>
  );
}
