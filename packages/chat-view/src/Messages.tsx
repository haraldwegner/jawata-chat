import { useEffect, useRef } from 'react';
import DOMPurify from 'dompurify';
import { renderMarkdown } from './markdown.js';
import { Picture } from './Picture.js';
import type { PartView, ViewState } from '@jawata/chat-core/view';

type Entry = ViewState['entries'][number];
type Turn = Extract<Entry, { kind: 'turn' }>['turn'];

function Markdown({ text }: { text: string }) {
  // the core renders; sanitising is the view's, which has a DOM
  const html = DOMPurify.sanitize(renderMarkdown(text));
  return <div className="message assistant md-rendered" dangerouslySetInnerHTML={{ __html: html }} />;
}

/** The first line the agent wrote, which is what the folded line shows of it. */
const gistOf = (text: string): string => text.trim().split('\n')[0];

function Thought({ text }: { text: string }) {
  return (
    <details className="thought-block">
      <summary title="Click to read the agent's reasoning"><span className="thought-label">Thought</span> <span className="thought-gist">{gistOf(text)}</span></summary>
      <div className="thought-content">{text}</div>
    </details>
  );
}

/** What a diff the tool made looks like: what went, then what came, under the file's name. */
export function Diff({ path, oldText, newText }: { path: string; oldText?: string | null; newText: string }) {
  return (
    <div className="tc-diff">
      <div className="tc-diff-path">{path}</div>
      <pre>
        {oldText ? oldText.replace(/\n$/, '').split('\n').map((line, i) => <span className="del" key={'d' + i}>{'- ' + line + '\n'}</span>) : null}
        {newText.replace(/\n$/, '').split('\n').map((line, i) => <span className="add" key={'a' + i}>{'+ ' + line + '\n'}</span>)}
      </pre>
    </div>
  );
}

/** The parts of an answer in the order they came, without its tool calls: those are in Agent Control, below the agent that made them. */
function TurnView({ turn, streaming }: { turn: Turn; streaming: boolean }) {
  const parts = turn.parts.filter((p): p is Exclude<PartView, { kind: 'tool' }> => p.kind !== 'tool');
  if (parts.length === 0) { return null; }
  return (
    <div className="turn">
      {parts.map((part, i) => {
        if (part.kind === 'thought') { return <Thought text={part.text} key={i} />; }
        return streaming && i === parts.length - 1
          ? <div className="message assistant" key={i}>{part.text}</div>
          : <Markdown text={part.text} key={i} />;
      })}
    </div>
  );
}

function EmptyState({ onConnect, onConfigure, onHistory }: { onConnect: () => void; onConfigure: () => void; onHistory: () => void }) {
  return (
    <div className="empty-state">
      <div className="sentence">No agent is connected.</div>
      <div className="actions">
        <button className="action-btn primary" title="Starts the agent that is set up for this chat and opens a session." onClick={onConnect}>Connect</button>
        <button className="action-btn secondary" title="Opens where the agent is set up." onClick={onConfigure}>Configure</button>
        <button className="action-btn secondary history-open" title="Shows the sessions the agent has, to open one without starting a new conversation." onClick={onHistory}>History</button>
      </div>
    </div>
  );
}

/** The agent's current plan, kept on screen above the conversation while the agent works. */
export function PlanBar({ plan }: { plan: NonNullable<ViewState['plan']> }) {
  return (
    <div className="plan" title="The agent's plan, as it last sent it">
      <div className="plan-title">Plan</div>
      {plan.map((e, i) => (
        <div key={i} className={'plan-entry' + (e.status === 'completed' ? ' completed' : '')}>
          {(e.status === 'completed' ? '✅' : e.status === 'in_progress' ? '🔄' : '⬜') + ' ' + e.content}
        </div>
      ))}
    </div>
  );
}

/** The conversation's entries in order: what the person sent, what the agent answered, what went wrong. The side thread draws its own the same way. */
export function EntryList({ entries, processing }: { entries: ViewState['entries']; processing: boolean }) {
  const last = entries.length - 1;
  return (
    <>
      {entries.map((entry, i) => {
        switch (entry.kind) {
          case 'user': return (
            <div className="message user" key={i}>
              {entry.text}
              {entry.images && entry.images.length > 0
                ? <div className="user-images">{entry.images.map((src, j) => <Picture src={src} name={`picture ${j + 1}`} key={j} />)}</div>
                : null}
              {entry.files.length > 0 ? <div className="user-files">{entry.files.map((f, j) => <span className="attachment-chip" key={j}><span className="chip-name">{f}</span></span>)}</div> : null}
            </div>
          );
          case 'error': return <div className="message error" key={i} title="The agent or the connection reported this. Sending again tries again.">{entry.message}</div>;
          case 'turn': return <TurnView turn={entry.turn} streaming={processing && i === last} key={i} />;
        }
      })}
    </>
  );
}

/** How far from the bottom of the list counts as being at it, in pixels. */
const AT_THE_BOTTOM = 24;

export function Messages({ state, onConnect, onConfigure, onHistory }: { state: ViewState; onConnect: () => void; onConfigure: () => void; onHistory: () => void }) {
  const el = useRef<HTMLDivElement>(null);
  // The list follows the output only while the person is at its bottom: once he scrolls up to read, new output leaves him where he is (28h S19-3).
  const following = useRef(true);
  const shown = useRef(0);
  useEffect(() => {
    const list = el.current;
    if (!list) { return; }
    const last = state.entries.at(-1);
    // his own message takes him to the bottom, where the answer comes; so does a conversation that is shorter than the one before (another one opened)
    if (state.entries.length < shown.current || (state.entries.length > shown.current && last?.kind === 'user')) { following.current = true; }
    shown.current = state.entries.length;
    if (following.current) { list.scrollTop = list.scrollHeight; }
  }, [state.entries, state.processing]);
  const noticeScroll = () => {
    const list = el.current;
    if (list) { following.current = list.scrollHeight - list.scrollTop - list.clientHeight <= AT_THE_BOTTOM; }
  };
  return (
    <div className="messages" ref={el} onScroll={noticeScroll}>
      {!state.session && state.entries.length === 0 && !state.loading ? <EmptyState onConnect={onConnect} onConfigure={onConfigure} onHistory={onHistory} /> : null}
      <EntryList entries={state.entries} processing={state.processing} />
    </div>
  );
}
