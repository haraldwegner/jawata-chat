import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

/** Where a name of the open file is: the first line holding `lineMarker`, the first `token` on it, and `inside` characters into the token. */
type At = readonly [lineMarker: string, token: string];

/** What one tree of the live run asks for and the answer that is right; the typed lines are unsaved text the saved file does not have. */
interface Tree {
  typed: readonly string[];
  hover: At;
  definition: { at: At; file: string; fileText: string; marker: string; name: string };
  typeDefinition: { at: At; file: string; fileText: string; marker: string };
  implementation: { at: At; expectMarker: string };
  references: { at: At; expectMarker: string };
  symbols: { query: string; name: string; child: string };
  signature: { line: string; token: string; activeParameter: number };
  completion: { line: string; token: string; label: string };
  calls: { declAt: At; callers: string; callerAt: At; callees: string };
  types: { subAt: At; supertype: string; superAt: At; subtype: string };
  command: { query: string; name: string };
  library: At;
}

const TREES: Record<string, Tree> = {
  maven: {
    typed: [
      '    int typedSum() { int s = add(1, 2); return s + lastResult; }',
      '    interface Shape { }',
      '    static class Square implements Shape { }',
      '    Shape typedShape;',
      '    String typedName;',
      '    void typedHalf() { String s = "x"; s.len }',
    ],
    hover: ['typedSum', 'add'],
    definition: { at: ['typedSum', 'add'], file: 'Calculator.java', fileText: '', marker: 'public int add(', name: 'add' },
    typeDefinition: { at: ['Shape typedShape', 'typedShape'], file: 'Calculator.java', fileText: '', marker: 'interface Shape' },
    implementation: { at: ['interface Shape', 'Shape'], expectMarker: 'class Square' },
    references: { at: ['typedSum', 'lastResult'], expectMarker: 'typedSum' },
    symbols: { query: 'Calculator', name: 'Calculator', child: 'typedSum' },
    signature: { line: 'typedSum', token: 'add(1, ', activeParameter: 1 },
    completion: { line: 'typedHalf', token: 's.len', label: 'length' },
    calls: { declAt: ['public int add(', 'add'], callers: 'typedSum', callerAt: ['int typedSum', 'typedSum'], callees: 'add' },
    types: { subAt: ['static class Square', 'Square'], supertype: 'Shape', superAt: ['interface Shape', 'Shape'], subtype: 'Square' },
    command: { query: 'Calculator', name: 'Calculator' },
    library: ['String typedName', 'String'],
  },
  plugins: {
    typed: [
      '    public String typedHello() { return greeter.greet("x"); }',
      '    void typedHalf() { greeter.gre }',
      '    static class Friendly extends Greeter { }',
    ],
    hover: ['typedHello', '.greet'],
    definition: { at: ['typedHello', '.greet'], file: 'Greeter.java', fileText: 'pde-bundle-b/src/com/example/b/Greeter.java', marker: 'public String greet(', name: 'greet' },
    typeDefinition: { at: ['typedHello', 'greeter'], file: 'Greeter.java', fileText: 'pde-bundle-b/src/com/example/b/Greeter.java', marker: 'public class Greeter' },
    implementation: { at: ['class Friendly', 'Greeter'], expectMarker: 'class Friendly' },
    references: { at: ['typedHello', 'greeter'], expectMarker: 'typedHello' },
    symbols: { query: 'Greeter', name: 'Greeter', child: 'typedHello' },
    signature: { line: 'typedHello', token: 'greet(', activeParameter: 0 },
    completion: { line: 'typedHalf', token: 'greeter.gre', label: 'greet' },
    calls: { declAt: ['typedHello', '.greet'], callers: 'typedHello', callerAt: ['typedHello', 'typedHello'], callees: 'greet' },
    types: { subAt: ['class Friendly', 'Friendly'], supertype: 'Greeter', superAt: ['class Friendly', 'Greeter'], subtype: 'Friendly' },
    command: { query: 'Greeter', name: 'Greeter' },
    library: ['public String hello', 'String'],
  },
};

function errorsOf(uri: vscode.Uri): vscode.Diagnostic[] {
  return vscode.languages.getDiagnostics(uri).filter(d => d.severity === vscode.DiagnosticSeverity.Error);
}

/** Resolves when the editor shows an error for `uri`, which is how the test knows the engine has received the typed text. */
function errorShown(uri: vscode.Uri, limitMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { listener.dispose(); reject(new Error(`no problems for ${uri.fsPath} within ${limitMs} ms`)); }, limitMs);
    const listener = vscode.languages.onDidChangeDiagnostics(change => {
      if (change.uris.some(u => u.toString() === uri.toString()) && errorsOf(uri).length > 0) { clearTimeout(timer); listener.dispose(); resolve(); }
    });
    if (errorsOf(uri).length > 0) { clearTimeout(timer); listener.dispose(); resolve(); }
  });
}

