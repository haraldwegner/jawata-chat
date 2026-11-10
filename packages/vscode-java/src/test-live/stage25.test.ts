import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

import type { ExtensionApi } from '../extension';

/** The place in the scratch tree a family of refactoring is asked at, and the text that shows it was applied. */
const POLL_MS = 300;

function lineIn(text: string, marker: string): number {
  const line = text.split('\n').findIndex(l => l.includes(marker));
  assert.ok(line >= 0, `a line holds ${marker}`);
  return line;
}

async function until<T>(what: string, limitMs: number, probe: () => Promise<T | undefined>): Promise<T> {
  const end = Date.now() + limitMs;
  while (Date.now() < end) {
    const found = await probe();
    if (found !== undefined) { return found; }
    await new Promise(resolve => setTimeout(resolve, POLL_MS));
  }
  throw new Error(`${what}: nothing within ${limitMs} ms`);
}

/** The code actions of one kind the editor's own provider offers at a name of the file, as the person's lightbulb would list them. */
async function offered(document: vscode.TextDocument, marker: string, name: string, kind: string): Promise<vscode.CodeAction[]> {
  const line = lineIn(document.getText(), marker);
  const at = new vscode.Position(line, document.lineAt(line).text.indexOf(name));
  const actions = await vscode.commands.executeCommand<(vscode.CodeAction | vscode.Command)[]>('vscode.executeCodeActionProvider', document.uri, new vscode.Range(at, at), kind);
  return (actions ?? []).filter((a): a is vscode.CodeAction => 'title' in a && 'edit' in a);
}

function titled(actions: vscode.CodeAction[], title: string): vscode.CodeAction {
  const found = actions.find(a => a.title === title);
  assert.ok(found, `'${title}' is offered; the offer was: ${actions.map(a => a.title).join(' | ')}`);
  return found;
}

async function textOf(file: string): Promise<string> {
  return (await vscode.workspace.openTextDocument(vscode.Uri.file(file))).getText();
}

/**
 * Sprint 28i, Stage 25, step A9: the person's Java work in a real window with the jawata Java extension and no other Java extension, against a
 * real engine. Four measures, each recorded: refactorings offered, applied by the editor and undone; the project's tests listed and one failing test
 * run with its message at its line; a program started from the editor stops at a breakpoint, shows its variables, evaluates and steps; the running
 * program profiled and its hot method named with its source. The Testing view and the profile page are the extension's own views over the
 * requests used here, and their mapping is measured in the extension's node tests, not here.
 */
