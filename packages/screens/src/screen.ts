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
:root { --screen-background: #ffffff; --screen-foreground: #1f1f1f; --screen-font: system-ui, sans-serif; --screen-font-size: 13px; --screen-warning: #a8621a; --screen-danger: #a1260d; }
:root[data-theme="dark"] { --screen-background: #2b2b2b; --screen-foreground: #dddddd; --screen-warning: #e0a458; --screen-danger: #f48771; }
html, body { margin: 0; padding: 0; min-height: 100%; background: var(--screen-background); color: var(--screen-foreground); font-family: var(--screen-font); font-size: var(--screen-font-size); }
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
`;