function lineIn(text: string, marker: string): number {
  const line = text.split('\n').findIndex(l => l.includes(marker));
  assert.ok(line >= 0, `a line holds ${marker}`);
  return line;
}

function at(document: vscode.TextDocument, where: At, inside = 1): vscode.Position {
  const line = lineIn(document.getText(), where[0]);
  return new vscode.Position(line, document.lineAt(line).text.indexOf(where[1]) + inside);
}

function atEnd(document: vscode.TextDocument, line: string, token: string): vscode.Position {
  return at(document, [line, token], token.length);
}

/** The place a definition-like answer names, whether the editor gave a location or a link. */
function placeOf(answer: vscode.Location | vscode.LocationLink): { uri: vscode.Uri; range: vscode.Range } {
  return 'targetUri' in answer
    ? { uri: answer.targetUri, range: answer.targetSelectionRange ?? answer.targetRange }
    : { uri: answer.uri, range: answer.range };
}

function textOf(hover: vscode.Hover): string {
  return hover.contents.map(c => (typeof c === 'string' ? c : 'value' in c ? c.value : '')).join('\n');
}

/**
 * The boundary clause of S16b in a real window: each navigation feature is asked of the editor's own providers while the file holds typed,
 * unsaved text, and the answer is about that text. The milliseconds each feature took are written beside the figures of the S16a run.
 */
