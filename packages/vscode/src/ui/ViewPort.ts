import type { PageHost } from './chatPage';
import type { Disposable, ViewMessage, ViewPort } from '@jawata/chat-core';

/**
 * The port of a VS Code webview (a view, or a panel in the editor area): the host's half of the contract chat-core defines. It passes
 * messages on and does not fold them; whether a turn is running reaches the editor from the chat itself (extension.ts).
 */
export class WebviewViewPort implements ViewPort {
  /** @param onReady told when the page says it is ready */
  constructor(private readonly view: PageHost, private readonly onReady?: () => void) {}

  post(message: ViewMessage): void {
    void this.view.webview.postMessage(message);
  }

  onMessage(handler: (message: unknown) => void | Promise<void>): Disposable {
    return this.view.webview.onDidReceiveMessage((message: unknown) => {
      if ((message as { type?: unknown } | null)?.type === 'ready') { this.onReady?.(); }
      return handler(message);
    });
  }

  reveal(): void {
    this.view.show?.(true);
  }

  onDispose(handler: () => void): Disposable {
    return this.view.onDidDispose(handler);
  }
}
