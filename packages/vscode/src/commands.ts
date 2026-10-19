import * as vscode from 'vscode';
import type { ChatController } from '@jawata/chat-core';
import { getOutputChannel, getTrafficChannel, lastRecordingPath } from './utils/Logger';

interface Parts {
  chat: ChatController;
  /** Show the chat where the placement setting says. */
  showChat: () => Promise<void>;
}

type Command = (...args: any[]) => unknown;

/** A command that asks for one word (a mode or a model id) when it is not given one, then asks the chat to apply it. */
function askAndApply(
  prompt: { title: string; placeHolder: string },
  intent: (value: string) => { type: 'setMode'; modeId: string } | { type: 'setModel'; modelId: string },
  { chat }: Parts,
): Command {
  return async (value?: string) => {
    const chosen = value || await vscode.window.showInputBox(prompt);
    if (!chosen) { return; }
    await chat.handle(intent(chosen)); // a refusal by the agent is told in the chat, by the chat
  };
}

/**
 * Every command the extension contributes, by the part of its id after `jawataChat.`. What the person
 * starts on the conversation is the chat's flow; what is here is what only the editor can do: focus
 * the view, a quick pick, an input box, a file dialog, the output channels.
 */
export function chatCommands(parts: Parts): Record<string, Command> {
  const { chat, showChat } = parts;
  const { flow } = chat;

  return {
    connectAgent: () => flow.connect(),
    newConversation: () => flow.newConversation(),
    disconnectAgent: () => flow.disconnect(),
    restartAgent: () => flow.restart(),

    openChat: () => showChat(),

    sendPrompt: async (text?: unknown) => {
      if (typeof text === 'string' && text.length > 0) {
        await chat.sendPrompt(text);
      } else {
        await showChat();
      }
    },

    cancelTurn: () => chat.handle({ type: 'cancelTurn' }),

    setMode: askAndApply({ title: 'Set the agent mode', placeHolder: 'The mode id, for example "plan"' }, modeId => ({ type: 'setMode', modeId }), parts),
    setModel: askAndApply({ title: 'Set the agent model', placeHolder: 'The model id' }, modelId => ({ type: 'setModel', modelId }), parts),

    configureAgent: () => vscode.commands.executeCommand('workbench.action.openSettings', 'jawataChat.agent'),

    attachFile: async () => {
      const [chosen] = await vscode.window.showOpenDialog({ canSelectMany: false, openLabel: 'Attach', title: 'Attach a file to the next prompt' }) ?? [];
      if (chosen) { chat.attachFile(chosen.fsPath); }
    },

    showLog: () => getOutputChannel().show(),
    showTraffic: () => getTrafficChannel().show(),

    openRecording: async () => {
      const file = lastRecordingPath();
      if (!file) {
        void vscode.window.showInformationMessage('No session has been recorded yet. Turn on the jawataChat.recordSessions setting to keep recordings.');
        return;
      }
      await vscode.window.showTextDocument(vscode.Uri.file(file));
    },
  };
}
