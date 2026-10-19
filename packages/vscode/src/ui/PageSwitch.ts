import type { ChatController, Disposable } from '@jawata/chat-core';
import type { PageHost } from './chatPage';
import type { Place } from './places';
import { WebviewViewPort } from './ViewPort';

/**
 * The chat is in one place at a time: the core serves one page. A page that mounts in a place takes over from
 * the page of another place (or of the same place, come again); a port that is not one of these pages (a test's)
 * is left in use, as a page that resolves late must not take a port already in use.
 */
export class PageSwitch {
  private current?: { port: WebviewViewPort; subscription: Disposable };

  /** @param onReady told, with the place, when a page there says it is ready */
  constructor(private readonly chat: ChatController, private readonly onReady: (place: Place) => void) {}

  mount(place: Place, host: PageHost): void {
    const port = new WebviewViewPort(host, undefined, () => this.onReady(place));
    const subscription = this.current ? this.chat.attach(port) : this.chat.attachIfFree(port);
    if (!subscription) { return; }
    this.current = { port, subscription };
    host.onDidDispose(() => { if (this.current?.port === port) { this.current = undefined; } });
  }
}
