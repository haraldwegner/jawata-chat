import * as vscode from 'vscode';
import type { SessionManager } from '@jawata/chat-core';

const CHANGES = ['agent-connected', 'agent-disconnected', 'active-session-changed', 'agent-closed'] as const;

/**
 * The words of the status bar item and of its mouseover. The item carries no icon of its own: a built-in icon is a generic robot, which says
 * nothing about jawata, and an icon of ours needs its own icon font. Only the failed state keeps the built-in error mark, because it is a warning.
 *
 * @public the editor test (src/test/status-bar.test.ts) calls it to check the words; the production check of unused exports does not read tests
 */
export function statusLine(failed: boolean, agentName: string | undefined): { text: string; tooltip: string } {
  if (failed) {
    return { text: '$(error) jawata chat: error', tooltip: 'The agent reported an error; the log has it. Click to connect again.' };
  }
  if (agentName) {
    return { text: `jawata chat: ${agentName}`, tooltip: `Connected to ${agentName}` };
  }
  return { text: 'jawata chat: not connected', tooltip: 'Click to connect to the agent set in jawataChat.agent' };
}

/** One item in the status bar: who the chat is connected to, or that it is not, or that the agent failed. */
export class StatusBar implements vscode.Disposable {
  private readonly item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  private failed = false;

  constructor(private readonly sessions: SessionManager) {
    this.item.command = 'jawataChat.connectAgent';
    for (const event of CHANGES) {
      sessions.on(event, () => this.show(false));
    }
    sessions.on('agent-error', () => this.show(true));
    this.show(false);
  }

  private show(failed: boolean): void {
    this.failed = failed;
    const line = statusLine(this.failed, this.sessions.getActiveSession()?.agentDisplayName);
    this.item.text = line.text;
    this.item.tooltip = line.tooltip;
    this.item.backgroundColor = this.failed ? new vscode.ThemeColor('statusBarItem.errorBackground') : undefined;
    this.item.show();
  }

  dispose(): void {
    this.item.dispose();
  }
}
