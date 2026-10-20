import { useEffect, useRef, useState } from 'react';
import DOMPurify from 'dompurify';
import { waitingLine } from '@jawata/chat-core';
import { renderMarkdown } from './markdown.js';
import type { PartView, ToolCallView, ViewState } from '@jawata/chat-core';

type Entry = ViewState['entries'][number];
type Turn = Extract<Entry, { kind: 'turn' }>['turn'];

const STATUS_ICON: Record<string, string> = { in_progress: '⟳', completed: '✓', failed: '✗' };
const STATUS_WORDS: Record<string, string> = { pending: 'waiting to start', in_progress: 'running', completed: 'completed', failed: 'failed' };
const KIND_ICON: Record<string, string> = { read: '📄', edit: '✎', delete: '🗑', move: '⇄', search: '🔍', execute: '▶', think: '💭', fetch: '🌐', switch_mode: '⇆', other: '•' };

/** A value as the person reads it: text as it is, anything else as indented JSON. */
const shown = (value: unknown): string => (typeof value === 'string' ? value : JSON.stringify(value, null, 2));

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

function ToolBody({ tool }: { tool: ToolCallView }) {
  return (
    <div className="tc-body">
      {tool.input !== undefined && shown(tool.input) !== '{}' ? <><div className="tc-label">Input</div><pre className="tc-input">{shown(tool.input)}</pre></> : null}
      {tool.content.map((c, i) => {
        if (c.type === 'diff') { return <Diff key={i} path={c.path} oldText={c.oldText} newText={c.newText} />; }
        if (c.type === 'content' && c.content.type === 'text') { return <pre className="tc-content" key={i}>{c.content.text}</pre>; }
        if (c.type === 'terminal') { return <div className="tc-content" key={i}>Its output is in a terminal of its own.</div>; }
        return null;
      })}
      {tool.output !== undefined ? <><div className="tc-label">Output</div><pre className="tc-output">{shown(tool.output)}</pre></> : null}
    </div>
  );
}

function Tool({ tool }: { tool: ToolCallView }) {
  return (
    <details className="tool-call-inline" id={'tc-' + tool.toolCallId}>
      <summary>
        <span className="tc-kind" aria-hidden>{KIND_ICON[tool.kind] ?? KIND_ICON.other}</span>
        <span className={'tc-icon ' + tool.status} title={STATUS_WORDS[tool.status] ?? tool.status}>{STATUS_ICON[tool.status] ?? '…'}</span>
        <span className="tc-title">{tool.title || 'Tool Call'}</span>
      </summary>
      <ToolBody tool={tool} />
    </details>
  );
}

/** A run of tool calls that follow each other: one line that folds them all. */
function ToolRun({ tools, streaming }: { tools: ToolCallView[]; streaming: boolean }) {
  const [collapsed, setCollapsed] = useState(!streaming && tools.length > 3);
  const wasStreaming = useRef(streaming);
  useEffect(() => {
    // a finished answer with more than three calls folds them
    if (wasStreaming.current && !streaming && tools.length > 3) { setCollapsed(true); }
    wasStreaming.current = streaming;
  }, [streaming, tools.length]);
  const n = tools.length;
  return (
    <div className="turn-tools">
      <div className="turn-tools-summary" title="Click to show or fold the calls" onClick={() => setCollapsed(c => !c)}>
        {(collapsed ? '▸ ' : '▾ ') + n + ' tool call' + (n !== 1 ? 's' : '')}
      </div>
      <div className={'turn-tools-list' + (collapsed ? ' collapsed' : '')}>
        {tools.map(t => <Tool tool={t} key={t.toolCallId} />)}
      </div>
    </div>
  );
}

/** The parts of an answer in the order they came, tool calls that follow each other gathered into one run. */
function TurnView({ turn, streaming }: { turn: Turn; streaming: boolean }) {
  const blocks: ({ kind: 'part'; part: Exclude<PartView, { kind: 'tool' }> } | { kind: 'tools'; tools: ToolCallView[] })[] = [];
  for (const part of turn.parts) {
    const last = blocks[blocks.length - 1];
    if (part.kind !== 'tool') { blocks.push({ kind: 'part', part }); }
    else if (last && last.kind === 'tools') { last.tools.push(part.tool); }
    else { blocks.push({ kind: 'tools', tools: [part.tool] }); }
  }
  return (
    <div className="turn">
      {blocks.map((b, i) => {
        if (b.kind === 'tools') { return <ToolRun tools={b.tools} streaming={streaming} key={i} />; }
        if (b.part.kind === 'thought') { return <Thought text={b.part.text} key={i} />; }
        return streaming && i === blocks.length - 1
          ? <div className="message assistant" key={i}>{b.part.text}</div>
          : <Markdown text={b.part.text} key={i} />;
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

/** The line shown while the agent works and has not begun to write: it thinks, or it runs a tool. */
function Waiting({ state }: { state: ViewState }) {
  const line = waitingLine(state);
  if (!line) { return null; }
  return (
    <div className="waiting-line" role="status" title={line.tool ? 'The agent is running this tool' : 'The agent is working on your message'}>
      {line.tool ? <span className="waiting-tool">{line.tool}</span> : <span>Thinking</span>}
      <span className="dots" aria-hidden>...</span>
    </div>
  );
}

export function Messages({ state, onConnect, onConfigure, onHistory }: { state: ViewState; onConnect: () => void; onConfigure: () => void; onHistory: () => void }) {
  const el = useRef<HTMLDivElement>(null);
  useEffect(() => { if (el.current) { el.current.scrollTop = el.current.scrollHeight; } }, [state.entries, state.processing]);
  const last = state.entries.length - 1;
  return (
    <div className="messages" ref={el}>
      {!state.session && state.entries.length === 0 && !state.loading ? <EmptyState onConnect={onConnect} onConfigure={onConfigure} onHistory={onHistory} /> : null}
      {state.entries.map((entry, i) => {
        switch (entry.kind) {
          case 'user': return (
            <div className="message user" key={i}>
              {entry.text}
              {entry.files.length > 0 ? <div className="user-files">{entry.files.map((f, j) => <span className="attachment-chip" key={j}><span className="chip-name">{f}</span></span>)}</div> : null}
            </div>
          );
          case 'error': return <div className="message error" key={i} title="The agent or the connection reported this. Sending again tries again.">{entry.message}</div>;
          case 'turn': return <TurnView turn={entry.turn} streaming={state.processing && i === last} key={i} />;
        }
      })}
      <Waiting state={state} />
    </div>
  );
}
