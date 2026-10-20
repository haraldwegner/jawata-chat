/**
 * The chat's own styles. Every rule is scoped to the element the view is mounted in (`.jc-chat`), so
 * the view can sit in any host's page without touching it. Colours and fonts come from the host's
 * theme inputs, `--jc-host-<name>`, which the host's adapter sets from its own theme (the extension maps
 * them in `packages/vscode/src/ui/theme.ts`); each has a fallback that follows the browser's own colour scheme. A handful
 * of colours are ours, named once below: the accent, the two outcomes and the warning.
 */

/** The tokens every rule below draws on. Nothing else in this file names a colour or a font. */
const TOKENS = `
  --jc-font: var(--jc-host-font, system-ui, sans-serif);
  --jc-size: var(--jc-host-size, 13px);
  --jc-text: var(--jc-host-text, CanvasText);
  --jc-ground: var(--jc-host-ground, Canvas);
  --jc-raised: var(--jc-host-raised, color-mix(in srgb, Canvas 90%, CanvasText));
  --jc-edge: var(--jc-host-edge, color-mix(in srgb, CanvasText 22%, transparent));
  --jc-quiet: color-mix(in srgb, var(--jc-text) 62%, transparent);
  --jc-field: var(--jc-host-field, Canvas);
  --jc-field-text: var(--jc-host-field-text, CanvasText);
  --jc-accent: var(--jc-host-accent, #2f6fdb);
  --jc-on-accent: var(--jc-host-on-accent, #ffffff);
  --jc-ok: var(--jc-host-ok, #2e9d57);
  --jc-bad: var(--jc-host-bad, #d94141);
  --jc-warn: var(--jc-host-warn, #c98a1a);
  --jc-mine: var(--jc-host-mine, color-mix(in srgb, var(--jc-accent) 25%, var(--jc-ground)));
  --jc-mine-text: var(--jc-host-mine-text, var(--jc-text));
  --jc-gap: 8px;
  --jc-pad: 12px;
  --jc-round: 8px;
`;

/** Rules as [selectors, declarations]; the scope is put in front of every selector here, once. */
type Rule = [selectors: string, declarations: string];

const SCOPE = '.jc-chat';

const scoped = (rules: Rule[]): string => rules
  .map(([selectors, declarations]) => `${selectors.split(',').map(s => `${SCOPE} ${s.trim()}`.trim()).join(',\n')} {${declarations}}`)
  .join('\n');

const hostRule = `${SCOPE} {${TOKENS}
  position: relative; display: flex; flex-direction: column; height: 100vh; overflow: hidden;
  font: var(--jc-size) / 1.45 var(--jc-font); color: var(--jc-text); background: var(--jc-ground);
}
${SCOPE}, ${SCOPE} *, ${SCOPE} *::before, ${SCOPE} *::after { box-sizing: border-box; }`;

