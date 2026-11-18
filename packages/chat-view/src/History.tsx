import { useEffect, useRef, useState } from 'react';
import type { ViewIntent, ViewState } from '@jawata/chat-core/view';
import { copyText } from './copy.js';
import { useEscape } from './escape.js';
import { whenIs } from './when.js';

/** How long "Copied" stays where the id was, in milliseconds. */
const COPIED_SHOWN_MS = 1500;

/**
 * What the id on a row identifies, for its hover. Only a Claude Code session's id is the one `claude --resume` takes (the id Claude Code gave
 * the session); the id of any other client's conversation is the one jawata recorded it under, and the hover says so rather than promise a resume.
 */
function idMeaning(client: string | null | undefined, clientName: string | null | undefined): string {
  if (client === 'claude-code') {
    return 'Click to copy the full session id. It is the id Claude Code knows this session by, for claude --resume.';
  }
  return `Click to copy the full session id. It is the id jawata recorded this ${clientName ?? client ?? ''} conversation under; the client's own resume command may not take it.`.replace('  ', ' ');
}

/**
 * The sessions the agent lists, to open one: it is replayed into the chat. The list is the agent's; the chat keeps none of its own.
 * Each row reads at a glance (his ruling 2026-11-18): the client's full name in one width for every row, the title, the first 8 characters of
 * the session id, and the date chosen by distance. The hover carries the full title, the full id and the exact time; a click on the id copies
 * the full id (for resuming it in the client that wrote it) and a click anywhere else on the row opens the session.
 */
export function History({ state, send, onClose }: { state: ViewState; send: (intent: ViewIntent) => void; onClose: () => void }) {
  const history = state.history;
  const current = state.session?.sessionId;
  const [copied, setCopied] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) { clearTimeout(timer.current); } }, []);
  useEscape(true, onClose); // Esc closes the panel; a click beside it does not, it has its own Close (his ruling 2026-11-18)
  const longest = Math.max(0, ...(history?.sessions ?? []).map(s => (s.clientName ?? s.client ?? '').length));
  const open = (sessionId: string) => { send({ type: 'openSession', sessionId }); onClose(); };
  const copyId = (sessionId: string) => {
    void copyText(sessionId).then(done => {
      if (!done) { return; }
      setCopied(sessionId);
      if (timer.current) { clearTimeout(timer.current); }
      timer.current = setTimeout(() => setCopied(null), COPIED_SHOWN_MS);
    });
  };
  return (
    <div className="history" role="dialog" aria-label="Past sessions" style={longest > 0 ? { ['--history-client-width' as string]: `${longest}ch` } : undefined}>
      <div className="history-head">
        <span className="history-title" title="The sessions the agent says it has. Opening one shows its conversation again.">Past sessions</span>
        <button className="history-close" title="Close the list" onClick={onClose}>Close</button>
      </div>
      {history === null ? <div className="history-wait">Asking the agent…</div> : null}
      {history && history.sessions.length === 0 ? <div className="history-empty">The agent lists no sessions.</div> : null}
      {history?.sessions.map(s => (
        <div key={s.sessionId} role="button" tabIndex={0} className={'history-item' + (s.sessionId === current ? ' current' : '')}
          title={['Open this session', s.title || 'Untitled session', s.sessionId, s.updatedAt ?? ''].filter(Boolean).join('\n')}
          onClick={() => open(s.sessionId)}
          onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(s.sessionId); } }}>
          <span className="history-client" title="The client this conversation was had in">{s.clientName ?? s.client ?? ''}</span>
          <span className="history-name">{s.title || 'Untitled session'}</span>
          <span className="history-id" title={idMeaning(s.client, s.clientName)}
            onClick={e => { e.stopPropagation(); copyId(s.sessionId); }}>{copied === s.sessionId ? 'Copied' : s.sessionId.slice(0, 8)}</span>
          <span className="history-when" title={s.updatedAt ? `When the agent last changed this session (${s.updatedAt})` : undefined}>{s.updatedAt ? whenIs(s.updatedAt) : ''}</span>
        </div>
      ))}
      {history?.nextCursor ? (
        <button className="history-more" title="Ask the agent for the next sessions" onClick={() => send({ type: 'listSessions', cursor: history.nextCursor! })}>Show more</button>
      ) : null}
    </div>
  );
}
