import { useState } from 'react';
import { isWorking, workingTree } from '@jawata/chat-core/view';
import type { HireView, ViewIntent, ViewState } from '@jawata/chat-core/view';

/** Elapsed time as the person reads it: seconds under a minute, then minutes and seconds. */
const elapsed = (ms: number): string => {
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
};
const tokensOf = (n: number): string => (n < 1000 ? String(n) : `${(n / 1000).toFixed(1)}k`);
const costOf = (usd: number): string => `$${usd < 0.01 ? usd.toFixed(3) : usd.toFixed(2)}`;

const STATE_WORDS: Record<string, string> = {
  running: 'The agent is working.',
  compacting: 'The agent is shortening its own conversation so it can go on.',
  done: 'The agent has finished.',
  failed: 'The agent ended with a failure.',
};

/** The brain and model of one agent as a control: clicking it shows what the agent offers, and the one picked replaces this agent's. */
function BrainPicker({ hire, state, send, open, onToggle }: { hire: HireView; state: ViewState; send: (intent: ViewIntent) => void; open: boolean; onToggle: () => void }) {
  const label = `${hire.brain} · ${hire.model}`;
  return (
    <span className="brain-wrap">
      <button className="brain-btn" aria-haspopup="listbox" aria-expanded={open}
        title="The program and model that do the work. Click to choose another; your choice replaces this one." onClick={onToggle}>{label + ' ▾'}</button>
      {open ? (
        <div className="brain-menu" role="listbox" aria-label={`Brain for ${hire.seat}`}>
          <div className="brain-menu-head">{`Brain for ${hire.seat}`}</div>
          {state.brains === null ? <div className="brain-menu-wait">Loading…</div> : state.brains.map(b => {
            const current = b.brain === hire.brain && b.model === hire.model;
            return (
              <div className="brain-item" role="option" aria-selected={current} tabIndex={0} key={`${b.brain}/${b.model}`}
                onClick={() => { onToggle(); if (!current) { send({ type: 'chooseBrain', planId: hire.planId, brain: b.brain, model: b.model }); } }}
                onKeyDown={e => { if (e.key === 'Enter') { (e.currentTarget as HTMLElement).click(); } }}>
                <span className="brain-check">{current ? '✓' : ''}</span>{`${b.brain} · ${b.model}`}
              </div>
            );
          })}
        </div>
      ) : null}
    </span>
  );
}

function Row({ hire, depth, state, send, unfolded, onFold, menuOpen, onMenu }: {
  hire: HireView; depth: number; state: ViewState; send: (intent: ViewIntent) => void;
  unfolded: boolean; onFold: () => void; menuOpen: boolean; onMenu: () => void;
}) {
  const turns = unfolded ? state.transcripts[hire.planId] : undefined;
  return (
    <div className={'hire ' + hire.state} data-plan-id={hire.planId} data-depth={depth} style={{ marginLeft: `${depth * 16}px` }}>
      <div className={'hire-row ' + hire.state}>
        <button className="hire-fold" aria-expanded={unfolded} aria-label={`Show or fold what ${hire.seat} said`}
          title="Show or fold what this agent and its program said. You cannot type into it." onClick={onFold}>{unfolded ? '▾' : '▸'}</button>
        <span className="hire-seat" title={hire.seatCommand ? `The role this agent plays. Type ${hire.seatCommand} in a message to use the same role yourself.` : 'The role this agent plays'}>
          {hire.seat}{hire.seatCommand ? <> <span className="hire-cmd">{`(${hire.seatCommand})`}</span></> : null}
        </span>
        <BrainPicker hire={hire} state={state} send={send} open={menuOpen} onToggle={onMenu} />
        <span className="hire-state" title={STATE_WORDS[hire.state] ?? hire.state}>{hire.state}</span>
        <span className="hire-time" title="How long this agent has been at it">{elapsed(hire.elapsedMs)}</span>
        <span className="hire-tokens" title="Tokens this agent has used so far">{tokensOf(hire.tokens)} tokens</span>
        {hire.costUsd !== undefined
          ? <span className="hire-cost" title="What this agent reports it has cost, in US dollars at API prices. On a subscription nothing is charged for it.">{costOf(hire.costUsd)}</span>
          : null}
        {isWorking(hire)
          ? <button className="hire-stop" title="Ends this agent. The other agents go on." onClick={() => send({ type: 'stopHire', planId: hire.planId })}>Stop</button>
          : null}
      </div>
      {hire.task ? <div className="hire-task" title={hire.task}>{hire.task}</div> : null}
      {unfolded ? (
        <div className="hire-transcript" role="log" aria-label="Transcript, read only" title="Read only">
          {turns === undefined ? <div className="hire-transcript-wait">Loading…</div>
            : turns.length === 0 ? <div className="hire-transcript-empty" title="Nothing this agent said has been stored.">No talk recorded for this agent.</div>
            : turns.map((t, i) => <div className={'hire-turn ' + t.role} key={i}><span className="hire-role">{t.role}</span> {t.text}</div>)}
        </div>
      ) : null}
    </div>
  );
}

/**
 * The Agent Control panel: the agents that work, as the tree they were hired in (a pm, the chief engineers under it, the developers under
 * those), always shown. Each agent's talk is folded until asked for, and its brain is a control that replaces it. Nothing here is typed into.
 */
export function AgentsBar({ state, send }: { state: ViewState; send: (intent: ViewIntent) => void }) {
  const [unfolded, setUnfolded] = useState<Record<string, boolean>>({});
  const [menu, setMenu] = useState<string | null>(null);
  const rows = workingTree(state.hires);
  const working = state.hires.filter(isWorking).length;
  const finished = state.hires.length - working;
  const fold = (planId: string) => {
    const opening = !unfolded[planId];
    setUnfolded(u => ({ ...u, [planId]: opening }));
    if (opening) { send({ type: 'openTranscript', planId }); }
  };
  const toggleMenu = (planId: string) => {
    if (menu === planId) { setMenu(null); return; }
    setMenu(planId);
    if (state.brains === null) { send({ type: 'listBrains' }); }
  };
  return (
    <div className="agents">
      <div className="agents-title" title="The agents of this conversation. The numbers are what the agent last reported.">
        {working === 1 ? '1 agent working' : `${working} agents working`}{finished > 0 ? ` · ${finished} finished` : ''}
      </div>
      {rows.length === 0 ? <div className="agents-none">No agents are working.</div> : null}
      {rows.map(({ hire, depth }) => (
        <Row key={hire.planId} hire={hire} depth={depth} state={state} send={send}
          unfolded={!!unfolded[hire.planId]} onFold={() => fold(hire.planId)} menuOpen={menu === hire.planId} onMenu={() => toggleMenu(hire.planId)} />
      ))}
    </div>
  );
}