const RULES: Rule[] = [
  // the banner: who the chat is connected to
  ['.session-banner', 'display: none; align-items: center; gap: var(--jc-gap); padding: 8px var(--jc-pad); border-bottom: 1px solid var(--jc-edge); background: var(--jc-raised);'],
  ['.session-banner.visible', 'display: flex;'],
  ['.session-banner .dot', 'flex: none; width: 8px; height: 8px; border-radius: 50%; background: var(--jc-ok);'],
  ['.session-banner .info', 'flex: 1; min-width: 0;'],
  ['.session-banner .agent', 'font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;'],
  ['.session-banner .status', 'flex: none; display: flex; align-items: center;'],
  ['.banner-btn', 'flex: none; font: inherit; font-size: 0.9em; padding: 2px 8px; border-radius: 4px; cursor: pointer; color: var(--jc-text); background: transparent; border: 1px solid var(--jc-edge);'],
  ['.banner-btn:hover', 'background: var(--jc-mine);'],

  // the conversation
  ['.messages', 'flex: 1; min-height: 0; overflow-y: auto; display: flex; flex-direction: column; gap: var(--jc-gap); padding: var(--jc-pad);'],
  ['.message', 'padding: 8px 12px; border-radius: var(--jc-round); overflow-wrap: anywhere;'],
  ['.message.user', 'align-self: flex-end; max-width: 92%; white-space: pre-wrap; background: var(--jc-mine); color: var(--jc-mine-text);'],
  ['.message.assistant', 'align-self: stretch; padding-inline: 0; white-space: pre-wrap;'],
  ['.message.assistant.md-rendered', 'white-space: normal;'],
  ['.message.error', 'color: var(--jc-bad); border: 1px solid var(--jc-bad); background: color-mix(in srgb, var(--jc-bad) 10%, transparent);'],
  ['.turn', 'display: flex; flex-direction: column; gap: 6px;'],

  // what the assistant wrote, as markdown
  ['.md-rendered > :first-child', 'margin-top: 0;'],
  ['.md-rendered > :last-child', 'margin-bottom: 0;'],
  ['.md-rendered p, .md-rendered ul, .md-rendered ol, .md-rendered pre, .md-rendered blockquote, .md-rendered table', 'margin: 0 0 0.7em;'],
  ['.md-rendered ul, .md-rendered ol', 'padding-left: 1.5em;'],
  ['.md-rendered h1, .md-rendered h2, .md-rendered h3, .md-rendered h4', 'margin: 0.9em 0 0.4em; line-height: 1.25;'],
  ['.md-rendered code', 'font-family: var(--jc-host-mono, ui-monospace, monospace); font-size: 0.92em; padding: 0.1em 0.35em; border-radius: 4px; background: var(--jc-raised);'],
  ['.md-rendered pre', 'overflow-x: auto; padding: 8px 10px; border-radius: 6px; background: var(--jc-raised);'],
  ['.md-rendered pre code', 'padding: 0; background: none;'],
  ['.md-rendered blockquote', 'padding-left: 10px; border-left: 3px solid var(--jc-edge); color: var(--jc-quiet);'],
  ['.md-rendered a', 'color: var(--jc-host-link, var(--jc-accent));'],
  ['.md-rendered table', 'border-collapse: collapse;'],
  ['.md-rendered th, .md-rendered td', 'padding: 3px 8px; border: 1px solid var(--jc-edge);'],

  // thinking, as one line that opens
  ['.thought-block', 'color: var(--jc-quiet);'],
  ['.thought-block summary', 'cursor: pointer; user-select: none; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;'],
  ['.thought-block[open] .thought-gist', 'display: none;'],
  ['.thought-label', 'font-weight: 600;'],
  ['.thought-block .thought-content', 'margin-top: 4px; padding-left: 10px; border-left: 2px solid var(--jc-edge); white-space: pre-wrap;'],
  ['.waiting-line', 'color: var(--jc-quiet);'],
  ['.waiting-tool', 'font-weight: 600;'],
  ['.dots', 'display: inline-block; overflow: hidden; vertical-align: bottom; width: 0; animation: jc-dots 1.2s steps(4, end) infinite;'],

  // tool calls: a line that folds
  ['.turn-tools-summary', 'cursor: pointer; user-select: none; color: var(--jc-quiet); font-size: 0.92em;'],
  ['.turn-tools-list', 'display: flex; flex-direction: column; gap: 2px; margin-top: 2px;'],
  ['.turn-tools-list.collapsed', 'display: none;'],
  ['.tool-call-inline', 'font-size: 0.92em;'],
  ['.tool-call-inline summary', 'display: flex; gap: 6px; align-items: baseline; cursor: pointer; list-style: none;'],
  ['.tool-call-inline summary::-webkit-details-marker', 'display: none;'],
  ['.tc-kind', 'flex: none; width: 1.2em; text-align: center; color: var(--jc-quiet);'],
  ['.tc-body', 'margin: 2px 0 6px 1.4em; display: flex; flex-direction: column; gap: 4px;'],
  ['.tc-label', 'font-size: 0.85em; text-transform: uppercase; color: var(--jc-quiet);'],
  ['.tc-body pre', 'margin: 0; padding: 6px 8px; max-height: 240px; overflow: auto; border-radius: 6px; background: var(--jc-raised); font-family: var(--jc-host-mono, ui-monospace, monospace); font-size: 0.92em;'],
  ['.tc-diff-path', 'font-size: 0.9em; color: var(--jc-quiet);'],
  ['.tc-diff .add', 'display: block; color: var(--jc-ok);'],
  ['.tc-diff .del', 'display: block; color: var(--jc-bad);'],
  ['.tc-icon', 'flex: none; width: 1.2em; text-align: center;'],
  ['.tc-icon.completed', 'color: var(--jc-ok);'],
  ['.tc-icon.failed', 'color: var(--jc-bad);'],
  ['.tc-icon.in_progress', 'color: var(--jc-warn);'],
  ['.tc-title', 'min-width: 0; overflow-wrap: anywhere;'],

  // the agent's plan
  ['.plan', 'flex: none; max-height: 30%; overflow-y: auto; margin: var(--jc-gap) var(--jc-pad) 0; padding: 8px 10px; border: 1px solid var(--jc-edge); border-radius: var(--jc-round); background: var(--jc-raised);'],
  ['.mismatch', 'flex: none; margin: var(--jc-gap) var(--jc-pad) 0; padding: 8px 10px; border: 1px solid var(--jc-bad); border-radius: var(--jc-round); color: var(--jc-bad);'],
  ['.user-files', 'display: flex; flex-wrap: wrap; gap: 4px; margin-top: 4px;'],
  ['.agents', 'flex: none; max-height: 40%; overflow-y: auto; margin: var(--jc-gap) var(--jc-pad) 0; padding: 8px 10px; border: 1px solid var(--jc-edge); border-radius: var(--jc-round); background: var(--jc-raised);'],
  ['.agents-title', 'font-weight: 600; margin-bottom: 4px;'],
  ['.hire-row', 'display: flex; flex-wrap: wrap; align-items: baseline; gap: 2px 10px;'],
  ['.hire-seat', 'font-weight: 600;'],
  ['.hire-who', 'color: var(--jc-quiet);'],
  ['.hire-time', 'color: var(--jc-quiet);'],
  ['.hire-tokens', 'color: var(--jc-quiet);'],
  ['.hire-cost', 'color: var(--jc-quiet);'],
  ['.hire-row.compacting .hire-state', 'font-style: italic;'],
  ['.hire-row.failed .hire-state', 'font-weight: 600;'],
  ['.hire-stop', 'font: inherit; font-size: 0.9em; padding: 0 8px; border-radius: 4px; cursor: pointer; color: var(--jc-text); background: transparent; border: 1px solid var(--jc-edge);'],
  ['.hire-transcript-btn', 'font: inherit; font-size: 0.9em; padding: 0 8px; border-radius: 4px; cursor: pointer; color: var(--jc-text); background: transparent; border: 1px solid var(--jc-edge);'],
  ['.hire-transcript', 'margin-top: 6px; padding-left: 10px; border-left: 2px solid var(--jc-edge); max-height: 12em; overflow-y: auto; white-space: pre-wrap; user-select: text;'],
  ['.hire-role', 'font-weight: 600;'],
  ['.proposals', 'flex: none; max-height: 50%; overflow-y: auto; margin: 0 var(--jc-pad); display: flex; flex-direction: column; gap: var(--jc-gap);'],
  ['.proposal', 'padding: 8px 10px; border: 1px solid var(--jc-edge); border-radius: var(--jc-round); background: var(--jc-raised);'],
  ['.proposal-title', 'font-weight: 600; margin-bottom: 4px;'],
  ['.proposal-choices', 'display: flex; gap: 8px; margin-top: 6px;'],
  ['.proposal-choice', 'font: inherit; padding: 2px 12px; border-radius: 4px; cursor: pointer; color: var(--jc-text); background: transparent; border: 1px solid var(--jc-edge);'],
  ['.proposal-choice.accept', 'font-weight: 600;'],
  ['.history', 'flex: none; max-height: 50%; overflow-y: auto; margin: var(--jc-gap) var(--jc-pad) 0; padding: 8px 10px; border: 1px solid var(--jc-edge); border-radius: var(--jc-round); background: var(--jc-raised); display: flex; flex-direction: column; gap: 2px;'],
  ['.history-head', 'display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 4px;'],
  ['.history-title', 'font-weight: 600;'],
  ['.history-close', 'font: inherit; font-size: 0.9em; padding: 0 8px; border-radius: 4px; cursor: pointer; color: var(--jc-text); background: transparent; border: 1px solid var(--jc-edge);'],
  ['.history-wait', 'color: var(--jc-quiet);'],
  ['.history-empty', 'color: var(--jc-quiet);'],
  ['.history-item', 'display: flex; justify-content: space-between; gap: 10px; font: inherit; text-align: left; padding: 3px 6px; border-radius: 4px; cursor: pointer; color: var(--jc-text); background: transparent; border: 1px solid transparent;'],
  ['.history-item.current', 'border-color: var(--jc-edge);'],
  ['.history-name', 'min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;'],
  ['.history-when', 'flex: none; color: var(--jc-quiet);'],
  ['.history-more', 'font: inherit; align-self: flex-start; padding: 0 8px; border-radius: 4px; cursor: pointer; color: var(--jc-text); background: transparent; border: 1px solid var(--jc-edge);'],
  ['.plan-title', 'font-weight: 600; margin-bottom: 4px;'],
  ['.plan-entry.completed', 'color: var(--jc-quiet); text-decoration: line-through;'],

  // nothing connected yet
  ['.empty-state', 'margin: auto; display: flex; flex-direction: column; align-items: center; gap: 12px; text-align: center;'],
  ['.empty-state .actions', 'display: flex; flex-wrap: wrap; justify-content: center; gap: var(--jc-gap);'],
  ['.action-btn', 'font: inherit; padding: 5px 14px; border-radius: 4px; cursor: pointer; border: 1px solid transparent;'],
  ['.action-btn.primary', 'color: var(--jc-on-accent); background: var(--jc-accent);'],
  ['.action-btn.secondary', 'color: var(--jc-mine-text); background: var(--jc-mine);'],
  ['.action-btn:hover', 'filter: brightness(1.1);'],

  // writing: commands offered as you type /, the files attached, the pickers, the text, send
  ['.input-area', 'position: relative; flex: none; display: flex; flex-direction: column; gap: 6px; padding: 8px var(--jc-pad) var(--jc-pad); border-top: 1px solid var(--jc-edge);'],
  ['.input-area.disabled', 'opacity: 0.6;'],
  ['.slash-popup', 'display: none; position: absolute; left: var(--jc-pad); right: var(--jc-pad); bottom: 100%; max-height: 200px; overflow-y: auto; border: 1px solid var(--jc-edge); border-radius: 6px; background: var(--jc-raised); z-index: 5;'],
  ['.slash-popup.open', 'display: block;'],
  ['.slash-popup-group', 'padding: 4px 10px 2px; font-size: 0.85em; text-transform: uppercase; color: var(--jc-quiet);'],
  ['.slash-popup-item', 'display: flex; gap: 10px; padding: 4px 10px; cursor: pointer;'],
  ['.slash-popup-item.active', 'background: var(--jc-mine);'],
  ['.cmd-name', 'flex: none; font-weight: 600;'],
  ['.cmd-desc', 'min-width: 0; color: var(--jc-quiet); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;'],
  ['.queue', 'display: flex; flex-direction: column; gap: 2px; max-height: 6em; overflow-y: auto; padding: 4px 8px; border: 1px dashed var(--jc-edge); border-radius: 6px; color: var(--jc-quiet);'],
  ['.queued', 'display: flex; align-items: baseline; gap: 8px;'],
  ['.queued-text', 'flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;'],
  ['.queued-now', 'flex: none; font: inherit; font-size: 0.9em; padding: 0 8px; border-radius: 4px; cursor: pointer; color: var(--jc-text); background: transparent; border: 1px solid var(--jc-edge);'],
  ['.attachments', 'display: flex; flex-wrap: wrap; gap: 4px;'],
  ['.attachment-chip', 'display: inline-flex; align-items: center; gap: 4px; padding: 1px 4px 1px 8px; border-radius: 10px; font-size: 0.9em; background: var(--jc-mine); color: var(--jc-mine-text);'],
  ['.chip-remove', 'font: inherit; line-height: 1; padding: 0 4px; border: 0; border-radius: 50%; cursor: pointer; background: transparent; color: inherit;'],
  ['.chip-remove:hover', 'background: var(--jc-edge);'],
  ['.input-toolbar', 'display: flex; align-items: center;'],
  ['.picker-row', 'display: flex; flex-wrap: wrap; gap: 4px;'],
  ['.picker-wrap', 'position: relative;'],
  ['.picker-btn', 'display: inline-flex; align-items: center; gap: 4px; font: inherit; font-size: 0.9em; padding: 2px 8px; border-radius: 4px; cursor: pointer; color: var(--jc-text); background: transparent; border: 1px solid var(--jc-edge);'],
  ['.picker-btn:hover', 'background: var(--jc-mine);'],
  ['.picker-dropdown', 'display: none; position: absolute; left: 0; bottom: 100%; min-width: 180px; max-height: 240px; overflow-y: auto; margin-bottom: 4px; border: 1px solid var(--jc-edge); border-radius: 6px; background: var(--jc-raised); z-index: 6;'],
  ['.picker-dropdown.open', 'display: block;'],
  ['.picker-dropdown-group-header', 'padding: 4px 10px; font-size: 0.85em; text-transform: uppercase; color: var(--jc-quiet);'],
  ['.picker-dropdown-item', 'display: flex; gap: 6px; padding: 4px 10px; cursor: pointer;'],
  ['.picker-dropdown-item:hover', 'background: var(--jc-mine);'],
  ['.picker-dropdown-item .check', 'flex: none; width: 1em; color: var(--jc-ok);'],
  ['.toolbar-spacer', 'flex: 1;'],
  ['.input-editor-wrap textarea', 'display: block; width: 100%; resize: none; font: inherit; padding: 6px 8px; border-radius: 4px; border: 1px solid var(--jc-edge); color: var(--jc-field-text); background: var(--jc-field);'],
  ['.input-editor-wrap textarea:focus', 'outline: 1px solid var(--jc-accent); outline-offset: -1px;'],
  ['.input-send-row', 'display: flex; justify-content: flex-end; gap: var(--jc-gap);'],
  ['.send-stop-btn', 'font: inherit; padding: 4px 16px; border-radius: 4px; cursor: pointer; border: 1px solid transparent;'],
  ['.send-stop-btn.send', 'color: var(--jc-on-accent); background: var(--jc-accent);'],
  ['.send-stop-btn.stop', 'color: var(--jc-text); background: transparent; border-color: var(--jc-bad);'],

  // working, and loading an earlier session
  ['.spinner', 'width: 14px; height: 14px; border-radius: 50%; border: 2px solid var(--jc-edge); border-top-color: var(--jc-accent); animation: jc-spin 0.8s linear infinite;'],
  ['.load-overlay', 'display: none; position: absolute; inset: 0; z-index: 10; flex-direction: column; align-items: center; justify-content: center; gap: 10px; background: color-mix(in srgb, var(--jc-ground) 85%, transparent);'],
  ['.load-overlay.visible', 'display: flex;'],
];

const MOTION = `
@keyframes jc-spin { to { transform: rotate(360deg); } }
@keyframes jc-dots { to { width: 1.2em; } }
@media (prefers-reduced-motion: reduce) {
  ${SCOPE} .spinner { animation: none; }
  ${SCOPE} .dots { animation: none; width: auto; }
}`;

export const CHAT_CSS = `${hostRule}\n${scoped(RULES)}\n${MOTION}\n`;
