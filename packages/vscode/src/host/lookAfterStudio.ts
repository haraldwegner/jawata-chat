import * as vscode from 'vscode';
import type { AgentConfigEntry } from '@jawata/chat-core';
import { addressOf, editorFoldersOf, StudioStart, toldToThePerson, type StudioOutcome, type StudioSetting } from '../studio';
import { log } from '../utils/Logger';

/**
 * Hands the window's folders to the studio again whenever they change (his word 2026-11-20): the studio writes them where the engine reads its
 * access on every call, so a folder the window opens is reached by jawata's agents at once and one it closes is not, whether the engine was
 * started before the editor or after. The disposable stops it.
 */
export function handOnEveryFolderChange(
  studio: StudioStart,
  changed: vscode.Event<vscode.WorkspaceFoldersChangeEvent> = vscode.workspace.onDidChangeWorkspaceFolders,
  look: (studio: StudioStart, folders: readonly string[]) => Promise<StudioOutcome> = lookAfterStudio,
  folders: () => string[] = windowFolders,
): vscode.Disposable {
  return changed(() => { void look(studio, folders()); });
}

/** The folders the window has open (the ones on disk), by their real paths. */
function windowFolders(): string[] {
  return editorFoldersOf((vscode.workspace.workspaceFolders ?? []).filter(folder => folder.uri.scheme === 'file').map(folder => folder.uri.fsPath));
}

/**
 * At activation: reads the engine address from the agent setting and the studio from `jawataChat.studio`, hands the window's folders to the
 * studio when the setting carries `handoffDir` (the studio then says which engine this window uses, see {@link StudioStart.ensure}), and
 * otherwise has the studio started if the service does not answer. Says in the log what it found, and tells the person when the studio was
 * needed and could not be brought up. Never rejects, so the chat goes on as it did before whatever happened. The outcome may carry the
 * engine's key: it is not written down here, only handed to whoever starts the agent.
 */
export async function lookAfterStudio(studio: StudioStart, folders: readonly string[] = windowFolders(), write: (line: string) => void = log): Promise<StudioOutcome> {
  const config = vscode.workspace.getConfiguration('jawataChat');
  const outcome = await studio.ensure(addressOf(config.get<AgentConfigEntry>('agent')), config.get<StudioSetting>('studio'), folders);
  write(`studio: ${outcome.kind}: ${outcome.why}`);
  if (toldToThePerson(outcome)) { void vscode.window.showWarningMessage(`jawata chat: ${outcome.why}`); }
  return outcome;
}
