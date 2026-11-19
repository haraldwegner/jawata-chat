import { useEffect, useRef, useState } from 'react';
import { isWorking, latestTeam, workingTree } from '@jawata/chat-core/view';
import type { HireView, ToolCallView, ToolUseView, ViewIntent, ViewState } from '@jawata/chat-core/view';
import { Tool } from './Calls.js';
import { PrincipalBrainPicker, principalBrainOf } from './Pickers.js';
import { useRunningSeconds } from './Working.js';

/** Elapsed time as the person reads it: seconds under a minute, then minutes and seconds. */
const elapsed = (ms: number): string => {
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
};
const tokensOf = (n: number): string => (n < 1000 ? String(n) : `${(n / 1000).toFixed(1)}k`);
const costOf = (usd: number): string => `$${usd < 0.01 ? usd.toFixed(3) : usd.toFixed(2)}`;
/** A brain's name, with its model where one is known. */
const brainName = (brain: string, model: string | undefined): string => (model ? `${brain} · ${model}` : brain);

const STATE_WORDS: Record<string, string> = {
  running: 'The agent is working.',
  compacting: 'The agent is shortening its own conversation so it can go on.',
  done: 'The agent has finished.',
  failed: 'The agent ended with a failure.',
};

/** The brain and model of one agent as a control: clicking it shows what the agent offers, and the one picked replaces this agent's. */
function BrainPicker({ hire, state, send, open, onToggle }: { hire: HireView; state: ViewState; send: (intent: ViewIntent) => void; open: boolean; onToggle: () => void }) {
  const label = brainName(hire.brain, hire.model);
  return (
    <span className="brain-wrap">
      <button className="brain-btn" aria-haspopup="listbox" aria-expanded={open}
        title="The program and model that do the work. Click to choose another; your choice replaces this one." onClick={onToggle}>{label + ' ▾'}</button>
      {open ? (
        <div className="brain-menu" role="listbox" aria-label={`Brain for ${hire.seat}`}>
          {state.brains === null ? <div className="brain-menu-wait">Loading…</div> : state.brains.map(b => {
            const current = b.brain === hire.brain && b.model === hire.model;
            return (
              <div className="brain-item" role="option" aria-selected={current} tabIndex={0} key={`${b.brain}/${b.model}`}
                onClick={() => { onToggle(); if (!current) { send({ type: 'chooseBrain', planId: hire.planId, brain: b.brain, model: b.model }); } }}
                onKeyDown={e => { if (e.key === 'Enter') { (e.currentTarget as HTMLElement).click(); } }}>
                <span className="brain-check">{current ? '✓' : ''}</span>{brainName(b.brain, b.model)}
              </div>
            );
          })}
        </div>
      ) : null}
    </span>
  );
}

const callsOf = (n: number): string => (n === 1 ? '1 call' : `${n} calls`);

/** How one agent's calls split: jawata, other and shell on Java; a run whose calls nobody could name says so and shows no figure. */
function UseFigures({ use }: { use: ToolUseView }) {
  const failed = use.failed.length > 0 ? ` · ${use.failed.length} failed` : '';
  if (!use.observed) {
    return <span className={'hire-use' + (failed ? ' shell' : '')} title="This agent's program did not name its calls, so how it used jawata is not known. It does not mean it used none.">{'calls not observed' + failed}</span>;
  }
  const shell = use.shellOnJava.length;
  return (
    <span className={'hire-use' + (shell > 0 || failed ? ' shell' : '')}
      title="How this agent's calls split. A jawata call is a call to a jawata tool. A shell call on Java is a shell command that names a .java file: the agent worked on Java without the jawata tools. A failed call is a jawata call the engine answered with an error or refused. Unfold the agent to see each one.">
      {`${callsOf(use.jawata + use.other + shell)} · ${use.jawata} jawata · ${use.other} other · ${shell} shell on Java${failed}`}
    </span>
  );
}

/**
 * The exceptions of one run, before everything else the agent said: each shell call on Java with the reason it declared, then each jawata call
 * that failed or was refused with its tool and error code.
 */
function ShellOnJavaList({ use }: { use: ToolUseView }) {
  return (
    <div className="hire-exceptions" aria-label="Shell calls on Java and failed calls"
      title="Commands this agent ran in a shell on a .java file instead of using a jawata tool (the reason is what the agent wrote in the command: jawata-fallback or jawata-author), and jawata calls the engine answered with an error or refused.">
      {use.shellOnJava.map((s, i) => (
        <div className="hire-exception" key={'shell-' + i}>
          <code className="hire-exception-command">{s.command}</code>{' '}
          <span className="hire-exception-reason">{s.declared ? `— ${s.declared}` : '— no reason declared'}</span>
        </div>
      ))}
      {use.failed.map((f, i) => (
        <div className="hire-exception" key={'failed-' + i}>
          <code className="hire-exception-command">{f.tool}</code>{' '}
          <span className="hire-exception-reason">{`— failed or refused: ${f.code}`}</span>
        </div>
      ))}
    </div>
  );
}

