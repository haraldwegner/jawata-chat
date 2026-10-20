import * as vscode from 'vscode';
import { pageHtml, type PageHost } from './chatPage';

/**
 * The chat's webview in a side bar or the bottom panel: a page that loads the built `chat-view` bundle.
 * What serves the page is `mount`; this class only gives the editor a page to show.
 */
export class ChatWebviewProvider implements vscode.WebviewViewProvider {
  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly mount: (host: PageHost) => void,
  ) {}

  resolveWebviewView(webviewView: vscode.WebviewView): void {
    webviewView.webview.options = { enableScripts: true, localResourceRoots: [this.extensionUri] };
    webviewView.webview.html = pageHtml(webviewView.webview, this.extensionUri);
    this.mount({
      webview: webviewView.webview,
      onDidDispose: webviewView.onDidDispose,
      show: preserveFocus => webviewView.show(preserveFocus),
      onDidShow: listener => webviewView.onDidChangeVisibility(() => { if (webviewView.visible) { listener(); } }),
    });
  }
}
