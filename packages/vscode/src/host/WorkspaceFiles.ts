import * as vscode from 'vscode';
import type { ReadTextFileRequest, ReadTextFileResponse, WriteTextFileRequest, WriteTextFileResponse } from '@agentclientprotocol/sdk';
import type { FsPort } from '@jawata/chat-core';
import { log, logError } from '../utils/Logger';

/**
 * The part of a text the agent asked for: `line` is where it starts, counting from 1, and `limit` is
 * how many lines. Neither given means all of it.
 * @public read by the editor tests
 */
export function linesOf(text: string, line?: number | null, limit?: number | null): string {
  const absent = (n?: number | null) => n === undefined || n === null;
  if (absent(line) && absent(limit)) { return text; }
  const first = Math.max((line ?? 1) - 1, 0);
  const all = text.split('\n');
  return all.slice(first, limit ? first + limit : all.length).join('\n');
}

/**
 * The files the agent reads and writes, through the editor's workspace: a file that is open with
 * unsaved changes is read as the person sees it, and a file the agent writes is shown.
 */
export class WorkspaceFiles implements FsPort {
  async readTextFile(request: ReadTextFileRequest): Promise<ReadTextFileResponse> {
    log(`readTextFile: ${request.path}`);
    try {
      const uri = vscode.Uri.file(request.path);
      const open = vscode.workspace.textDocuments.find(d => d.uri.fsPath === uri.fsPath);
      const text = open ? open.getText() : Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf-8');
      return { content: linesOf(text, request.line, request.limit) };
    } catch (e) {
      logError(`readTextFile failed: ${request.path}`, e);
      throw e;
    }
  }

  async writeTextFile(request: WriteTextFileRequest): Promise<WriteTextFileResponse> {
    log(`writeTextFile: ${request.path}`);
    try {
      const uri = vscode.Uri.file(request.path);
      await vscode.workspace.fs.writeFile(uri, Buffer.from(request.content, 'utf-8'));
      const shown = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(shown, { preview: true, preserveFocus: true });
      return {};
    } catch (e) {
      logError(`writeTextFile failed: ${request.path}`, e);
      throw e;
    }
  }
}
