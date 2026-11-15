import { randomBytes } from 'node:crypto';
import * as vscode from 'vscode';
import type { LanguageClient } from 'vscode-languageclient/node';
import type { ProfileResult } from '@jawata/profile-view';

import { currentSession } from './features';
import { answerPage, type PageMessage, type ProfileHost } from './profileHost';

/** The page's colours and spacing, from the editor's own theme variables, so the host-neutral view looks native here. */
const STYLE = `
  body { color: var(--vscode-foreground); font-family: var(--vscode-font-family); font-size: var(--vscode-font-size); padding: 12px; }
  .profile-controls { display: flex; gap: 12px; align-items: end; margin-bottom: 12px; }
  .profile-controls label { display: flex; flex-direction: column; gap: 2px; }
  .profile-record { background: var(--vscode-button-background); color: var(--vscode-button-foreground); border: 0; padding: 5px 12px; cursor: pointer; }
  .profile-record:disabled { opacity: .6; cursor: default; }
  .profile-rows { border-collapse: collapse; width: 100%; }
  .profile-rows th, .profile-rows td { text-align: left; padding: 3px 8px; border-bottom: 1px solid var(--vscode-editorGroup-border); }
  .profile-open { background: none; border: 0; color: var(--vscode-textLink-foreground); cursor: pointer; padding: 0; font: inherit; }
  .profile-nosource { color: var(--vscode-descriptionForeground); }
  .profile-bar { display: inline-block; height: 8px; margin-right: 6px; background: var(--vscode-charts-blue); }
  .profile-failed { color: var(--vscode-errorForeground); margin-bottom: 8px; }
  .profile-empty { color: var(--vscode-descriptionForeground); }
`;

/** The page: an empty root and the one script of the built page, allowed to run by a nonce and nothing else. */
function pageHtml(webview: vscode.Webview, extensionUri: vscode.Uri): string {
  const nonce = randomBytes(16).toString('base64url');
  const script = webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, 'dist', 'profile.js'));
  const policy = [`default-src 'none'`, `style-src ${webview.cspSource} 'unsafe-inline'`, `script-src 'nonce-${nonce}'`].join('; ');
  return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta http-equiv="Content-Security-Policy" content="${policy};"><title>jawata profile</title><style>${STYLE}</style></head>`
    + `<body><div id="root"></div><script nonce="${nonce}" src="${script}"></script></body></html>`;
}

/**
 * The profile page as an editor panel: the command opens it, the page records the person's running program through the engine and shows where the
 * time goes, and a click on a method opens its source. The page itself is the host-neutral view; this is its VS Code adapter.
 */
export function profilePageOf(extensionUri: vscode.Uri, clientOf: () => LanguageClient | undefined): vscode.Disposable {
  let panel: vscode.WebviewPanel | undefined;
  const host: ProfileHost = {
    session: currentSession,
    profile: request => {
      const client = clientOf();
      if (!client) { return Promise.reject(new Error('The jawata language server is not running.')); }
      return client.sendRequest<ProfileResult>('jawata/profile', request);
    },
    open: async location => {
      const { start, end } = location.range;
      await vscode.window.showTextDocument(vscode.Uri.parse(location.uri), { selection: new vscode.Range(start.line, start.character, end.line, end.character) });
    },
  };
  const show = (): void => {
    if (panel) { panel.reveal(); return; }
    panel = vscode.window.createWebviewPanel('jawataJava.profile', 'jawata profile', vscode.ViewColumn.Beside, {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'dist')],
    });
    const open = panel;
    open.webview.html = pageHtml(open.webview, extensionUri);
    open.webview.onDidReceiveMessage(async (message: PageMessage) => {
      const reply = await answerPage(message, host);
      if (reply) { await open.webview.postMessage(reply); }
    });
    open.onDidDispose(() => { panel = undefined; });
  };
  return vscode.Disposable.from(vscode.commands.registerCommand('jawataJava.profile', show), new vscode.Disposable(() => { panel?.dispose(); }));
}
