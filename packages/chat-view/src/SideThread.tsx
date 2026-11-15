import { useEffect, useRef, useState } from 'react';
import type { PageTransport, ViewState } from '@jawata/chat-core/view';
import { EntryList } from './Messages.js';
import { Working } from './Working.js';

/**
 * The side discussion (btw): a panel of its own beside the chat, with a session of its own, so the conversation goes on and is not told.
 * The thread's content is the core's (`state.side`). The panel's own title and close belong to the host.
 */
export function SidePanel({ state, send }: { state: ViewState; send: PageTransport['send'] }) {
  const [text, setText] = useState('');
  const field = useRef<HTMLTextAreaElement>(null);
  const side = state.side;
  const busy = side?.processing === true;
  useEffect(() => { field.current?.focus(); }, []);
  const ask = () => {
    const body = text.trim();
    if (!body || busy) { return; }
    send({ type: 'askSide', text: body });
    setText('');
  };
  return (
    <div className="side-thread side-panel" role="region" aria-label="Side discussion">
      <div className="side-entries">{side && side.entries.length > 0 ? <EntryList entries={side.entries} processing={busy} /> : null}</div>
      {busy ? <Working running /> : null}
      <div className="side-composer">
        <textarea ref={field} rows={2} value={text} placeholder="Ask a side question…" disabled={busy}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(); } }} />
        <button className="side-ask-btn" disabled={busy || !text.trim()} title="Sends the question to the side session (Enter)" onClick={ask}>Ask</button>
      </div>
    </div>
  );
}
