import * as vscode from 'vscode';
import type { HostPorts, TrafficSink } from '@jawata/chat-core';
import { AgentProcesses } from './AgentProcesses';
import { agentMap } from '../config/AgentConfig';
import { WorkspaceFiles } from './WorkspaceFiles';
import { TerminalHost } from './TerminalHost';
import { log, logError, logTraffic, sessionRecordingSink } from '../utils/Logger';
import { VscodeChooser } from './VscodeChooser';
import { VscodeNotifier } from './VscodeNotifier';

/** The ports VS Code gives the chat core: settings, processes, quick picks, files, terminals, the output channels. */
export function createVscodeHost(extensionVersion: string): HostPorts & { agents: AgentProcesses; terminal: TerminalHost } {
  return {
    agents: new AgentProcesses(),
    settings: {
      agents: agentMap,
      workspaceCwd: () => vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd(),
    },
    chooser: new VscodeChooser(),
    fs: new WorkspaceFiles(),
    terminal: new TerminalHost(),
    log: { log: (message) => log(message), logError },
    notifier: new VscodeNotifier(),
    actions: {
      configureAgent: async () => { await vscode.commands.executeCommand('jawataChat.configureAgent'); },
    },
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
