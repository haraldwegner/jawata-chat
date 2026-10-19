import * as vscode from 'vscode';
import type { SessionManager } from '@jawata/chat-core';

const CHANGES = ['agent-connected', 'agent-disconnected', 'active-session-changed', 'agent-closed'] as const;

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
    const session = this.sessions.getActiveSession();
    if (this.failed) {
      this.item.text = '$(error) jawata chat: error';
      this.item.tooltip = 'The agent reported an error; the log has it. Click to connect again.';
      this.item.backgroundColor = new vscode.ThemeColor('statusBarItem.errorBackground');
    } else if (session) {
      this.item.text = `$(hubot) jawata chat: ${session.agentDisplayName}`;
      this.item.tooltip = `Connected to ${session.agentDisplayName}`;
      this.item.backgroundColor = undefined;
    } else {
      this.item.text = '$(hubot) jawata chat: not connected';
      this.item.tooltip = 'Click to connect to the agent set in jawataChat.agent';
      this.item.backgroundColor = undefined;
    }
    this.item.show();
  }

  dispose(): void {
    this.item.dispose();
  }
}
