import { useState } from 'react';
import { isWorking } from '@jawata/chat-core';
import type { HireView, ViewIntent, ViewState } from '@jawata/chat-core';

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

function Row({ hire, shown, send, onToggle }: { hire: HireView; shown: boolean; send: (intent: ViewIntent) => void; onToggle: () => void }) {
  return (
    <div className={'hire-row ' + hire.state} data-plan-id={hire.planId}>
      <span className="hire-seat" title="The seat that was hired for this work">{hire.seat}</span>
      <span className="hire-who" title="The program and the model that do the work for this seat">{hire.brain} · {hire.model}</span>
      <span className="hire-state" title={STATE_WORDS[hire.state] ?? hire.state}>{hire.state}</span>
      <span className="hire-time" title="How long this agent has been at it">{elapsed(hire.elapsedMs)}</span>
      <span className="hire-tokens" title="Tokens this agent has used so far">{tokensOf(hire.tokens)} tokens</span>
      <span className="hire-cost" title="What this agent has cost so far, in US dollars">{costOf(hire.costUsd)}</span>
      {isWorking(hire)
        ? <button className="hire-stop" title="Ends this agent. The other agents go on." onClick={() => send({ type: 'stopHire', planId: hire.planId })}>Stop</button>
        : null}
      <button className="hire-transcript-btn" title="Read what this agent and its program said. You cannot type into it." onClick={onToggle}>{shown ? 'Hide' : 'Transcript'}</button>
    </div>
  );
}

/** The agents hired in this conversation: how many work, one row each, and a transcript to read. Nothing here is typed into. */
export function AgentsBar({ state, send }: { state: ViewState; send: (intent: ViewIntent) => void }) {
  const [shown, setShown] = useState<string | null>(null);
  if (state.hires.length === 0) { return null; }
  const working = state.hires.filter(isWorking).length;
  const finished = state.hires.length - working;
  const toggle = (planId: string) => {
    if (shown === planId) { setShown(null); return; }
    setShown(planId);
    send({ type: 'openTranscript', planId });
  };
  const turns = shown ? state.transcripts[shown] : undefined;
  return (
    <div className="agents">
      <div className="agents-title" title="The agents hired in this conversation, as the agent last said about each">
        {working === 1 ? '1 agent working' : `${working} agents working`}{finished > 0 ? ` · ${finished} finished` : ''}
      </div>
      {state.hires.map(h => <Row key={h.planId} hire={h} shown={shown === h.planId} send={send} onToggle={() => toggle(h.planId)} />)}
      {shown ? (
        <div className="hire-transcript" role="log" aria-label="Transcript, read only" title="Read only">
          {turns === undefined ? <div className="hire-transcript-wait">Loading…</div> : turns.map((t, i) => (
            <div className={'hire-turn ' + t.role} key={i}><span className="hire-role">{t.role}</span> {t.text}</div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
