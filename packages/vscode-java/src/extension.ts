import * as vscode from 'vscode';
import { LanguageClient, type LanguageClientOptions, type ServerOptions, TransportKind } from 'vscode-languageclient/node';

import { debuggerOf, refactoringOf, testingOf } from './features';
import { launchOf, rivalNotice, rivalsOf, type ServerSetting } from './launch';
import { profilePageOf } from './profilePanel';
import { ProjectsView } from './projectsView';
import { addressOf, editorFoldersOf, nodePorts, StudioStart, toldToThePerson, type EngineAnswer, type StudioOutcome, type StudioSetting } from './studio';

/** The editor's name for this extension's log and for the client the editor shows in its output list. */
const NAME = 'jawata Java';

let client: LanguageClient | undefined;
let channel: vscode.OutputChannel | undefined;

/** The folders the window has open (the ones on disk), by their real paths. */
function windowFolders(): string[] {
  return editorFoldersOf((vscode.workspace.workspaceFolders ?? []).filter(folder => folder.uri.scheme === 'file').map(folder => folder.uri.fsPath));
}

let studioStart: StudioStart | undefined;
let projects: ProjectsView | undefined;
/** The engine the studio named for this window, which the language server's launcher and the debugger's launcher both run against. */
let engine: EngineAnswer | undefined;

/**
 * The launcher is a pipe to the engine's service, so the service has to answer before the language client starts: the window's folders are
 * handed to the studio when `jawataJava.studio` carries `handoffDir` (the studio says which engine this window uses), and otherwise the
 * studio is started from `jawataJava.studio` and waited for (at most two minutes) when the address does not answer. Says in the log what it
 * found and tells the person when the studio was needed and could not be brought up; never rejects, so the start goes on as it did before
 * whatever happened. The outcome may carry the engine's key: it is not written down here, only handed to the launch.
 */
async function lookAfterStudio(log: vscode.OutputChannel): Promise<StudioOutcome> {
  const config = vscode.workspace.getConfiguration('jawataJava');
  studioStart?.dispose();
  const studio = studioStart = new StudioStart(nodePorts(
    (text, job) => Promise.resolve(vscode.window.withProgress({ location: vscode.ProgressLocation.Notification, title: text, cancellable: false }, job)),
    undefined,
    text => { void vscode.window.showInformationMessage(`jawata Java: ${text}`); }));
  const outcome = await studio.ensure(addressOf(config.get<ServerSetting>('server')), config.get<StudioSetting>('studio'), windowFolders());
  log.appendLine(`studio: ${outcome.kind}: ${outcome.why}`);
  if (toldToThePerson(outcome)) { void vscode.window.showWarningMessage(`jawata Java: ${outcome.why}`); }
  return outcome;
}

/** Starts the launcher the person named and connects the editor's language client to it; reports what is wrong with the setting instead of starting something else. */
async function start(context: vscode.ExtensionContext): Promise<void> {
  const log = channel ?? (channel = vscode.window.createOutputChannel(NAME));
  const config = vscode.workspace.getConfiguration('jawataJava');
  const rivals = rivalsOf(vscode.extensions.all.map(e => e.id), config.get<string[]>('rivalExtensions', ['redhat.java']));
  if (rivals.length > 0) {
    log.appendLine(rivalNotice(rivals));
    void vscode.window.showWarningMessage(rivalNotice(rivals));
  }
  const studio = await lookAfterStudio(log);
  engine = studio.engine;
  const launch = launchOf(config.get<ServerSetting>('server'), studio.engine);
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
  void projects?.refresh().catch(e => log.appendLine(`Java Projects: ${String(e)}`));
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

/** What a lens click does: asks the editor's provider for the places, shows them in the references view and returns them. */
async function showPlaces(provider: string, uri: string, line: number, character: number): Promise<vscode.Location[]> {
  const target = vscode.Uri.parse(uri);
  const position = new vscode.Position(line, character);
  const locations = (await vscode.commands.executeCommand<vscode.Location[]>(provider, target, position)) ?? [];
  await vscode.commands.executeCommand('editor.action.showReferences', target, position, locations);
  return locations;
}

/** What the extension hands to a test that runs in the same window: the engine's own requests (tests, profile), which no editor provider carries. */
interface ExtensionApi {
  request(method: string, params: unknown): Promise<unknown>;
}

/** @public called by the editor */
export async function activate(context: vscode.ExtensionContext): Promise<ExtensionApi> {
  projects = new ProjectsView(() => client);
  context.subscriptions.push(
    vscode.window.registerTreeDataProvider('jawataJava.projects', projects),
    vscode.commands.registerCommand('jawataJava.refreshProjects', () => projects?.refresh()),
    libraryContent(),
    debuggerOf(() => vscode.workspace.getConfiguration('jawataJava').get<ServerSetting>('server'), () => engine),
    testingOf(() => client),
    refactoringOf(() => client),
    profilePageOf(context.extensionUri, () => client),
    vscode.commands.registerCommand('jawataJava.showLog', () => { channel?.show(); }),
    vscode.commands.registerCommand('jawataJava.restartServer', async () => { await stop(); await start(context); }),
    // the commands a code lens carries ("3 references", "2 implementations"): the places the editor's own search finds, shown in the
    // references view, and answered to the caller so a click can be checked in a test
    vscode.commands.registerCommand('jawata.showReferences', (uri: string, line: number, character: number) =>
      showPlaces('vscode.executeReferenceProvider', uri, line, character)),
    vscode.commands.registerCommand('jawata.showImplementations', (uri: string, line: number, character: number) =>
      showPlaces('vscode.executeImplementationProvider', uri, line, character)),
  );
  await start(context);
  return {
    request: (method, params) => (client ? client.sendRequest<unknown>(method, params) : Promise.reject(new Error('the jawata language server is not running'))),
  };
}

/** @public called by the editor */
export async function deactivate(): Promise<void> {
  studioStart?.dispose();
  await stop();
}
