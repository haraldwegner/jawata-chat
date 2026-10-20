import * as vscode from 'vscode';

import { createChat, type ChatController, type HostPorts, type SessionManager } from '@jawata/chat-core';
import { chatCommands } from './commands';
import { createVscodeHost } from './host/vscodeHost';
import { version as extensionVersion } from '../package.json';
import { StatusBar } from './ui/StatusBar';
import { ChatPanel } from './ui/ChatPanel';
import { ChatWebviewProvider } from './ui/ChatWebviewProvider';
import { PageSwitch } from './ui/PageSwitch';
import { VIEW_OF, chosenPlace, type Place } from './ui/places';
import { log, disposeChannels, setRecordingDir } from './utils/Logger';

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
  const built = createChat(host);
  const sessionManager = built.sessions;
  const chat = built.controller;
  const readyPlaces: Place[] = [];
  const pages = new PageSwitch(chat, place => { readyPlaces.push(place); });
  const panel = new ChatPanel(context.extensionUri, host => pages.mount('center', host));
  /** Show the chat where the setting says: focus its view, or open its tab in the editor area. */
  const showChat = async (): Promise<void> => {
    const place = chosenPlace();
    if (place === 'center') { panel.open(); } else { await vscode.commands.executeCommand(`${VIEW_OF[place]}.focus`); }
  };

  context.subscriptions.push(
    ...(['left', 'right', 'bottom'] as const).map(place => vscode.window.registerWebviewViewProvider(
      VIEW_OF[place], new ChatWebviewProvider(context.extensionUri, host => pages.mount(place, host)), { webviewOptions: { retainContextWhenHidden: true } })),
    new StatusBar(sessionManager),
    ...Object.entries(chatCommands({ chat, showChat }))
      .map(([name, run]) => vscode.commands.registerCommand(`jawataChat.${name}`, run)),
    {
      dispose: () => {
        built.dispose();
        host.terminal.dispose();
        disposeChannels();
      },
    },
  );

  log('jawata chat extension activated.');
  return context.extensionMode === vscode.ExtensionMode.Test ? { chat, sessionManager, host, recordingsDir, readyPlaces } : undefined;
}

/** @public called by the editor */
export function deactivate(): void {
  log('jawata chat extension deactivated.');
}
