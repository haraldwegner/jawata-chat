import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

/** What the run measures, written for the script that started the engine to read beside its own figures. */
interface Measured {
  /** From typing the faulty method, the first time in this window (the engine's warm-up included), to the error showing. */
  firstProblemsMs: number;
  /** From typing it again, with the engine warm, to the error showing. */
  secondProblemsMs: number;
  /** From typing the faulty method away to the error going. */
  clearedMs: number;
  problemRange: { startLine: number; startCharacter: number; endLine: number; endCharacter: number };
  problemMessage: string;
  otherJavaExtensionPresent: boolean;
}

const BAD = '"x"';

function errorsOf(uri: vscode.Uri): vscode.Diagnostic[] {
  return vscode.languages.getDiagnostics(uri).filter(d => d.severity === vscode.DiagnosticSeverity.Error);
}

/** Resolves with the milliseconds from `since` to the first change of the problems of `uri` for which `accept` holds; rejects after `limitMs`. */
function problemsWhere(uri: vscode.Uri, accept: () => boolean, since: number, limitMs: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { listener.dispose(); reject(new Error(`no matching problems for ${uri.fsPath} within ${limitMs} ms`)); }, limitMs);
    const listener = vscode.languages.onDidChangeDiagnostics(change => {
      if (change.uris.some(u => u.toString() === uri.toString()) && accept()) {
        clearTimeout(timer);
        listener.dispose();
        resolve(Date.now() - since);
      }
    });
    if (accept()) { clearTimeout(timer); listener.dispose(); resolve(Date.now() - since); }
  });
}

/**
 * The boundary clause of S16a in a real window: the file is opened, a faulty method is typed into it without saving, and the editor shows the
 * engine's error at the characters of the faulty expression. The window has no other Java extension; the script reads the process list.
 */
suite('Problems from unsaved text', () => {
  test('a faulty method typed and not saved shows as an error at its characters, and goes when it is typed away', async function () {
    const server = process.env.JAWATA_LIVE_SERVER;
    const workspace = process.env.JAWATA_LIVE_WORKSPACE;
    const file = process.env.JAWATA_LIVE_FILE;
    const out = process.env.JAWATA_LIVE_OUT;
    assert.ok(server && workspace && file && out, 'JAWATA_LIVE_SERVER, _WORKSPACE, _FILE and _OUT are set');
    await vscode.workspace.getConfiguration('jawataJava').update('server', JSON.parse(server), vscode.ConfigurationTarget.Global);

    const uri = vscode.Uri.file(path.join(workspace, file));
    const document = await vscode.workspace.openTextDocument(uri);
    const editor = await vscode.window.showTextDocument(document);
    const saved = document.getText();

    const measured: Measured = {
      firstProblemsMs: -1, secondProblemsMs: -1, clearedMs: -1, otherJavaExtensionPresent: vscode.extensions.getExtension('redhat.java') !== undefined,
      problemRange: { startLine: -1, startCharacter: -1, endLine: -1, endCharacter: -1 }, problemMessage: '',
    };
    assert.equal(measured.otherJavaExtensionPresent, false, 'the window has no Red Hat Java extension');

    // type the faulty method before the last closing brace, like a person: an edit in the editor, no save
    const lastBrace = saved.lastIndexOf('}');
    const at = document.positionAt(lastBrace);
    const typed = `    int bad() { return ${BAD}; }\n`;
    const typedAt = Date.now();
    await editor.edit(builder => builder.insert(at, typed));
    assert.ok(document.isDirty, 'the text is unsaved');
    measured.firstProblemsMs = await problemsWhere(uri, () => errorsOf(uri).length > 0, typedAt, 120000);

    const error = errorsOf(uri)[0];
    const expectedLine = at.line;
    const column = typed.indexOf(BAD);
    assert.strictEqual(error.range.start.line, expectedLine, `the error is on the typed line: ${JSON.stringify(error.range)}`);
    assert.strictEqual(error.range.start.character, column, 'and starts at the faulty expression');
    assert.strictEqual(error.range.end.character, column + BAD.length, 'and ends where it ends');
    measured.problemRange = { startLine: error.range.start.line, startCharacter: error.range.start.character, endLine: error.range.end.line, endCharacter: error.range.end.character };
    measured.problemMessage = error.message;
    assert.strictEqual(fs.readFileSync(uri.fsPath, 'utf8'), saved, 'the file on disk is as it was');

    // typing it away clears the problem, typing it again brings it back (the engine is warm now)
    const typedAway = (): Thenable<boolean> => editor.edit(builder => builder.delete(new vscode.Range(at, document.positionAt(document.offsetAt(at) + typed.length))));
    const awayAt = Date.now();
    await typedAway();
    measured.clearedMs = await problemsWhere(uri, () => errorsOf(uri).length === 0, awayAt, 60000);
    const againAt = Date.now();
    await editor.edit(builder => builder.insert(at, typed));
    measured.secondProblemsMs = await problemsWhere(uri, () => errorsOf(uri).length > 0, againAt, 60000);
    await typedAway();

    fs.writeFileSync(out, JSON.stringify(measured, null, 2));
    await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
  });
});
