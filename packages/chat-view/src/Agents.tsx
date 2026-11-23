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
  stalled: 'The agent has shown no sign of life for five minutes; the engine stops it at the second ceiling.',
  done: 'The agent has finished.',
  failed: 'The agent ended with a failure.',
};

/** The brain and model of one agent as a control. The label is what this run was started with. A pick is stored for the next hire of the seat. */
function BrainPicker({ hire, state, send, open, onToggle }: { hire: HireView; state: ViewState; send: (intent: ViewIntent) => void; open: boolean; onToggle: () => void }) {
  const label = brainName(hire.brain, hire.model);
  const stored = state.seatChoices[hire.seat];
  if (hire.state === 'done' || hire.state === 'failed') {
    return (
      <span className="brain-fixed"
        title={`The program and model this run used. The run has finished, so this cannot change it. To change what the next ${hire.seat} runs on, use the Seats page.`}>{label}</span>
    );
  }
  return (
    <span className="brain-wrap">
      <button className="brain-btn" aria-haspopup="listbox" aria-expanded={open}
        title="The program and model this run was started with. Click to choose what the next hire of this seat starts on. This run is not changed." onClick={onToggle}>{label + ' ▾'}</button>
      {open ? (
        <div className="brain-menu" role="listbox" aria-label={`Brain for ${hire.seat}`}>
          <div className="brain-menu-note">applies from the next hire of this seat</div>
          {state.brains === null ? <div className="brain-menu-wait">Loading…</div> : state.brains.map(b => {
            const current = stored !== undefined && b.brain === stored.brain && b.model === stored.model;
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

/** The level of the first hire: the principal is level 0, its "Hires" line level 1, and a hire of the principal stands at level 2. */
const HIRES_DEPTH = 2;

/**
 * What is wrong with one agent's use of jawata, and nothing when nothing is: a shell command on a .java file, a call that failed or was
 * refused, a step whose gate did not pass; a run whose calls nobody could name says so, because that is not a run that used none.
 */
function UseMark({ use }: { use: ToolUseView }) {
  const shell = use.shellOnJava.length;
  const failed = use.failed.length;
  const open = use.stepsOpen;
  const parts = [
    ...(use.observed ? [] : ['calls not observed']),
    ...(shell > 0 ? [shell === 1 ? '1 shell command on a Java file' : `${shell} shell commands on a Java file`] : []),
    ...(failed > 0 ? [`${failed} failed`] : []),
    ...(open > 0 ? [open === 1 ? '1 step with no passed gate' : `${open} steps with no passed gate`] : []),
  ];
  if (parts.length === 0) { return null; }
  return (
    <span className={'hire-use' + (shell > 0 || failed > 0 || open > 0 ? ' shell' : '')}
      title="What to look at in how this agent worked. A shell call on Java is a shell command on a .java file: the agent worked on Java without the jawata tools. A failed call is a call the engine refused or answered with an error. A step with no passed gate is a step whose check did not pass. Calls not observed means the agent's program did not name its calls, which does not mean it used no jawata tool. Unfold the agent to see each one.">
      {parts.join(' · ')}
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
      {use.stepsOpen > 0 ? (
        <div className="hire-exception" key="steps-open">
          <code className="hire-exception-command">{use.stepsOpen === 1 ? '1 step' : `${use.stepsOpen} steps`}</code>{' '}
          <span className="hire-exception-reason">— no gate passed for this step: its check failed, did not run, or was not reached</span>
        </div>
      ) : null}
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
  // The fold shows the agent's calls only: its brief is the Brief line above, and what it said is not drawn.
  const calls = (turns ?? []).filter(t => t.role === 'tool');
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
        <button className="hire-fold" aria-expanded={unfolded} aria-label={`Show or fold the calls of ${hire.seat}`}
          title="Show or fold the calls this agent made. You cannot type into it." onClick={onFold}>{unfolded ? '▾' : '▸'}</button>
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
        {hire.toolUse ? <UseMark use={hire.toolUse} /> : null}
        {hire.costUsd !== undefined
          ? <span className="hire-cost" title="What this agent reports it has cost, in US dollars at API prices. On a subscription nothing is charged for it.">{costOf(hire.costUsd)}</span>
          : null}
        {isWorking(hire)
          ? <button className="hire-stop" title="Ends this agent. The other agents go on." onClick={() => send({ type: 'stopHire', planId: hire.planId })}>Stop</button>
          : null}
      </div>
      {hire.task ? (
        <div className="hire-task" title="The first line of what this agent was asked to do">
          <span className="hire-brief-label">Brief:</span> {hire.task.trim().split('\n')[0]}
        </div>
      ) : null}
      {unfolded && hire.toolUse && (hire.toolUse.shellOnJava.length > 0 || hire.toolUse.failed.length > 0 || hire.toolUse.stepsOpen > 0) ? <ShellOnJavaList use={hire.toolUse} /> : null}
      {unfolded ? (
        <div className="hire-transcript" role="log" aria-label="Calls, read only" title="Read only">
          {turns === undefined ? <div className="hire-transcript-wait">Loading…</div>
            : turns.length > 0 && turns[0].role === 'missing' ? <div className="hire-transcript-empty hire-transcript-missing" title={turns[0].text}>This agent has no transcript for this hire.</div>
            : calls.length === 0 ? <div className="hire-transcript-empty" title="This agent has made no calls so far.">No calls recorded for this agent.</div>
            : calls.map((t, i) => <div className="hire-turn tool" key={i}>{t.text}</div>)}
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

/** Below the principal: the calls of its latest turn that made any, folded and each one line that opens. No log of earlier turns' calls is kept here. */
function PrincipalCalls({ state }: { state: ViewState }) {
  const turns = principalCalls(state);
  if (turns.length === 0) { return null; }
  const latest = turns[turns.length - 1];
  return (
    <div className="principal-calls">
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
    <div className="hire principal" data-depth={0} style={{ marginLeft: '0px' }}>
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

/** One earlier run: what the person asked, the agents it hired that have ended, and what they cost. */
interface EarlierRun { key: string; task: string; hires: HireView[]; cost: number; unreported: number }

const TASK_WORDS = 10;

/** How many earlier runs are listed before "more..." is asked for. */
const EARLIER_RUNS_SHOWN = 10;

/** The first words of a message or brief, its first line only, with an ellipsis where words were left out. */
function firstWords(text: string): string {
  const words = (text.trim().split('\n')[0] ?? '').split(/\s+/).filter(w => w.length > 0);
  return words.length > TASK_WORDS ? words.slice(0, TASK_WORDS).join(' ') + '…' : words.join(' ');
}

/**
 * The runs before the latest team, newest first: each turn that hired anyone, with the message of the person it answered and the hires under
 * them that have ended. A hire no turn of this conversation names (one a reloaded conversation brought back) forms a last run of its own.
 */
function earlierRuns(state: ViewState, team: ReadonlySet<string>): EarlierRun[] {
  const byPlan = new Map(state.hires.map(h => [h.planId, h]));
  const taken = new Set<string>(team);
  const groups: { ids: Set<string>; asked: string }[] = [];
  let asked = '';
  for (const entry of state.entries) {
    if (entry.kind === 'user') { asked = entry.text; continue; }
    if (entry.kind !== 'turn') { continue; }
    const ids = new Set<string>();
    for (const part of entry.turn.parts) {
      if (part.kind === 'tool' && part.tool.planId && byPlan.has(part.tool.planId) && !taken.has(part.tool.planId)) { ids.add(part.tool.planId); }
    }
    ids.forEach(id => taken.add(id));
    for (let grown = true; grown;) {
      grown = false;
      for (const h of state.hires) {
        if (h.parentPlanId && ids.has(h.parentPlanId) && !taken.has(h.planId)) { ids.add(h.planId); taken.add(h.planId); grown = true; }
      }
    }
    if (ids.size > 0) { groups.push({ ids, asked }); }
  }
  const unnamed = state.hires.filter(h => !taken.has(h.planId)).map(h => h.planId);
  const runs = groups.map(g => ({ ids: g.ids, asked: g.asked }));
  if (unnamed.length > 0) { runs.unshift({ ids: new Set(unnamed), asked: '' }); }
  return runs.reverse().flatMap(g => {
    const hires = state.hires.filter(h => g.ids.has(h.planId) && !isWorking(h));
    if (hires.length === 0) { return []; }
    const reported = hires.filter(h => h.costUsd !== undefined);
    return [{
      key: hires[0].planId,
      task: firstWords(g.asked) || firstWords(hires[0].task),
      hires,
      cost: reported.reduce((sum, h) => sum + (h.costUsd ?? 0), 0),
      unreported: hires.length - reported.length,
    }];
  });
}

/** The line of one earlier run: its task, its agents and what they cost; a cost nobody reported is said, never shown as zero. */
function earlierLine(run: EarlierRun): string {
  const agents = `${run.hires.length} agent${run.hires.length === 1 ? '' : 's'}`;
  const cost = run.unreported === 0 ? costOf(run.cost)
    : run.unreported === run.hires.length ? 'cost not reported'
    : `${costOf(run.cost)} and ${run.unreported} not reported`;
  return `${run.task} · ${agents} · ${cost}`;
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
  const runs = earlierRuns(state, team);
  const [openRuns, setOpenRuns] = useState<Record<string, boolean>>({});
  const [allRuns, setAllRuns] = useState(false);
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
      {rows.length > 0 ? (
        <details className="agents-hires" open={hired > 0}>
          <summary className="agents-hires-title" title="The agents the principal hired in its latest team, and the agents they hired. Open while any of them works.">{`Hires (${rows.length})`}</summary>
          {rows.map(({ hire, depth }) => (
            <Row key={hire.planId} hire={hire} depth={depth + HIRES_DEPTH} state={state} send={send}
              unfolded={!!unfolded[hire.planId]} onFold={() => fold(hire.planId)} menuOpen={menu === hire.planId} onMenu={() => toggleMenu(hire.planId)} />
          ))}
        </details>
      ) : null}
      {runs.length > 0 ? (
        <div className="agents-earlier">
          <div className="agents-earlier-title" title="Runs of this conversation before the latest team, newest first. Each line gives what you asked, how many agents it used and what they cost; open one to see its team.">Earlier</div>
          {(allRuns ? runs : runs.slice(0, EARLIER_RUNS_SHOWN)).map(run => (
            <details className="agents-earlier-run" key={run.key} open={!!openRuns[run.key]}
              onToggle={e => { const now = (e.currentTarget as HTMLDetailsElement).open; setOpenRuns(o => (!!o[run.key] === now ? o : { ...o, [run.key]: now })); }}>
              <summary title={`${run.task} — the agents of this run that have ended. A cost an agent did not report is not counted as zero.`}>{earlierLine(run)}</summary>
              {openRuns[run.key] ? workingTree(run.hires, new Set(run.hires.map(h => h.planId))).map(({ hire, depth }) => (
                <Row key={hire.planId} hire={hire} depth={depth + HIRES_DEPTH} state={state} send={send}
                  unfolded={!!unfolded[hire.planId]} onFold={() => fold(hire.planId)} menuOpen={menu === hire.planId} onMenu={() => toggleMenu(hire.planId)} />
              )) : null}
            </details>
          ))}
          {!allRuns && runs.length > EARLIER_RUNS_SHOWN
            ? <button className="agents-earlier-more" title="Show the earlier runs that are not listed." onClick={() => setAllRuns(true)}>more...</button>
            : null}
        </div>
      ) : null}
    </div>
  );
}
