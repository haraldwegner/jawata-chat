import type { ScreensPort } from './port.js';

/** What a host can ask of a mounted screen. */
export interface ScreenHandle {
  /** Asks the screen to read again now, as its timer does. */
  refresh(): Promise<void>;
}

/** What every screen is given. */
export interface ScreenProps {
  readonly port: ScreensPort;
  /** The screen sets `refresh` here when it starts. */
  readonly handle: ScreenHandle;
}

/** The screens' stylesheet. The colours and font are the names a host sets; each has a value of its own for a host that does not. */
export const SCREENS_CSS = `
:root { color-scheme: light; --screen-background: #ffffff; --screen-foreground: #1f1f1f; --screen-accent: #2f6fdd; --screen-font: system-ui, sans-serif; --screen-font-size: 13px; --screen-warning: #a8621a; --screen-danger: #a1260d; }
:root[data-theme="dark"] { color-scheme: dark; --screen-background: #2b2b2b; --screen-foreground: #dddddd; --screen-accent: #4c8fea; --screen-warning: #e0a458; --screen-danger: #f48771; }
html, body { margin: 0; padding: 0; min-height: 100%; background: var(--screen-background); color: var(--screen-foreground); font-family: var(--screen-font); font-size: var(--screen-font-size); accent-color: var(--screen-accent); }
.screen { padding: 8px 12px; }
.screen p { margin: 0 0 8px; }
.screen-verdict { font-weight: 600; }
.screen-attention, .screen-error { color: var(--screen-warning); }
.screen-danger { color: var(--screen-danger); }
.screen-check { display: flex; align-items: center; gap: 6px; margin: 0 0 8px; }
.screen-fold h3 { font-size: inherit; margin: 8px 0 4px; }
.screen-list { list-style: none; margin: 0; padding: 0; }
.screen-list li { display: flex; flex-wrap: wrap; align-items: baseline; gap: 6px; }
.screen-count { font-variant-numeric: tabular-nums; opacity: 0.8; }
.screen-flag { font-size: 0.85em; padding: 0 4px; border: 1px solid currentColor; border-radius: 3px; opacity: 0.8; }
.screen h3 { font-size: inherit; margin: 12px 0 4px; }
.screen-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin: 0 0 8px; }
.screen-more { position: relative; }
.screen-more > summary { cursor: pointer; }
.screen-more > div { position: absolute; z-index: 1; display: flex; flex-direction: column; gap: 2px; padding: 4px; background: var(--screen-background); border: 1px solid currentColor; }
.screen-lanes { display: flex; flex-wrap: wrap; gap: 12px; }
.screen pre { white-space: pre-wrap; word-break: break-word; }
.seat-group h3 { margin: 12px 0 4px; }
.seat-line { display: flex; align-items: flex-start; gap: 8px; }
.seat-line .seat-row { flex: 1; min-width: 0; }
.seat-on { flex: 0 0 3.6rem; margin: 2px 0 0; }
.seat-off { opacity: 0.6; }
.seat-row > summary { cursor: pointer; display: flex; flex-wrap: wrap; gap: 4px 8px; align-items: flex-start; }
.seat-name { flex: 0 0 17rem; font-weight: 600; }
.seat-first { flex: 1 1 20rem; }
.seat-facts { display: grid; grid-template-columns: max-content 1fr; gap: 4px 12px; margin: 0 0 8px; }
.seat-facts dt { opacity: 0.8; }
.seat-facts dd { margin: 0; }
.seat-brain { width: 100%; }
.seat-note { display: block; margin-top: 4px; }
.wf-frame { overflow: auto; }
.wf-org ul { display: flex; justify-content: center; list-style: none; margin: 0; padding: 12px 0 0; position: relative; }
.wf-org li { position: relative; padding: 12px 6px 0; display: flex; flex-direction: column; align-items: center; }
.wf-org li::before, .wf-org li::after { content: ""; position: absolute; top: 0; right: 50%; width: 50%; height: 12px; border-top: 2px solid var(--screen-foreground); }
.wf-org li::after { right: auto; left: calc(50% - 1px); width: calc(50% + 1px); border-left: 2px solid var(--screen-foreground); }
.wf-org li:only-child::before, .wf-org li:only-child::after { display: none; }
.wf-org li:only-child { padding-top: 0; }
.wf-org li:first-child::before, .wf-org li:last-child::after { border: 0 none; }
.wf-org li:last-child::before { right: calc(50% - 1px); width: calc(50% + 1px); border-right: 2px solid var(--screen-foreground); }
.wf-org ul ul::before { content: ""; position: absolute; top: 0; left: calc(50% - 1px); height: 12px; border-left: 2px solid var(--screen-foreground); }
.wf-org > ul { padding-top: 0; width: max-content; margin: 0 auto; }
.wf-org > ul > li { padding-top: 0; }
.wf-org > ul > li::before, .wf-org > ul > li::after { display: none; }
.wf-box { position: relative; width: 196px; box-sizing: border-box; border: 2px solid var(--screen-foreground); border-radius: 5px; background: var(--screen-background);
  padding: 2px 16px 2px 7px; display: flex; align-items: center; justify-content: space-between; gap: 6px; line-height: 1.3; }
.wf-name { font-weight: 600; font-size: 11.5px; white-space: nowrap; }
.wf-role { border: 1px solid currentColor; border-radius: 999px; padding: 0 6px; font-size: 10px; background: transparent; color: inherit; }
.wf-fold { position: absolute; top: 2px; right: 3px; border: 0; background: transparent; color: inherit; cursor: pointer; font-size: 10px; padding: 0; }
.wf-stack { display: flex; flex-direction: column; gap: 3px; }
.wf-changed { border-color: var(--screen-accent); }
.wf-over { outline: 2px solid var(--screen-accent); }
.wf-org-unlocked .wf-box[draggable="true"] { cursor: grab; }
.wf-unlocked { border-color: var(--screen-warning); }
.wf-root { position: relative; }
.wf-helpers { position: absolute; left: calc(100% + 12px); top: 0; display: flex; gap: 5px; align-items: center; }
.wf-helper { border: 1px dashed currentColor; border-radius: 6px; padding: 2px 7px; font-size: 11px; white-space: nowrap; cursor: help; }
.wf-label { opacity: 0.8; font-size: 11px; }
.wf-menu { position: fixed; z-index: 9; background: var(--screen-background); border: 1px solid currentColor; border-radius: 6px; padding: 7px; }
.wf-menu select { display: block; margin: 4px 0 7px; }
`;
