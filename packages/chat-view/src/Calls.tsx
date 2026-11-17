import type { ToolCallView } from '@jawata/chat-core/view';
import { Diff } from './Messages.js';

const STATUS_ICON: Record<string, string> = { in_progress: '⟳', completed: '✓', failed: '✗' };
const STATUS_WORDS: Record<string, string> = { pending: 'waiting to start', in_progress: 'running', completed: 'completed', failed: 'failed' };
const KIND_ICON: Record<string, string> = { read: '📄', edit: '✎', delete: '🗑', move: '⇄', search: '🔍', execute: '▶', think: '💭', fetch: '🌐', switch_mode: '⇆', other: '•' };

/** A value as the person reads it: text as it is, anything else as indented JSON. */
const shown = (value: unknown): string => (typeof value === 'string' ? value : JSON.stringify(value, null, 2));

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

/** One tool call as one line: its kind, its state and its title; opened, what went in, what it changed and what came out. */
export function Tool({ tool }: { tool: ToolCallView }) {
  return (
    <details className="tool-call-inline" id={'tc-' + tool.toolCallId}>
      <summary title="Click to see what went into this call and what came out">
        <span className="tc-kind" aria-hidden>{KIND_ICON[tool.kind] ?? KIND_ICON.other}</span>
        <span className={'tc-icon ' + tool.status} title={STATUS_WORDS[tool.status] ?? tool.status}>{STATUS_ICON[tool.status] ?? '…'}</span>
        <span className="tc-title">{tool.title || 'Tool Call'}</span>
      </summary>
      <ToolBody tool={tool} />
    </details>
  );
}
