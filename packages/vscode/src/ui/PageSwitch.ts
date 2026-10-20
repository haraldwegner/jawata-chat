import type { ChatController } from '@jawata/chat-core';
import type { PageHost } from './chatPage';
import type { Place } from './places';
import { WebviewViewPort } from './ViewPort';

/**
 * The page of a place, as the editor makes it: builds the port of a webview and offers it to the chat, whose controller holds the one
 * policy for who has the seat (a page takes over from a page, never from a port that is not one) and lets go of a page that is gone.
 * A page that is shown again after another place had the chat takes the seat back and is given the state: moving the chat to
 * another place, and back, leaves the person with the one chat, in the place they chose.
 */
export class PageSwitch {
  /** The page that has the seat. */
  private holder?: PageHost;

  /** @param onReady told, with the place, when a page there says it is ready; given by a test, which waits for it */
  constructor(private readonly chat: ChatController, private readonly onReady?: (place: Place) => void) {}

  mount(place: Place, host: PageHost): void {
    if (!this.seat(place, host)) { return; }
    host.onDidShow?.(() => {
      if (this.holder !== host && this.seat(place, host)) { void this.chat.handle({ type: 'ready' }); }
    });
  }

  private seat(place: Place, host: PageHost): boolean {
    const taken = this.chat.attachPage(new WebviewViewPort(host, undefined, this.onReady && (() => this.onReady?.(place))));
    if (taken) { this.holder = host; }
    return taken !== undefined;
  }
}
