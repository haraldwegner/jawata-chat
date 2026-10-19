import * as vscode from 'vscode';
import { pageHtml, type PageHost } from './chatPage';

/** The chat in the editor area, as a tab in the middle: one at most, shown again when asked for. */
export class ChatPanel {
  private panel?: vscode.WebviewPanel;

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly mount: (host: PageHost) => void,
  ) {}

  open(): void {
    if (this.panel) { this.panel.reveal(); return; }
    const panel = vscode.window.createWebviewPanel('jawata-chat-center', 'jawata chat', vscode.ViewColumn.Active, {
      enableScripts: true, retainContextWhenHidden: true, localResourceRoots: [this.extensionUri],
    });
    panel.webview.html = pageHtml(panel.webview, this.extensionUri);
    panel.onDidDispose(() => { if (this.panel === panel) { this.panel = undefined; } });
    this.panel = panel;
    this.mount({ webview: panel.webview, onDidDispose: panel.onDidDispose, show: () => panel.reveal() });
  }
}
