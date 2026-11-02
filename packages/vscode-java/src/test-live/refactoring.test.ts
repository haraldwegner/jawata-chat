import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

/** What one tree of the live run asks for: the method renamed in the opened file, and what the renamed declaration reads. */
interface Tree {
  rename: { line: string; token: string; newName: string; declaration: string };
}

const TREES: Record<string, Tree> = {
  maven: { rename: { line: 'public int add(', token: 'add', newName: 'sum', declaration: 'public int sum(' } },
  plugins: { rename: { line: 'public String hello', token: 'hello', newName: 'greetBy', declaration: 'public String greetBy(' } },
};

function lineIn(text: string, marker: string): number {
  const line = text.split('\n').findIndex(l => l.includes(marker));
  assert.ok(line >= 0, `a line holds ${marker}`);
  return line;
}

function errorsOf(uri: vscode.Uri): vscode.Diagnostic[] {
  return vscode.languages.getDiagnostics(uri).filter(d => d.severity === vscode.DiagnosticSeverity.Error);
}

/** Resolves when the editor shows an error for `uri`, which is how the test knows the engine holds the file. */
function errorShown(uri: vscode.Uri, limitMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { listener.dispose(); reject(new Error(`no problems for ${uri.fsPath} within ${limitMs} ms`)); }, limitMs);
    const listener = vscode.languages.onDidChangeDiagnostics(change => {
      if (change.uris.some(u => u.toString() === uri.toString()) && errorsOf(uri).length > 0) { clearTimeout(timer); listener.dispose(); resolve(); }
    });
    if (errorsOf(uri).length > 0) { clearTimeout(timer); listener.dispose(); resolve(); }
  });
}

