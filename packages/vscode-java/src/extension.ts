import * as vscode from 'vscode';
import { LanguageClient, type LanguageClientOptions, type ServerOptions, TransportKind } from 'vscode-languageclient/node';

import { launchOf, rivalNotice, rivalsOf, type ServerSetting } from './launch';

/** The editor's name for this extension's log and for the client the editor shows in its output list. */
const NAME = 'jawata Java';

let client: LanguageClient | undefined;
let channel: vscode.OutputChannel | undefined;

/** Starts the launcher the person named and connects the editor's language client to it; reports what is wrong with the setting instead of starting something else. */
async function start(context: vscode.ExtensionContext): Promise<void> {
  const log = channel ?? (channel = vscode.window.createOutputChannel(NAME));
  const config = vscode.workspace.getConfiguration('jawataJava');
  const rivals = rivalsOf(vscode.extensions.all.map(e => e.id), config.get<string[]>('rivalExtensions', ['redhat.java']));
  if (rivals.length > 0) {
    log.appendLine(rivalNotice(rivals));
    void vscode.window.showWarningMessage(rivalNotice(rivals));
  }
  const launch = launchOf(config.get<ServerSetting>('server'));
  if (!launch.ok) {
    log.appendLine(launch.why);
    void vscode.window.showWarningMessage(launch.why);
    return;
  }
  const server: ServerOptions = {
    command: launch.command,
    args: [...launch.args],
    transport: TransportKind.stdio,
    options: { env: { ...process.env, ...launch.env } },
  };
  const options: LanguageClientOptions = {
    documentSelector: [{ scheme: 'file', language: 'java' }],
    // the engine asks the editor to watch the sources through client/registerCapability; the client library answers that on its own
    outputChannel: log,
  };
  client = new LanguageClient('jawataJava', NAME, server, options);
  context.subscriptions.push({ dispose: () => { void client?.stop(); } });
  await client.start();
  log.appendLine('jawata Java language server connected.');
}

async function stop(): Promise<void> {
  const running = client;
  client = undefined;
  await running?.stop();
}

/**
 * A library class has no file of ours: the engine answers a definition with a `jdt:` address, and the source is asked of it when the
 * editor opens that address, so the person can read the class and navigate from it.
 */
function libraryContent(): vscode.Disposable {
  return vscode.workspace.registerTextDocumentContentProvider('jdt', {
    async provideTextDocumentContent(uri: vscode.Uri): Promise<string> {
      const source = await client?.sendRequest<string | null>('java/classFileContents', { uri: uri.toString() });
      return source ?? '';
    },
  });
}

/** @public called by the editor */
export function activate(context: vscode.ExtensionContext): Promise<void> {
  context.subscriptions.push(
    libraryContent(),
    vscode.commands.registerCommand('jawataJava.showLog', () => { channel?.show(); }),
    vscode.commands.registerCommand('jawataJava.restartServer', async () => { await stop(); await start(context); }),
  );
  return start(context);
}

/** @public called by the editor */
export async function deactivate(): Promise<void> {
  await stop();
}
