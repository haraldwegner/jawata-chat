import * as vscode from 'vscode';
import { extname } from 'node:path';
import type { ChosenFile, HostActions, HostPorts, Settings, TrafficSink } from '@jawata/chat-core';
import { AgentProcesses } from './AgentProcesses';
import { agentMap } from '../config/AgentConfig';
import { WorkspaceFiles } from './WorkspaceFiles';
import { TerminalHost } from './TerminalHost';
import { log, logError, logTraffic, sessionRecordingSink } from '../utils/Logger';
import { VscodeChooser } from './VscodeChooser';
import { VscodeNotifier } from './VscodeNotifier';

const IMAGE_TYPES: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' };

/** A picked file; a picture comes with its bytes, so the agent receives the picture and not a path. */
async function chosenFile(uri: vscode.Uri): Promise<ChosenFile> {
  const mimeType = IMAGE_TYPES[extname(uri.fsPath).toLowerCase()];
  if (!mimeType) { return { path: uri.fsPath }; }
  const bytes = await vscode.workspace.fs.readFile(uri);
  return { path: uri.fsPath, image: { mimeType, data: Buffer.from(bytes).toString('base64') } };
}

/** The ports VS Code gives the chat core: settings, processes, quick picks, files, terminals, the output channels. */
export function createVscodeHost(extensionVersion: string): HostPorts & { agents: AgentProcesses; terminal: TerminalHost } {
  const settings: Settings = {
    agents: agentMap,
    agentSetup: 'the jawataChat.agent setting',
    workspaceCwd: () => vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd(),
  };
  const actions: HostActions = {
    configureAgent: async () => { await vscode.commands.executeCommand('jawataChat.configureAgent'); },
    showSide: () => {
      void vscode.commands.executeCommand('setContext', 'jawataChat.btwOpen', true)
        .then(() => vscode.commands.executeCommand('jawata-btw-view.focus'));
    },
    hideSide: () => { void vscode.commands.executeCommand('setContext', 'jawataChat.btwOpen', false); },
    chooseFiles: async () => {
      const chosen = await vscode.window.showOpenDialog({ canSelectMany: true, openLabel: 'Attach', title: 'Attach to the next message' });
      return Promise.all((chosen ?? []).map(chosenFile));
    },
  };
  return {
    agents: new AgentProcesses(),
    settings,
    chooser: new VscodeChooser(),
    fs: new WorkspaceFiles(),
    terminal: new TerminalHost(),
    log: { log: (message) => log(message), logError },
    notifier: new VscodeNotifier(),
    actions,
    sinks: (agentId: string): TrafficSink[] => {
      const sinks: TrafficSink[] = [logTraffic];
      const recording = sessionRecordingSink(agentId);
      if (recording) {
        sinks.push(recording.sink);
        log(`recording session to ${recording.filePath}`);
      }
      return sinks;
    },
    clientInfo: { name: 'vscode-jawata-chat', version: extensionVersion },
  };
}
