import type { ChatController, Disposable } from '@jawata/chat-core';
import type { PageHost } from './chatPage';
import type { Place } from './places';
import { WebviewViewPort } from './ViewPort';

/**
 * The page of a place, as the editor makes it: builds the port of a webview and offers it to the chat, whose controller holds the one
 * policy for who has the seat (a page takes over from a page, never from a port that is not one).
 */
export class PageSwitch {
  private current?: { port: WebviewViewPort; subscription: Disposable };

  /** @param onReady told, with the place, when a page there says it is ready; given by a test, which waits for it */
  constructor(private readonly chat: ChatController, private readonly onReady?: (place: Place) => void) {}

  mount(place: Place, host: PageHost): void {
    const port = new WebviewViewPort(host, undefined, this.onReady && (() => this.onReady?.(place)));
    const subscription = this.chat.attachPage(port);
    if (!subscription) { return; }
    this.current = { port, subscription };
    host.onDidDispose(() => { if (this.current?.port === port) { this.current = undefined; } });
  }
}
