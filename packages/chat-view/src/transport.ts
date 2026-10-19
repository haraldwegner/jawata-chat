import type { Disposable, ViewIntent, ViewMessage } from '@jawata/chat-core';

/**
 * The view's side of the line to the core: what it is told, and what it asks. The host supplies it —
 * the webview's message passing in VS Code, a native mount in Theia, a relay in Eclipse — and the view
 * knows nothing of which. (The core's side of the same line is `ViewPort`.)
 */
export interface PageTransport {
  /** Hear the core; dispose the result to stop hearing. */
  onMessage(handler: (message: ViewMessage) => void): Disposable;
  /** Ask the core. */
  send(intent: ViewIntent): void;
}