function Row({ hire, depth, state, send, unfolded, onFold, menuOpen, onMenu }: {
  hire: HireView; depth: number; state: ViewState; send: (intent: ViewIntent) => void;
  unfolded: boolean; onFold: () => void; menuOpen: boolean; onMenu: () => void;
}) {
  const turns = unfolded ? state.transcripts[hire.planId] : undefined;
  // The agent's own figures arrive with its tool calls, so between them the clock runs here.
  const seconds = useRunningSeconds(isWorking(hire));
  // An opened agent that works is asked again whenever its card changes, so the calls it has made so far show (28h D57 (i)); the first ask
  // is the fold's own.
  const card = `${hire.state}/${hire.elapsedMs}/${hire.tokens}`;
  const firstCard = useRef(card);
  useEffect(() => {
    if (!unfolded) { firstCard.current = card; return; }
    if (card !== firstCard.current) { firstCard.current = card; send({ type: 'openTranscript', planId: hire.planId }); }
  }, [unfolded, card, hire.planId, send]);
  return (
    <div className={'hire ' + hire.state} data-plan-id={hire.planId} data-depth={depth} style={{ marginLeft: `${depth * 16}px` }}>
      <div className={'hire-row ' + hire.state}>
        <button className="hire-fold" aria-expanded={unfolded} aria-label={`Show or fold what ${hire.seat} said`}
          title="Show or fold what this agent and its program said. You cannot type into it." onClick={onFold}>{unfolded ? '▾' : '▸'}</button>
        <span className="hire-seat" title={hire.seatCommand ? `The role this agent plays. Type ${hire.seatCommand} in a message to use the same role yourself.` : 'The role this agent plays'}>
          {hire.name ? <><span className="hire-name" title="The name this agent has in this conversation, so that several of one role can be told apart">{hire.name}</span>{' · '}</> : null}{hire.seat}{hire.seatCommand ? <> <span className="hire-cmd">{`(${hire.seatCommand})`}</span></> : null}
        </span>
        <BrainPicker hire={hire} state={state} send={send} open={menuOpen} onToggle={onMenu} />
        <span className="hire-state" title={STATE_WORDS[hire.state] ?? hire.state}>{hire.state}</span>
        <span className="hire-time" title="How long this agent has been at it">{elapsed(Math.max(hire.elapsedMs, seconds * 1000))}</span>
        {hire.tokens > 0 ? <span className="hire-tokens" title="Tokens this agent has used so far">{tokensOf(hire.tokens)} tokens</span> : null}
        {!isWorking(hire) && hire.changedFileCount !== undefined
          ? <span className="hire-files" title="How many files this agent's run changed, counted by what the files held before and after. 0 means it changed nothing, whatever it said.">{hire.changedFileCount === 1 ? '1 file changed' : `${hire.changedFileCount} files changed`}</span>
          : null}
        {hire.toolUse ? <UseFigures use={hire.toolUse} /> : null}
        {hire.costUsd !== undefined
          ? <span className="hire-cost" title="What this agent reports it has cost, in US dollars at API prices. On a subscription nothing is charged for it.">{costOf(hire.costUsd)}</span>
          : null}
        {isWorking(hire)
          ? <button className="hire-stop" title="Ends this agent. The other agents go on." onClick={() => send({ type: 'stopHire', planId: hire.planId })}>Stop</button>
          : null}
      </div>
      {hire.task ? (
        <details className="hire-task" title={hire.task}>
          <summary>{hire.task.trim().split('\n')[0]}</summary>
          <pre className="hire-task-full">{hire.task}</pre>
        </details>
      ) : null}
      {unfolded && hire.toolUse && (hire.toolUse.shellOnJava.length > 0 || hire.toolUse.failed.length > 0) ? <ShellOnJavaList use={hire.toolUse} /> : null}
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

/** The principal's tool calls, turn by turn as they were made, the conversation's first turn first. */
function principalCalls(state: ViewState): ToolCallView[][] {
  return state.entries.flatMap(e => {
    if (e.kind !== 'turn') { return []; }
    const calls = e.turn.parts.flatMap(p => (p.kind === 'tool' ? [p.tool] : []));
    return calls.length > 0 ? [calls] : [];
  });
}

const countOf = (n: number): string => `${n} tool call${n === 1 ? '' : 's'}`;

/** Below the principal: the calls of its latest turn that made any, folded and each one line that opens; the earlier turns' calls folded above them. */
function PrincipalCalls({ state }: { state: ViewState }) {
  const turns = principalCalls(state);
  if (turns.length === 0) { return null; }
  const latest = turns[turns.length - 1];
  const earlier = turns.slice(0, -1).flat();
  return (
    <div className="principal-calls">
      {earlier.length > 0 ? (
        <details className="principal-calls-earlier">
          <summary title="The calls the principal made in this conversation before its latest turn, in order">{`Earlier: ${countOf(earlier.length)}`}</summary>
          {earlier.map(t => <Tool tool={t} key={t.toolCallId} />)}
        </details>
      ) : null}
      <details className="principal-calls-latest">
        <summary className="principal-calls-title" title="The calls the principal made in its latest turn; a click shows them">{countOf(latest.length)}</summary>
        {latest.map(t => <Tool tool={t} key={t.toolCallId} />)}
      </details>
    </div>
  );
}

/** The principal, from the moment a message is sent: its brain is a control, and a change holds from the next message. */
function PrincipalRow({ state, send, menuOpen, onMenu }: { state: ViewState; send: (intent: ViewIntent) => void; menuOpen: boolean; onMenu: () => void }) {
  const seconds = useRunningSeconds(state.processing);
  const brain = principalBrainOf(state.session);
  return (
    <div className="hire principal">
      <div className={'hire-row' + (state.processing ? ' running' : '')}>
        <span className="hire-seat" title="jawata itself: it reads your message and hands the work to the other agents.">principal <span className="hire-cmd">/main</span></span>
        {state.processing ? <span className="hire-state" title={STATE_WORDS.running}>running</span> : <span className="hire-state" title="The principal is waiting for your next message.">waiting for you</span>}
        {state.processing ? <span className="hire-time" title="How long the principal has been at this message">{elapsed(seconds * 1000)}</span> : null}
        {brain ? <PrincipalBrainPicker brain={brain} open={menuOpen} onToggle={onMenu} send={send} /> : null}
      </div>
      <PrincipalCalls state={state} />
    </div>
  );
}

/**
 * The Agent Control panel: always shown, the principal from the moment a message is sent, and the agents that work as the tree they were
 * hired in. Each agent's talk is folded until asked for, and its brain is a control that replaces it. Nothing here is typed into.
 */
export function AgentsPanel({ state, send }: { state: ViewState; send: (intent: ViewIntent) => void }) {
  const [unfolded, setUnfolded] = useState<Record<string, boolean>>({});
  const [menu, setMenu] = useState<string | null>(null);
  const team = latestTeam(state);
  const rows = workingTree(state.hires, team);
  const earlier = state.hires.filter(h => !isWorking(h) && !team.has(h.planId)).length;
  const hired = state.hires.filter(isWorking).length;
  const working = hired + (state.processing ? 1 : 0);
  const finished = state.hires.length - hired;
  const fold = (planId: string) => {
    const opening = !unfolded[planId];
    setUnfolded(u => ({ ...u, [planId]: opening }));
    if (opening) { send({ type: 'openTranscript', planId }); }
  };
  const toggleMenu = (planId: string) => {
    if (menu === planId) { setMenu(null); return; }
    setMenu(planId);
    send({ type: 'listBrains' }); // asked each time the list opens: a brain the agent gained since shows
  };
  return (
    <div className="agents agents-panel">
      <div className="agents-title" title="The agents of this conversation. The numbers are what the agent last reported.">
        {working === 1 ? '1 agent working' : `${working} agents working`}{finished > 0 ? ` · ${finished} finished` : ''}
      </div>
      {!state.session && !state.processing && rows.length === 0 ? <div className="agents-none">No agents are working.</div> : null}
      {state.session || state.processing ? <PrincipalRow state={state} send={send} menuOpen={menu === 'principal'} onMenu={() => setMenu(m => (m === 'principal' ? null : 'principal'))} /> : null}
      {rows.map(({ hire, depth }) => (
        <Row key={hire.planId} hire={hire} depth={depth} state={state} send={send}
          unfolded={!!unfolded[hire.planId]} onFold={() => fold(hire.planId)} menuOpen={menu === hire.planId} onMenu={() => toggleMenu(hire.planId)} />
      ))}
      {earlier > 0 ? <div className="agents-earlier" title="Agents hired in earlier turns of this conversation that have ended. The latest team stays listed above.">{`Earlier: ${earlier} agent${earlier === 1 ? '' : 's'} finished`}</div> : null}
    </div>
  );
}