suite('Stage 25', () => {
  test('refactorings, tests, debugger and profile in a window with no other Java extension', async function () {
    const workspace = process.env.JAWATA_LIVE_WORKSPACE;
    const out = process.env.JAWATA_LIVE_OUT;
    const server = process.env.JAWATA_LIVE_SERVER;
    const classes = process.env.JAWATA_LIVE_DEBUG_CLASSPATH;
    assert.ok(workspace && out && server && classes, 'JAWATA_LIVE_WORKSPACE, _OUT, _SERVER and _DEBUG_CLASSPATH are set');
    const measured: Record<string, unknown> = {};
    let step = 'start';
    try {
    const source = (...parts: string[]): string => path.join(workspace, 'src', 'main', 'java', 'com', 'example', ...parts);

    // the boundary: no other Java extension is in the window
    const rivals = vscode.extensions.all.map(e => e.id).filter(id => /redhat\.java|vscjava/i.test(id));
    assert.deepEqual(rivals, [], 'no Red Hat or other Java extension is installed');
    measured.otherJavaExtensions = rivals.length;

    await vscode.workspace.getConfiguration('jawataJava').update('server', JSON.parse(server), vscode.ConfigurationTarget.Global);
    const ext = vscode.extensions.getExtension<ExtensionApi>('jawata.jawata-java');
    assert.ok(ext, 'the jawata Java extension is installed');
    const api = await ext.activate();
    // the extension started with the window, before this setting was written, so its server is started again with the setting
    await vscode.commands.executeCommand('jawataJava.restartServer');
    const shared = await vscode.workspace.openTextDocument(vscode.Uri.file(source('sel', 'Shared.java')));
    await vscode.window.showTextDocument(shared);
    await until('the engine to answer', 120000, async () => {
      const outline = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>('vscode.executeDocumentSymbolProvider', shared.uri);
      return outline && outline.length > 0 ? true : undefined;
    });

    step = 'refactorings';
    // 1. refactorings: offered by the editor's provider, applied by the editor, read, and undone
    let began = Date.now();
    const sharedBefore = shared.getText();
    const userBefore = await textOf(source('sel', 'SharedUser.java'));
    const valueLine = lineIn(sharedBefore, 'public int value()');
    measured.inlineStaged = await api.request('workspace/executeCommand', { command: 'inline', arguments: [{ kind: 'method', filePath: shared.uri.fsPath, line: valueLine, column: shared.lineAt(valueLine).text.indexOf('value'), auto_apply: false, edits: true }] })
      .then(r => JSON.stringify(r).slice(0, 300), (e: unknown) => String(e).slice(0, 600));
    const inline = titled(await offered(shared, 'public int value()', 'value', 'refactor.inline'), 'Inline method');
    assert.ok(await vscode.workspace.applyEdit(inline.edit!), 'the editor applied the inline');
    const userAfter = await textOf(source('sel', 'SharedUser.java'));
    assert.ok(!userAfter.includes('value()'), `the caller holds the value, not the call:\n${userAfter}`);
    await vscode.commands.executeCommand('undo');
    assert.equal(await textOf(source('sel', 'SharedUser.java')), userBefore, 'undo gave the caller back');
    assert.equal(shared.getText(), sharedBefore, 'and the declaration');
    const final = titled(await offered(shared, 'public int add(', 'add', 'refactor.rewrite'), 'Make variables that are never reassigned final');
    assert.ok(await vscode.workspace.applyEdit(final.edit!), 'the editor applied the clean-up');
    assert.ok(shared.getText().includes('final int a'), `the parameters are final:\n${shared.getText()}`);
    await vscode.commands.executeCommand('undo');
    assert.equal(shared.getText(), sharedBefore, 'undo gave the file back');
    const child = await vscode.workspace.openTextDocument(vscode.Uri.file(source('sel', 'Child.java')));
    await vscode.window.showTextDocument(child);
    const pull = titled(await offered(child, 'public int doubled()', 'doubled', 'refactor.move'), 'Pull member up');
    assert.ok(await vscode.workspace.applyEdit(pull.edit!), 'the editor applied the pull up');
    assert.ok((await textOf(source('sel', 'Parent.java'))).includes('doubled()'), 'the superclass declares it');
    await vscode.commands.executeCommand('undo');
    measured.refactoringsMs = Date.now() - began;
    measured.refactoringFamilies = ['inline', 'clean-up', 'move'];

    step = 'tests';
    // 2. tests: the project's tests are listed and a failing one runs with its message at its line
    began = Date.now();
    const listed = await api.request('jawata/tests/list', {}) as { name: string; scope: unknown; tests: { name: string }[] }[];
    const fails = listed.find(c => c.name === 'FailsTest');
    assert.ok(fails, `the listing holds FailsTest; it holds ${listed.map(c => c.name).join(', ')}`);
    const run = await api.request('jawata/tests/run', { scope: fails.scope }) as { summary: { failed?: number }; failures: { testMethod: string; message: string; line?: number }[] };
    assert.equal(run.summary.failed, 1, JSON.stringify(run));
    const failure = run.failures[0];
    const testText = await textOf(path.join(workspace, 'src', 'test', 'java', 'com', 'example', 'sel', 'FailsTest.java'));
    assert.equal(failure.line, lineIn(testText, 'assertEquals(4, 5'), `the failure is at the assertion's line: ${JSON.stringify(failure)}`);
    assert.match(failure.message, /expected/i);
    measured.testsMs = Date.now() - began;
    measured.testsListed = listed.length;

    step = 'debugger';
    // 3. the debugger: a program started from the editor stops at a breakpoint
    const target = vscode.Uri.file(source('debug', 'DebugTarget.java'));
    const targetText = await textOf(target.fsPath);
    const seam = lineIn(targetText, 'int adjusted = doubled + offset();');
    let sessionId: string | undefined;
    const sessionEvent = vscode.debug.onDidReceiveDebugSessionCustomEvent(e => {
      if (e.event === 'jawata/session') { sessionId = String((e.body as { sessionId?: unknown }).sessionId); }
    });
    const breakpoint = new vscode.SourceBreakpoint(new vscode.Location(target, new vscode.Position(seam, 0)));
    vscode.debug.addBreakpoints([breakpoint]);
    began = Date.now();
    const folder = vscode.workspace.workspaceFolders?.[0];
    assert.ok(await vscode.debug.startDebugging(folder, { type: 'jawata', request: 'launch', name: 'live', mainClass: 'com.example.debug.DebugTarget', classpath: classes }), 'the editor started the program');
    const session = await until('a debug session', 30000, async () => vscode.debug.activeDebugSession);
    const stop = await until('the breakpoint to stop the program', 90000, async () => {
      try {
        const threads = (await session.customRequest('threads')).threads as { id: number }[];
        for (const t of threads) {
          const frames = (await session.customRequest('stackTrace', { threadId: t.id, levels: 5 })).stackFrames as { id: number; name: string; line: number }[];
          if (frames.length > 0) { return { threadId: t.id, frames }; }
        }
      } catch { /* a thread that is running has no stack to read yet */ }
      return undefined;
    });
    measured.breakpointStopMs = Date.now() - began;
    assert.equal(stop.frames[0].name, 'com.example.debug.DebugTarget.computeSignal');
    assert.equal(stop.frames[0].line, seam + 1, 'it stopped on the breakpoint line');
    const scopes = (await session.customRequest('scopes', { frameId: stop.frames[0].id })).scopes as { name: string; variablesReference: number }[];
    const variables: Record<string, string> = {};
    for (const scope of scopes) {
      for (const v of ((await session.customRequest('variables', { variablesReference: scope.variablesReference })).variables as { name: string; value: string }[])) { variables[v.name] = v.value; }
    }
    assert.equal(variables.iteration, '0', `the argument shows: ${JSON.stringify(variables)}`);
    assert.equal(variables.doubled, '0', 'and the local');
    const evaluated = (await session.customRequest('evaluate', { expression: 'iteration + 5', frameId: stop.frames[0].id, context: 'repl' })).result;
    assert.equal(evaluated, '5');
    await session.customRequest('next', { threadId: stop.threadId });
    const stepped = await until('the step to stop', 30000, async () => {
      const frames = (await session.customRequest('stackTrace', { threadId: stop.threadId, levels: 1 }).then(r => r, () => undefined))?.stackFrames as { line: number }[] | undefined;
      return frames && frames[0] && frames[0].line === seam + 2 ? frames[0].line : undefined;
    });
    assert.equal(stepped, seam + 2, 'a step over moved to the next line');
    measured.debuggerVariables = variables;

    step = 'profile';
    // 4. the profile: a program that burns processor time is run from the editor, recorded, and its hot method named with its source. The first
    // program sleeps between short bursts, which a processor sample may catch nothing of, so a program built to be hot is profiled
    vscode.debug.removeBreakpoints([breakpoint]);
    await vscode.debug.stopDebugging(session);
    sessionId = undefined;
    const hotFile = source('debug', 'HotLoopTarget.java');
    const hotText = await textOf(hotFile);
    assert.ok(await vscode.debug.startDebugging(folder, { type: 'jawata', request: 'launch', name: 'live-hot', mainClass: 'com.example.debug.HotLoopTarget', classpath: classes }), 'the editor started the hot program');
    await until('the hot program\'s debug session', 30000, async () => (vscode.debug.activeDebugSession?.name === 'live-hot' ? true : undefined));
    const hotSession = await until('the engine session of the hot program', 30000, async () => sessionId);
    sessionEvent.dispose();
    began = Date.now();
    type Ranked = { rows: { symbol: string; location?: { uri: string; range: { start: { line: number } } } }[] };
    const profile = await api.request('jawata/profile', { sessionId: hotSession, seconds: 3, dimension: 'cpu' }) as Ranked;
    measured.profileAnswer = JSON.stringify(profile).slice(0, 700);
    const hot = profile.rows[0];
    assert.ok(hot, 'the recording ranked at least one method');
    assert.equal(hot.symbol, 'com.example.debug.HotLoopTarget#burnCpu', `the hot method is named first; the rows are ${profile.rows.map(r => r.symbol).join(', ')}`);
    assert.ok(hot.location?.uri.endsWith('/com/example/debug/HotLoopTarget.java'), `with its source: ${JSON.stringify(hot)}`);
    assert.equal(hot.location?.range.start.line, lineIn(hotText, 'static long burnCpu('), 'the source place is the declaration');
    measured.profileHotMethod = hot.symbol;
    measured.profileMs = Date.now() - began;
    await vscode.commands.executeCommand('jawataJava.profile'); // the page opens
    if (vscode.debug.activeDebugSession) { await vscode.debug.stopDebugging(vscode.debug.activeDebugSession); }

    step = 'done';
    } catch (e) {
      measured.failedAtStep = step;
      measured.failure = String(e);
      throw new Error(`at step '${step}': ${String(e)}`);
    } finally {
      fs.writeFileSync(out, JSON.stringify(measured, null, 2));
    }
  });
});
