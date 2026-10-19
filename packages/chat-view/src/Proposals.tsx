import type { ProposalView, ViewIntent, ViewState } from '@jawata/chat-core';
import { Diff } from './Messages.js';

/** The choices a proposal is answered with: the one that allows once, the one that rejects once. If the agent offered neither, all it offered. */
function choicesOf(proposal: ProposalView): { optionId: string; label: string; title: string }[] {
  const accept = proposal.options.find(o => o.kind === 'allow_once');
  const reject = proposal.options.find(o => o.kind === 'reject_once');
  if (!accept && !reject) { return proposal.options.map(o => ({ optionId: o.optionId, label: o.name, title: o.name })); }
  return [
    ...(accept ? [{ optionId: accept.optionId, label: 'Accept', title: `The agent makes this change (it offered this as "${accept.name}")` }] : []),
    ...(reject ? [{ optionId: reject.optionId, label: 'Reject', title: `The agent does not make this change (it offered this as "${reject.name}")` }] : []),
  ];
}

/** The changes the agent proposes and waits on, each as a diff to accept or reject. Nothing else asks the person anything. */
export function Proposals({ state, send }: { state: ViewState; send: (intent: ViewIntent) => void }) {
  if (state.proposals.length === 0) { return null; }
  return (
    <div className="proposals" role="group" aria-label="Proposed changes">
      {state.proposals.map(p => (
        <div className="proposal" key={p.requestId} data-request-id={p.requestId}>
          <div className="proposal-title" title="The agent waits for your answer before it makes this change">{p.title}</div>
          {p.diffs.map((d, i) => <Diff key={i} path={d.path} oldText={d.oldText} newText={d.newText} />)}
          <div className="proposal-choices">
            {choicesOf(p).map(c => (
              <button key={c.optionId} className={'proposal-choice ' + c.label.toLowerCase()} title={c.title}
                onClick={() => send({ type: 'answerPermission', requestId: p.requestId, optionId: c.optionId })}>{c.label}</button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
