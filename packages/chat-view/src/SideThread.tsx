import { useEffect, useRef, useState } from 'react';
import type { PageTransport, ViewState } from '@jawata/chat-core/view';
import { EntryList } from './Messages.js';

/**
 * The side thread (CR3): short questions to the agent in a session of their own, answered apart from the conversation, which goes on
 * meanwhile. The thread's content is the core's (`state.side`); this keeps only whether the person has opened the composer.
 */
export function SideThread({ state, send }: { state: ViewState; send: PageTransport['send'] }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const field = useRef<HTMLTextAreaElement>(null);
  const side = state.side;
  const shown = open || side !== null;
  useEffect(() => { if (shown) { field.current?.focus(); } }, [shown]);
  if (!shown) {
    return (
      <div className="side-bar">
        <button className="side-open-btn" title="Ask a short question in a thread of its own. The answer comes apart from this conversation, and the running step is not disturbed."
          onClick={() => setOpen(true)}>Side question</button>
      </div>
    );
  }
  const busy = side?.processing === true;
  const ask = () => {
    const body = text.trim();
    if (!body || busy) { return; }
    send({ type: 'askSide', text: body });
    setText('');
  };
  return (
    <div className="side-thread" role="region" aria-label="Side thread">
      <div className="side-head">
        <span className="side-title" title="Questions here are answered in a session of their own: the conversation above is not told them and does not change.">Side thread</span>
        <button className="side-close-btn" title="Closes the side thread and forgets it. The next side question starts a new one."
          onClick={() => { send({ type: 'closeSide' }); setOpen(false); setText(''); }}>Close</button>
      </div>
      {side && side.entries.length > 0 ? <div className="side-entries"><EntryList entries={side.entries} processing={busy} /></div> : null}
      {busy ? <div className="side-waiting" role="status">Answering…</div> : null}
      <div className="side-composer">
        <textarea ref={field} rows={2} value={text} placeholder="Ask a side question…" disabled={busy}
          onChange={e => setText(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(); } }} />
        <button className="side-ask-btn" disabled={busy || !text.trim()} title="Sends the question to the side session (Enter)" onClick={ask}>Ask</button>
      </div>
    </div>
  );
}
