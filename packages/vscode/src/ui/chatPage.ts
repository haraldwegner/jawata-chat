import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';
import { themeCss } from './theme';

/** Where the chat's page lives: a webview, and what to do when it goes and when it is asked to show itself. A view and an editor panel both fit. */
export interface PageHost {
  webview: vscode.Webview;
  onDidDispose: vscode.Event<void>;
  show?(preserveFocus?: boolean): void;
}

/** The page: an empty root and the one script of the built view, allowed to run by a nonce and nothing else. */
export function pageHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const nonce = randomBytes(16).toString('base64url');
  const script = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'dist', 'webview.js'));
  const policy = [`default-src 'none'`, `style-src ${webview.cspSource} 'unsafe-inline'`, `script-src 'nonce-${nonce}'`].join('; ');
  return [
    '<!DOCTYPE html>',
    '<html lang="en">',
    `<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><meta http-equiv="Content-Security-Policy" content="${policy};"><title>jawata chat</title><style>${themeCss()}</style></head>`,
    `<body><div id="root"></div><script nonce="${nonce}" src="${script}"></script></body>`,
    '</html>',
  ].join('\n');
}
