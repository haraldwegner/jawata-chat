import * as vscode from 'vscode';
import { AGENT_KEY, type AgentConfigEntry } from '@jawata/chat-core';

/** The one agent, as the `jawataChat.agent` setting names it; undefined until a command is set. */
function configuredAgent(): AgentConfigEntry | undefined {
  const entry = vscode.workspace.getConfiguration('jawataChat').get<AgentConfigEntry>('agent');
  return entry?.command ? entry : undefined;
}

/** What the core's settings port asks for: a map, which here always has the one entry or none. */
export function agentMap(): Record<string, AgentConfigEntry> {
  const entry = configuredAgent();
  return entry ? { [AGENT_KEY]: entry } : {};
}
