import * as vscode from 'vscode';
import type { Notifier } from '@jawata/chat-core';

/** How many of the last messages are kept for {@link VscodeNotifier.told}. */
const KEPT = 20;

/** What the core tells the person, as VS Code shows it: a progress notification, information and error messages. */
export class VscodeNotifier implements Notifier {
  /** The last information and error messages shown, oldest first: what the person was told, which an editor test reads (28h D57 (e)). */
  readonly told: string[] = [];

  progress<T>(title: string, job: () => Promise<T>): Promise<T> {
    return Promise.resolve(vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title, cancellable: false }, job));
  }

  info(message: string): void {
    this.keep(message);
    void vscode.window.showInformationMessage(message);
  }

  error(message: string): void {
    this.keep(message);
    void vscode.window.showErrorMessage(message);
  }

  private keep(message: string): void {
    this.told.push(message);
    this.told.splice(0, Math.max(0, this.told.length - KEPT));
  }
}
