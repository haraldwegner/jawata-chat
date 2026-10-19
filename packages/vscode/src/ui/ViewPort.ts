import * as vscode from 'vscode';
import type { PageHost } from './chatPage';
import { initialViewState, reduce, type Disposable, type ViewMessage, type ViewPort } from '@jawata/chat-core';

const setTurnKey = (on: boolean) => { void vscode.commands.executeCommand('setContext', 'jawataChat.turnInProgress', on); };

/**
 * The port of a VS Code webview (a view, or a panel in the editor area): the host's half of the contract chat-core defines. It folds the
 * messages that pass with the core's own {@link reduce}, so whether a turn is running is the core's
 * answer, and tells the editor (the Escape key and the cancel button read it) when that answer changes.
 */
export class WebviewViewPort implements ViewPort {
  private state = initialViewState();

  /** @param onReady told when the page says it is ready */
  constructor(private readonly view: PageHost, private readonly announceTurn: (on: boolean) => void = setTurnKey, private readonly onReady?: () => void) {}

  post(message: ViewMessage): void {
    const next = reduce(this.state, message);
    if (next.processing !== this.state.processing) { this.announceTurn(next.processing); }
    this.state = next;
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
