import * as vscode from 'vscode';
import type { LanguageClient } from 'vscode-languageclient/node';

import { debugLaunchOf, type ServerSetting } from './launch';
import { stagingOf, type Asking } from './refactorPrompt';
import type { EngineAnswer } from './studio';
import { outcomeOf, treeOf, type ListedClass, type RunResult, type TestNode } from './testing';

/** The debug type the extension contributes; the editor's launch configurations name it. */
const DEBUG_TYPE = 'jawata';

/** The engine session of the person's run, as the debug adapter told the editor in its `jawata/session` event; the profile page asks about it. */
let personsSession: string | undefined;

export function currentSession(): string | undefined {
  return personsSession;
}

/**
 * The person's debugger: the editor's debug adapter is the launcher with `--dap`, the engine's own face, so a breakpoint stops a program the
 * engine started and no second Java debugger is involved. A launch configuration without a main class or a classpath is refused in words, not
 * started blind.
 */
export function debuggerOf(server: () => ServerSetting | undefined, engine: () => EngineAnswer | undefined): vscode.Disposable {
  const factory: vscode.DebugAdapterDescriptorFactory = {
    createDebugAdapterDescriptor(): vscode.DebugAdapterDescriptor {
      const launch = debugLaunchOf(server(), engine());
      if (!launch.ok) { throw new Error(launch.why); }
      return new vscode.DebugAdapterExecutable(launch.command, [...launch.args], { env: { ...process.env, ...launch.env } as Record<string, string> });
    },
  };
  const configurations: vscode.DebugConfigurationProvider = {
    resolveDebugConfiguration(_folder, config): vscode.DebugConfiguration | undefined {
      const resolved: vscode.DebugConfiguration = { ...config, type: DEBUG_TYPE, request: 'launch', name: config.name || 'jawata Java' };
      for (const required of ['mainClass', 'classpath']) {
        if (typeof resolved[required] !== 'string' || resolved[required].trim() === '') {
          void vscode.window.showErrorMessage(`jawata Java: the launch configuration needs "${required}" (the program's main class and the classpath it runs with).`);
          return undefined;
        }
      }
      return resolved;
    },
  };
  return vscode.Disposable.from(
    vscode.debug.registerDebugAdapterDescriptorFactory(DEBUG_TYPE, factory),
    vscode.debug.registerDebugConfigurationProvider(DEBUG_TYPE, configurations),
    vscode.debug.onDidReceiveDebugSessionCustomEvent(event => {
      if (event.session.type === DEBUG_TYPE && event.event === 'jawata/session') {
        personsSession = String((event.body as { sessionId?: unknown } | undefined)?.sessionId ?? '') || undefined;
      }
    }),
    vscode.debug.onDidTerminateDebugSession(session => { if (session.type === DEBUG_TYPE) { personsSession = undefined; } }),
  );
}

/**
 * The Testing view: what the engine lists is the tree, a run is the engine's own test run (the engine watches it and pushes its progress, so
 * nothing here polls), and a failure shows its message at the line the engine found. Cancelling in the view cancels the request, which cancels
 * the run in the engine.
 */
