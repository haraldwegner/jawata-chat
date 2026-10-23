import * as vscode from 'vscode';
import type { PageHost } from './chatPage';
import type { Disposable, ViewMessage, ViewPort } from '@jawata/chat-core';

const setTurnKey = (on: boolean) => { void vscode.commands.executeCommand('setContext', 'jawataChat.turnInProgress', on); };

/**
 * The port of a VS Code webview (a view, or a panel in the editor area): the host's half of the contract chat-core defines. The core
 * tells it when a turn starts or ends ({@link ViewPort.turnChanged}), and it passes that to the editor (the Escape key and the cancel
 * button read it); it does not fold the messages itself.
 */
export class WebviewViewPort implements ViewPort {
  /** @param onReady told when the page says it is ready */
  constructor(private readonly view: PageHost, private readonly announceTurn: (on: boolean) => void = setTurnKey, private readonly onReady?: () => void) {}

  post(message: ViewMessage): void {
    void this.view.webview.postMessage(message);
  }

  turnChanged(inProgress: boolean): void {
    this.announceTurn(inProgress);
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
