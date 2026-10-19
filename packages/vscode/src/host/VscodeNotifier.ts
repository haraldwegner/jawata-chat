import * as vscode from 'vscode';
import type { Notifier } from '@jawata/chat-core';

/** What the core tells the person, as VS Code shows it: a progress notification, information and error messages. */
export class VscodeNotifier implements Notifier {
  progress<T>(title: string, job: () => Promise<T>): Promise<T> {
    return Promise.resolve(vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title, cancellable: false }, job));
  }

  info(message: string): void {
    void vscode.window.showInformationMessage(message);
  }

  error(message: string): void {
    void vscode.window.showErrorMessage(message);
  }
}