export function testingOf(clientOf: () => LanguageClient | undefined): vscode.Disposable {
  const controller = vscode.tests.createTestController('jawataJava', 'jawata Java');
  const nodes = new Map<string, TestNode>();
  const items = new Map<string, vscode.TestItem>();
  let tokens = 0;
  const watching = new Map<string, (finished: number, planned: number) => void>();

  const add = (node: TestNode): vscode.TestItem => {
    const item = controller.createTestItem(node.id, node.label, node.uri ? vscode.Uri.parse(node.uri) : undefined);
    if (node.line !== undefined) { item.range = new vscode.Range(node.line, 0, node.line, 0); }
    nodes.set(node.id, node);
    items.set(node.id, item);
    node.children.forEach(child => item.children.add(add(child)));
    return item;
  };

  const refresh = async (): Promise<void> => {
    const client = clientOf();
    if (!client) { return; }
    const listed = await client.sendRequest<ListedClass[]>('jawata/tests/list', {});
    nodes.clear();
    items.clear();
    controller.items.replace(treeOf(listed).map(add));
  };
  const run = async (request: vscode.TestRunRequest, cancel: vscode.CancellationToken): Promise<void> => {
    const client = clientOf();
    const testRun = controller.createTestRun(request);
    const asked = request.include ?? [...items.values()].filter(item => item.parent === undefined);
    try {
      for (const item of asked) {
        const node = nodes.get(item.id);
        if (!client || !node || cancel.isCancellationRequested) { continue; }
        testRun.started(item);
        const token = `run-${++tokens}`;
        watching.set(token, (finished, planned) => testRun.appendOutput(`${finished} of ${planned} finished\r\n`));
        try {
          const result = await client.sendRequest<RunResult>('jawata/tests/run', { scope: node.scope, token }, cancel);
          report(testRun, node, result);
        } catch (e) {
          testRun.errored(item, new vscode.TestMessage(String(e)));
        } finally {
          watching.delete(token);
        }
      }
    } finally {
      testRun.end();
    }
  };

  const report = (testRun: vscode.TestRun, started: TestNode, result: RunResult): void => {
    const outcome = outcomeOf([started], result);
    const leaves = outcome.ranIds.filter(id => (nodes.get(id)?.children.length ?? 0) === 0);
    for (const id of new Set([...leaves, ...outcome.failed.keys()])) {
      const item = items.get(id);
      if (!item) { continue; }
      const failure = outcome.failed.get(id);
      if (failure) {
        const message = new vscode.TestMessage(failure.message);
        if (item.uri && failure.line !== undefined) { message.location = new vscode.Location(item.uri, new vscode.Position(failure.line, 0)); }
        testRun.failed(item, message);
      } else if (outcome.cancelled) {
        testRun.skipped(item);
      } else {
        testRun.passed(item);
      }
    }
  };

  controller.createRunProfile('Run', vscode.TestRunProfileKind.Run, run, true);
  const progress = (): vscode.Disposable | undefined => clientOf()?.onNotification('jawata/tests/progress', (p: { token?: string; progress?: { testsFinished?: number; plannedTests?: number } }) => {
    watching.get(p.token ?? '')?.(p.progress?.testsFinished ?? 0, p.progress?.plannedTests ?? 0);
  });
  // the language client is created after the extension activates, so the progress listener is attached when the first refresh finds it
  let listening: vscode.Disposable | undefined;
  const refreshAndListen = async (): Promise<void> => {
    await refresh();
    listening ??= progress();
  };
  controller.resolveHandler = refreshAndListen;
  controller.refreshHandler = refreshAndListen;
  return vscode.Disposable.from(controller, new vscode.Disposable(() => { listening?.dispose(); }));
}

/**
 * The one command behind every refactoring that needs the person's answers: the engine's code action says what to ask, this asks it and sends
 * the answers back to be staged, and the staged change is applied as one edit the editor can undo. Nothing here names a refactoring.
 */
export function refactoringOf(clientOf: () => LanguageClient | undefined): vscode.Disposable {
  return vscode.commands.registerCommand('jawata.refactor', async (asking: Asking) => {
    const client = clientOf();
    if (!client) { return; }
    const staged = await stagingOf(asking, {
      pick: (prompt, choices) => Promise.resolve(vscode.window.showQuickPick([...choices], { placeHolder: prompt })),
      type: prompt => Promise.resolve(vscode.window.showInputBox({ prompt })),
    });
    if (!staged) { return; }
    try {
      const edit = await client.sendRequest<unknown>('jawata/refactor/stage', staged);
      const change = await client.protocol2CodeConverter.asWorkspaceEdit(edit as never);
      if (change === undefined || !(await vscode.workspace.applyEdit(change))) {
        void vscode.window.showWarningMessage('jawata Java: the editor did not apply the change.');
      }
    } catch (e) {
      void vscode.window.showErrorMessage(`jawata Java: ${String(e)}`);
    }
  });
}