/** Waits until the engine answers an outline for the file, so the first request of the test is not lost to the editor's connection. */
async function engineAnswers(uri: vscode.Uri, limitMs: number): Promise<void> {
  const until = Date.now() + limitMs;
  while (Date.now() < until) {
    const outline = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>('vscode.executeDocumentSymbolProvider', uri);
    if (outline && outline.length > 0) { return; }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  assert.fail(`the engine did not answer for ${uri.fsPath} within ${limitMs} ms`);
}

/** Puts the document as the disk has it again, without saving. */
async function revert(document: vscode.TextDocument): Promise<void> {
  await vscode.window.showTextDocument(document);
  await vscode.commands.executeCommand('workbench.action.files.revert');
}

/**
 * The boundary clause of S16c in a real window: rename, formatting, code actions and file operations are asked of the editor's own
 * providers and applied by the editor, over the text it holds. The milliseconds each feature took are written beside the other runs'.
 */
suite('Refactoring and formatting', () => {
  test('rename, formatting, code actions and file operations are applied by the editor', async function () {
    const workspace = process.env.JAWATA_LIVE_WORKSPACE;
    const file = process.env.JAWATA_LIVE_FILE;
    const out = process.env.JAWATA_LIVE_OUT;
    const server = process.env.JAWATA_LIVE_SERVER;
    const treeName = process.env.JAWATA_LIVE_TREE ?? 'maven';
    const scratchDir = process.env.JAWATA_LIVE_SCRATCH_DIR;
    const scratchPackage = process.env.JAWATA_LIVE_SCRATCH_PACKAGE;
    const tree = TREES[treeName];
    assert.ok(workspace && file && out && server && scratchDir && scratchPackage && tree,
      'JAWATA_LIVE_WORKSPACE, _FILE, _OUT, _SERVER, _SCRATCH_DIR, _SCRATCH_PACKAGE and a known _TREE are set');
    await vscode.workspace.getConfiguration('jawataJava').update('server', JSON.parse(server), vscode.ConfigurationTarget.Global);

    const uri = vscode.Uri.file(path.join(workspace, file));
    const document = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(document);
    const saved = document.getText();
    await engineAnswers(uri, 180000);

    const ms: Record<string, number> = {};
    const ask = async <T>(feature: string, command: string, ...args: unknown[]): Promise<T> => {
      const began = Date.now();
      const answer = await vscode.commands.executeCommand<T>(command, ...args);
      ms[feature] = Date.now() - began;
      return answer;
    };

    // rename: the editor's own rename provider, applied by the editor; every place its reference search names is edited
    const renameAt = new vscode.Position(lineIn(saved, tree.rename.line), document.lineAt(lineIn(saved, tree.rename.line)).text.indexOf(tree.rename.token) + 1);
    const references = await ask<vscode.Location[]>('references', 'vscode.executeReferenceProvider', uri, renameAt);
    const renameEdit = await ask<vscode.WorkspaceEdit>('rename', 'vscode.executeDocumentRenameProvider', uri, renameAt, tree.rename.newName);
    assert.ok(renameEdit && renameEdit.size > 0, 'the rename answers an edit');
    for (const reference of references) {
      const edits = renameEdit.get(reference.uri);
      assert.ok(edits.some(e => e.range.start.isEqual(reference.range.start)), `the rename edits the reference at ${reference.uri.fsPath}:${reference.range.start.line}`);
    }
    assert.ok(await vscode.workspace.applyEdit(renameEdit), 'the editor applied the rename');
    assert.ok(document.getText().includes(tree.rename.declaration), `the declaration reads ${tree.rename.declaration}`);
    for (const [changed] of renameEdit.entries()) {
      await revert(await vscode.workspace.openTextDocument(changed));
    }
    assert.strictEqual(document.getText(), saved, 'the file is as it was after the revert');
    assert.strictEqual(fs.readFileSync(uri.fsPath, 'utf8'), saved, 'the file on disk is as it was');

    // formatting: over text typed and not saved, as a range and as the whole document
    const editor = await vscode.window.showTextDocument(document);
    await editor.edit(builder => builder.insert(document.positionAt(saved.lastIndexOf('}')),
      '    void typedA() {int  a=1 ;}\n    void typedB() {int  b=2 ;}\n    void typedC() {int  c=3 ;}\n'));
    assert.ok(document.isDirty, 'the text is unsaved');
    const options = { tabSize: 4, insertSpaces: true };
    const lineA = lineIn(document.getText(), 'void typedA');
    const rangeEdits = await ask<vscode.TextEdit[]>('rangeFormatting', 'vscode.executeFormatRangeProvider', uri,
      new vscode.Range(lineA, 0, lineA + 1, 0), options);
    const rangeApply = new vscode.WorkspaceEdit();
    rangeApply.set(uri, rangeEdits);
    assert.ok(rangeEdits.length > 0 && await vscode.workspace.applyEdit(rangeApply), 'the range is laid out');
    assert.ok(document.getText().includes('int a = 1;'), 'the line in the range is laid out');
    assert.ok(document.getText().includes('int  b=2 ;'), 'the line outside the range is as typed');
    const lineC = lineIn(document.getText(), 'void typedC');
    const typedAt = new vscode.Position(lineC, document.lineAt(lineC).text.length);
    const typeEdits = await ask<vscode.TextEdit[]>('onTypeFormatting', 'vscode.executeFormatOnTypeProvider', uri, typedAt, ';', options);
    const typeApply = new vscode.WorkspaceEdit();
    typeApply.set(uri, typeEdits);
    assert.ok(typeEdits.length > 0 && await vscode.workspace.applyEdit(typeApply), 'the line just typed is laid out');
    assert.ok(document.getText().includes('int c = 3;'), 'the line just typed is laid out');
    assert.ok(document.getText().includes('int  b=2 ;'), 'the other line is still as typed');
    const allEdits = await ask<vscode.TextEdit[]>('formatting', 'vscode.executeFormatDocumentProvider', uri, options);
    const allApply = new vscode.WorkspaceEdit();
    allApply.set(uri, allEdits);
    assert.ok(allEdits.length > 0 && await vscode.workspace.applyEdit(allApply), 'the document is laid out');
    assert.ok(document.getText().includes('int b = 2;'), 'and the line that was left as typed too');
    assert.strictEqual(fs.readFileSync(uri.fsPath, 'utf8'), saved, 'the file on disk is as it was');
    await revert(document);
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');

    // code actions: on a saved file with an unresolved name and an import nothing uses
    const problemUri = vscode.Uri.file(path.join(workspace, scratchDir, 'HasAProblem.java'));
    const problem = await vscode.workspace.openTextDocument(problemUri);
    await vscode.window.showTextDocument(problem);
    await errorShown(problemUri, 180000);
    const problemLine = lineIn(problem.getText(), 'new ArrayList');
    const importFixes = await ask<vscode.CodeAction[]>('codeAction', 'vscode.executeCodeActionProvider', problemUri,
      new vscode.Range(problemLine, 0, problemLine, 0), 'quickfix');
    const fix = importFixes.find(a => a.title.includes('java.util'));
    assert.ok(fix && fix.edit, `the unresolved name has an import fix: ${JSON.stringify(importFixes.map(a => a.title))}`);
    assert.ok(await vscode.workspace.applyEdit(fix.edit), 'the editor applied the import');
    assert.ok(problem.getText().includes('import java.util.ArrayList;'), 'the import is in the file');
    await revert(problem);
    const organizers = await ask<vscode.CodeAction[]>('organizeImports', 'vscode.executeCodeActionProvider', problemUri,
      new vscode.Range(problemLine, 0, problemLine, 0), 'source.organizeImports');
    const organize = organizers.find(a => a.kind?.value === 'source.organizeImports');
    assert.ok(organize && organize.edit, `organize imports is offered: ${JSON.stringify(organizers.map(a => a.title))}`);
    assert.ok(await vscode.workspace.applyEdit(organize.edit), 'the editor applied the organized imports');
    assert.ok(!problem.getText().includes('import java.util.List;'), 'the import nothing uses is gone');
    await revert(problem);
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');

    // file operations: the editor renames and moves files, and the code follows
    const dir = path.join(workspace, scratchDir);
    const renamedTo = vscode.Uri.file(path.join(dir, 'Renamed.java'));
    const fileRename = new vscode.WorkspaceEdit();
    fileRename.renameFile(vscode.Uri.file(path.join(dir, 'Scratch.java')), renamedTo);
    const renameBegan = Date.now();
    assert.ok(await vscode.workspace.applyEdit(fileRename), 'the editor renamed the file');
    ms.willRenameFile = Date.now() - renameBegan;
    const renamedText = (await vscode.workspace.openTextDocument(renamedTo)).getText();
    assert.ok(renamedText.includes('class Renamed') && renamedText.includes('public Renamed()'), `the type and its constructor follow the file: ${renamedText}`);

    fs.mkdirSync(path.join(dir, 'moved'), { recursive: true });
    const movedTo = vscode.Uri.file(path.join(dir, 'moved', 'Mover.java'));
    const fileMove = new vscode.WorkspaceEdit();
    fileMove.renameFile(vscode.Uri.file(path.join(dir, 'Mover.java')), movedTo);
    const moveBegan = Date.now();
    assert.ok(await vscode.workspace.applyEdit(fileMove), 'the editor moved the file');
    ms.willMoveFile = Date.now() - moveBegan;
    const movedText = (await vscode.workspace.openTextDocument(movedTo)).getText();
    assert.ok(movedText.includes(`package ${scratchPackage}.moved;`), `the package follows the folder: ${movedText}`);

    fs.writeFileSync(`${out}.refactoring.${treeName}.json`, JSON.stringify(ms, null, 2));
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  });
});
