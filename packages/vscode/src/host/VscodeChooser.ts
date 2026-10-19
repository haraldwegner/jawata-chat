import * as vscode from 'vscode';
import type { AuthMethod } from '@agentclientprotocol/sdk';
import type { Chooser } from '@jawata/chat-core';
import { log } from '../utils/Logger';

/** The choices that need a person and are the editor's to put: which way to sign in, a yes to something that loses messages. */
export class VscodeChooser implements Chooser {
  async confirm(question: string, yes: string): Promise<boolean> {
    return (await vscode.window.showWarningMessage(question, yes, 'Cancel')) === yes;
  }

  async chooseAuthMethod(agentName: string, methods: AuthMethod[]): Promise<AuthMethod | undefined> {
    const picked = await vscode.window.showQuickPick(
      methods.map(m => ({ label: m.name, description: m.description || '', detail: `ID: ${m.id}`, method: m })),
      { placeHolder: 'Select an authentication method', title: `${agentName} requires authentication` },
    );
    return picked?.method;
  }

  async confirmAuthMethod(agentName: string, method: AuthMethod): Promise<boolean> {
    log(`confirming authentication via ${method.name}`);
    const confirm = await vscode.window.showInformationMessage(
      `${agentName} requires authentication via "${method.name}".`,
      { modal: true, detail: method.description || undefined },
      'Authenticate',
    );
    return confirm === 'Authenticate';
  }
}
