import type { Disposable, ViewIntent, ViewMessage, ViewPort } from './view.js';

/**
 * The page's end of an in-process link: what a view takes as its transport.
 * @public part of the link hosts outside this workspace use
 */
export interface PageEnd {
  /** Hear what the core tells the page. */
  onMessage(handler: (message: ViewMessage) => void): Disposable;
  /** Send the core an intent. */
  send(intent: ViewIntent): void;
}

/**
 * Both ends of a line between the core and a page that run in the same process.
 * @public part of the link hosts outside this workspace use
 */
export interface InProcessLink {
  /** The core's end: attach it to the chat controller. */
  port: ViewPort;
  /** The page's end: give it to the view. */
  page: PageEnd;
  /** What the page would send, whatever it is: the core checks that it is an intent. */
  deliver(message: unknown): Promise<void>;
}

/**
 * A line between the core and a page that both run in the page's own process, as Theia's native mount and
 * the Eclipse relay run them: a message the core posts reaches the page's handlers at once, and what the
 * page sends reaches the core's handler. No host, no serialisation.
 * @public hosts outside this workspace run the core in the page and need exactly this link
 */
export function createInProcessLink(): InProcessLink {
  const heardByPage = new Set<(message: ViewMessage) => void>();
  let heardByCore: ((message: unknown) => void | Promise<void>) | undefined;
  const deliver = async (message: unknown): Promise<void> => { await heardByCore?.(message); };
  return {
    port: {
      post: (message) => { for (const handler of [...heardByPage]) { handler(message); } },
      onMessage: (handler) => {
        heardByCore = handler;
        return { dispose: () => { if (heardByCore === handler) { heardByCore = undefined; } } };
      },
      onDispose: () => ({ dispose: () => { /* a page in the same process is never gone before the core */ } }),
    },
    page: {
      onMessage: (handler) => { heardByPage.add(handler); return { dispose: () => { heardByPage.delete(handler); } }; },
      send: (intent) => { void deliver(intent); },
    },
    deliver,
  };
}
