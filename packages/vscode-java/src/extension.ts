import * as vscode from 'vscode';
import { LanguageClient, type LanguageClientOptions, type ServerOptions, TransportKind } from 'vscode-languageclient/node';

import { debuggerOf, refactoringOf, testingOf } from './features';
import { launchOf, rivalNotice, rivalRemovalOf, uninstallOrder, type InstalledExtension, type RivalRemoval, type ServerSetting } from './launch';
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

/**
 * An installed extension as the rival notice reads it: its identifier, the name the person sees, and what it depends on. A pack counts the
 * extensions it holds as what it depends on, because uninstalling one it holds while the pack stays fails.
 *
 * DELIBERATE DUPLICATE: the studio's deploy (jawata-studio `vscode_deploy.rs`, `removal_order`) answers the same question from the command
 * line before this extension runs; this answers it inside the editor for an install made after the deploy. They run in different programs
 * and repositories, so they read the same two manifest fields and are held to the same order by their own tests.
 */
function installedOf(extension: vscode.Extension<unknown>): InstalledExtension {
  const manifest = (extension.packageJSON ?? {}) as { displayName?: unknown; extensionDependencies?: unknown; extensionPack?: unknown };
  const ids = (list: unknown): string[] => (Array.isArray(list) ? list.filter((d): d is string => typeof d === 'string') : []);
  const dependsOn = [...ids(manifest.extensionDependencies), ...ids(manifest.extensionPack)];
  return { id: extension.id, name: typeof manifest.displayName === 'string' && manifest.displayName ? manifest.displayName : extension.id, dependsOn };
}

/** The label of the warning's button that uninstalls a rival and what needs it. */
const UNINSTALL = 'Uninstall';

/**
 * Tells the person a rival Java server is installed and offers to uninstall it, with the extensions that need it, through the editor's own
 * command. The editor only lets go of an uninstalled extension when the window is reloaded, so the person is told that and offered it.
 */
function offerRemoval(removal: RivalRemoval, log: vscode.OutputChannel): void {
  const notice = rivalNotice(removal);
  log.appendLine(notice);
  void vscode.window.showWarningMessage(notice, UNINSTALL).then(async answer => {
    if (answer !== UNINSTALL) { return; }
    for (const id of uninstallOrder(removal)) {
      try {
        await vscode.commands.executeCommand('workbench.extensions.uninstallExtension', id);
        log.appendLine(`uninstalled ${id}`);
      } catch (e) {
        const why = `${id} could not be uninstalled: ${e instanceof Error ? e.message : String(e)}. Uninstall it in the Extensions view.`;
        log.appendLine(why);
        void vscode.window.showWarningMessage(`jawata Java: ${why}`);
        return;
      }
    }
    const reload = 'Reload Window';
    if (await vscode.window.showInformationMessage('jawata Java: uninstalled. Reload the window to finish.', reload) === reload) {
      await vscode.commands.executeCommand('workbench.action.reloadWindow');
    }
  });
}

/** Starts the launcher the person named and connects the editor's language client to it; reports what is wrong with the setting instead of starting something else. */
async function start(context: vscode.ExtensionContext): Promise<void> {
  const log = channel ?? (channel = vscode.window.createOutputChannel(NAME));
  const config = vscode.workspace.getConfiguration('jawataJava');
  const removal = rivalRemovalOf(vscode.extensions.all.map(installedOf), config.get<string[]>('rivalExtensions', ['redhat.java']));
  if (removal) { offerRemoval(removal, log); }
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