suite('Navigation over unsaved text', () => {
  test('every navigation feature answers about the text typed and not saved', async function () {
    const workspace = process.env.JAWATA_LIVE_WORKSPACE;
    const file = process.env.JAWATA_LIVE_FILE;
    const out = process.env.JAWATA_LIVE_OUT;
    const server = process.env.JAWATA_LIVE_SERVER;
    const treeName = process.env.JAWATA_LIVE_TREE ?? 'maven';
    const tree = TREES[treeName];
    assert.ok(workspace && file && out && server && tree, 'JAWATA_LIVE_WORKSPACE, _FILE, _OUT, _SERVER and a known _TREE are set');
    await vscode.workspace.getConfiguration('jawataJava').update('server', JSON.parse(server), vscode.ConfigurationTarget.Global);

    const uri = vscode.Uri.file(path.join(workspace, file));
    const document = await vscode.workspace.openTextDocument(uri);
    const editor = await vscode.window.showTextDocument(document);
    const saved = document.getText();
    await editor.edit(builder => builder.insert(document.positionAt(saved.lastIndexOf('}')), `${tree.typed.join('\n')}\n`));
    assert.ok(document.isDirty, 'the text is unsaved');
    await errorShown(uri, 180000); // the engine has the typed text once it shows the error of the unfinished call
    const text = document.getText();

    const ms: Record<string, number> = {};
    const ask = async <T>(feature: string, command: string, ...args: unknown[]): Promise<T> => {
      const began = Date.now();
      const answer = await vscode.commands.executeCommand<T>(command, ...args);
      ms[feature] = Date.now() - began;
      return answer;
    };

    const hovers = await ask<vscode.Hover[]>('hover', 'vscode.executeHoverProvider', uri, at(document, tree.hover));
    assert.ok(hovers.map(textOf).join('\n').includes(tree.hover[1].replace('.', '')), `hover shows the called method: ${JSON.stringify(hovers.map(textOf))}`);

    const def = tree.definition;
    const defs = await ask<(vscode.Location | vscode.LocationLink)[]>('definition', 'vscode.executeDefinitionProvider', uri, at(document, def.at));
    const defPlace = placeOf(defs[0]);
    const defText = def.fileText === '' ? text : fs.readFileSync(path.join(workspace, def.fileText), 'utf8');
    assert.ok(defPlace.uri.fsPath.endsWith(def.file), `definition is in ${def.file}: ${defPlace.uri.fsPath}`);
    assert.strictEqual(defPlace.range.start.line, lineIn(defText, def.marker), 'on the declaration line');
    assert.strictEqual(defPlace.range.end.character - defPlace.range.start.character, def.name.length, 'covering the name');

    const typeDef = tree.typeDefinition;
    const typeText = typeDef.fileText === '' ? text : fs.readFileSync(path.join(workspace, typeDef.fileText), 'utf8');
    const typePlace = placeOf((await ask<(vscode.Location | vscode.LocationLink)[]>('typeDefinition', 'vscode.executeTypeDefinitionProvider', uri, at(document, typeDef.at)))[0]);
    assert.ok(typePlace.uri.fsPath.endsWith(typeDef.file), `type definition is in ${typeDef.file}`);
    assert.strictEqual(typePlace.range.start.line, lineIn(typeText, typeDef.marker));

    const impls = await ask<(vscode.Location | vscode.LocationLink)[]>('implementation', 'vscode.executeImplementationProvider', uri, at(document, tree.implementation.at));
    assert.ok(impls.map(i => placeOf(i).range.start.line).includes(lineIn(text, tree.implementation.expectMarker)), 'the typed class implements it');

    const refs = await ask<vscode.Location[]>('references', 'vscode.executeReferenceProvider', uri, at(document, tree.references.at));
    assert.ok(refs.map(r => r.range.start.line).includes(lineIn(text, tree.references.expectMarker)), 'a reference is in the typed line');

    const highlights = await ask<vscode.DocumentHighlight[]>('highlights', 'vscode.executeDocumentHighlights', uri, at(document, tree.references.at));
    assert.ok(highlights.map(h => h.range.start.line).includes(lineIn(text, tree.references.expectMarker)), 'a highlight is in the typed line');

    const outline = await ask<vscode.DocumentSymbol[]>('documentSymbols', 'vscode.executeDocumentSymbolProvider', uri);
    assert.ok(outline[0].children.map(c => c.name).includes(tree.symbols.child), `the outline lists ${tree.symbols.child}`);

    const found = await ask<vscode.SymbolInformation[]>('workspaceSymbols', 'vscode.executeWorkspaceSymbolProvider', tree.symbols.query);
    assert.ok(found.map(s => s.name).includes(tree.symbols.name), `workspace symbols find ${tree.symbols.name}`);

    const help = await ask<vscode.SignatureHelp>('signatureHelp', 'vscode.executeSignatureHelpProvider', uri, atEnd(document, tree.signature.line, tree.signature.token), '(');
    assert.ok(help.signatures.length > 0, 'signature help shows the method');
    assert.strictEqual(help.activeParameter, tree.signature.activeParameter, 'and the argument being typed');

    const proposals = await ask<vscode.CompletionList>('completion', 'vscode.executeCompletionItemProvider', uri, atEnd(document, tree.completion.line, tree.completion.token));
    assert.ok(proposals.items.map(i => (typeof i.label === 'string' ? i.label : i.label.label)).includes(tree.completion.label), `completion proposes ${tree.completion.label}`);

    const methods = await ask<vscode.CallHierarchyItem[]>('prepareCallHierarchy', 'vscode.prepareCallHierarchy', uri, at(document, tree.calls.declAt));
    const callers = await ask<vscode.CallHierarchyIncomingCall[]>('incomingCalls', 'vscode.provideIncomingCalls', methods[0]);
    assert.ok(callers.map(c => c.from.name).includes(tree.calls.callers), `the callers include ${tree.calls.callers}`);
    const caller = await vscode.commands.executeCommand<vscode.CallHierarchyItem[]>('vscode.prepareCallHierarchy', uri, at(document, tree.calls.callerAt));
    const callees = await ask<vscode.CallHierarchyOutgoingCall[]>('outgoingCalls', 'vscode.provideOutgoingCalls', caller[0]);
    assert.ok(callees.map(c => c.to.name).includes(tree.calls.callees), `the callees include ${tree.calls.callees}`);

    const sub = await ask<vscode.TypeHierarchyItem[]>('prepareTypeHierarchy', 'vscode.prepareTypeHierarchy', uri, at(document, tree.types.subAt));
    const supers = await ask<vscode.TypeHierarchyItem[]>('supertypes', 'vscode.provideSupertypes', sub[0]);
    assert.ok(supers.map(t => t.name).includes(tree.types.supertype), `the supertypes include ${tree.types.supertype}`);
    const top = await vscode.commands.executeCommand<vscode.TypeHierarchyItem[]>('vscode.prepareTypeHierarchy', uri, at(document, tree.types.superAt));
    const subs = await ask<vscode.TypeHierarchyItem[]>('subtypes', 'vscode.provideSubtypes', top[0]);
    assert.ok(subs.map(t => t.name).includes(tree.types.subtype), `the subtypes include ${tree.types.subtype}`);

    const run = await ask<{ results?: { name: string }[] }>('executeCommand', 'search_symbols', { query: tree.command.query });
    assert.ok((run?.results ?? []).map(r => r.name).includes(tree.command.name), 'the command ran the tool of the engine');

    const library = placeOf((await ask<(vscode.Location | vscode.LocationLink)[]>('libraryDefinition', 'vscode.executeDefinitionProvider', uri, at(document, tree.library)))[0]);
    assert.strictEqual(library.uri.scheme, 'jdt', `a library class is a jdt address: ${library.uri.toString()}`);
    const began = Date.now();
    const libraryText = (await vscode.workspace.openTextDocument(library.uri)).getText();
    ms.libraryContent = Date.now() - began;
    assert.ok(libraryText.includes('class String'), 'and its source opens in the editor');

    assert.strictEqual(fs.readFileSync(uri.fsPath, 'utf8'), saved, 'the file on disk is as it was');
    fs.writeFileSync(`${out}.navigation.${treeName}.json`, JSON.stringify(ms, null, 2));
    await vscode.commands.executeCommand('workbench.action.revertAndCloseActiveEditor');
  });
});
