import type { ViewIntent, ViewState } from '@jawata/chat-core/view';

/** A time the agent sent as the person reads it: a local date and minute; what the agent sent, if it is not a time. */
const whenIs = (sent: string): string => {
  const at = new Date(sent);
  return Number.isNaN(at.getTime()) ? sent : at.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
};

/** The sessions the agent lists, to open one: it is replayed into the chat. The list is the agent's; the chat keeps none of its own. */
export function History({ state, send, onClose }: { state: ViewState; send: (intent: ViewIntent) => void; onClose: () => void }) {
  const history = state.history;
  const current = state.session?.sessionId;
  return (
    <div className="history" role="dialog" aria-label="Past sessions">
      <div className="history-head">
        <span className="history-title" title="The sessions the agent says it has. Opening one shows its conversation again.">Past sessions</span>
        <button className="history-close" title="Close the list" onClick={onClose}>Close</button>
      </div>
      {history === null ? <div className="history-wait">Asking the agent…</div> : null}
      {history && history.sessions.length === 0 ? <div className="history-empty">The agent lists no sessions.</div> : null}
      {history?.sessions.map(s => (
        <button key={s.sessionId} className={'history-item' + (s.sessionId === current ? ' current' : '')} title={`Open this session (${s.sessionId})`}
          onClick={() => { send({ type: 'openSession', sessionId: s.sessionId }); onClose(); }}>
          <span className="history-name">{s.title || 'Untitled session'}</span>
          {s.updatedAt ? <span className="history-when" title={`When the agent last changed this session (${s.updatedAt})`}>{whenIs(s.updatedAt)}</span> : null}
        </button>
      ))}
      {history?.nextCursor ? (
        <button className="history-more" title="Ask the agent for the next sessions" onClick={() => send({ type: 'listSessions', cursor: history.nextCursor! })}>More</button>
      ) : null}
    </div>
  );
}
