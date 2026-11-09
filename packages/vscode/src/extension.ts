import * as vscode from 'vscode';

import { createChat, type ChatController, type HostPorts, type SessionManager } from '@jawata/chat-core';
import { chatCommands } from './commands';
import { createVscodeHost } from './host/vscodeHost';
import { version as extensionVersion } from '../package.json';
import { StatusBar } from './ui/StatusBar';
import { ChatPanel } from './ui/ChatPanel';
import { ChatWebviewProvider } from './ui/ChatWebviewProvider';
import { PageSwitch } from './ui/PageSwitch';
import { WebviewViewPort } from './ui/ViewPort';
import type { PageHost } from './ui/chatPage';
import { forgetEditorTheme, saveEditorTheme, type EditorTheme } from './editorTheme';
import { VIEW_OF, chosenPlace, type Place } from './ui/places';
import { log, disposeChannels, setRecordingDir } from './utils/Logger';
import { nodePorts, StudioStart } from './studio';
import { lookAfterStudio } from './host/lookAfterStudio';

/** How long the editor needs, after the placement setting changes, to bring the views of the chosen place into being. */
const PLACEMENT_SETTLE_MS = 300;

/**
 * What the extension hands to the editor tests: the chat's controller, to which a recording port can be attached. Only in test mode: production hands out nothing.
 * @public read by the editor tests
 */
export interface JawataChatApi {
  chat: ChatController;
  /** The ports the chat runs on; a test replaces one (the chooser) to answer for the person. */
  host: HostPorts;
  sessionManager: SessionManager;
  /** The folder session recordings are written to, when the recording switch is on. */
  recordingsDir: string;
  /** The places whose page has said ready, in the order it did. */
  readyPlaces: readonly Place[];
}

/** @public called by the editor */
export function activate(context: vscode.ExtensionContext): JawataChatApi | undefined {
  log('jawata chat extension activating...');
  const recordingsDir = vscode.Uri.joinPath(context.globalStorageUri, 'recordings').fsPath;
  setRecordingDir(recordingsDir);

  const host = createVscodeHost(extensionVersion);
  // the engine's service must answer before an agent that talks to it is started: if it does not, the studio is started and waited for here,
  // in the background, and the first agent start waits for it (28h S21 (d))
  const studioStart = new StudioStart(nodePorts((text, job) => host.notifier.progress(text, job), undefined, text => { void vscode.window.showInformationMessage(`jawata chat: ${text}`); }));
  host.agents.holdUntil(lookAfterStudio(studioStart));
  const built = createChat(host);
  const sessionManager = built.sessions;
  const chat = built.controller;
  const readyPlaces: Place[] = [];
  // only a test asks which places said ready; production keeps no list
  const testMode = context.extensionMode === vscode.ExtensionMode.Test;
  const pages = new PageSwitch(chat, testMode ? place => { readyPlaces.push(place); } : undefined);
  const panel = new ChatPanel(context.extensionUri, host => pages.mount('center', host));
  let leftHost: PageHost | undefined;
  /** Show the chat where the setting says: focus its view, or open its tab in the editor area. */
  const showChat = async (): Promise<void> => {
    const place = chosenPlace();
    if (place === 'center') { panel.open(); return; }
    panel.close(); // the tab is a place of its own: leaving it closes it, so that no frozen copy stays in the editor area
    await vscode.commands.executeCommand(`${VIEW_OF[place]}.focus`);
    // the left view exists whatever the place is, so choosing it may resolve nothing new: the page already there takes the chat
    if (place === 'left' && leftHost) { pages.show('left', leftHost); }
  };

  /**
   * The logo in the activity bar always shows the chat. Where the chat is placed on the left it is this view; placed elsewhere the view is only
   * the way there: a click brings the chat forward and the side bar goes back to the Explorer the person was in.
   */
  const mountLeft = (host: PageHost): void => {
    leftHost = host;
    const shown = () => {
      if (chosenPlace() === 'left') { pages.show('left', host); return; }
      void showChat().then(() => vscode.commands.executeCommand('workbench.view.explorer'));
    };
    shown();
    host.onDidShow?.(shown);
  };

  // Agent Control is always there: it is opened with the window, and the editor keeps the focus
  void vscode.commands.executeCommand('jawata-agents-view.focus').then(() => vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup'));

  context.subscriptions.push(
    // the Escape key and the cancel button read whether a turn is running; the chat says so itself, whatever page is open (28i-C13-6)
    chat.onTurnChanged(on => { void vscode.commands.executeCommand('setContext', 'jawataChat.turnInProgress', on); }),
    // choosing another place moves the chat that is open (not one that is not: the setting alone opens nothing): the old place's view goes
    // (its when clause) or its tab closes, and the new place opens and takes the seat. The editor takes the setting into the places that exist a moment later.
    vscode.workspace.onDidChangeConfiguration(change => {
      if (change.affectsConfiguration('jawataChat.placement') && chat.hasPage) { setTimeout(() => { void showChat(); }, PLACEMENT_SETTLE_MS); }
    }),
    ...(['left', 'right', 'bottom'] as const).map(place => vscode.window.registerWebviewViewProvider(
      VIEW_OF[place], new ChatWebviewProvider(context.extensionUri, host => (place === 'left' ? mountLeft(host) : pages.mount(place, host))), { webviewOptions: { retainContextWhenHidden: true } })),
    vscode.window.registerWebviewViewProvider('jawata-agents-view', new ChatWebviewProvider(context.extensionUri, host => {
      host.webview.onDidReceiveMessage((message: EditorTheme) => { if (message?.type === 'editorTheme') { void saveEditorTheme(message); } });
      chat.attachPanel(new WebviewViewPort(host));
    }, 'agents'), { webviewOptions: { retainContextWhenHidden: true } }),
    vscode.window.registerWebviewViewProvider('jawata-btw-view', new ChatWebviewProvider(context.extensionUri, host => {
      chat.attachPanel(new WebviewViewPort(host));
    }, 'side'), { webviewOptions: { retainContextWhenHidden: true } }),
    new StatusBar(sessionManager),
    ...Object.entries(chatCommands({ chat, showChat }))
      .map(([name, run]) => vscode.commands.registerCommand(`jawataChat.${name}`, run)),
    {
      dispose: () => {
        studioStart.dispose();
        built.dispose();
        host.terminal.dispose();
        disposeChannels();
      },
    },
  );

  log('jawata chat extension activated.');
  return testMode ? { chat, sessionManager, host, recordingsDir, readyPlaces } : undefined;
}

/** @public called by the editor */
export function deactivate(): void {
  forgetEditorTheme();
  log('jawata chat extension deactivated.');
}
