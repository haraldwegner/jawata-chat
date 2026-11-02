import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';

/** Text typed into the open file and not saved: a method with a body to fold, a call whose arguments get hints, a var, and a method the first one calls. */
const TYPED = [
  '    /** Typed for the structure rows. */',
  '    int typedTotal(int firstTyped, int secondTyped) {',
  '        var summed = firstTyped + secondTyped;',
  '        int scaled = summed * 2;',
  '        return scaled + typedStep(firstTyped, 2);',
  '    }',
  '',
  '    int typedStep(int valueTyped, int stepTyped) {',
  '        return valueTyped * stepTyped;',
  '    }',
  '',
].join('\n');

function lineIn(text: string, marker: string): number {
  const line = text.split('\n').findIndex(l => l.includes(marker));
  assert.ok(line >= 0, `a line holds ${marker}`);
  return line;
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

/** The tokens of an answer as `text:type:modifiers`, decoded with the legend the server announced. */
function decode(document: vscode.TextDocument, legend: vscode.SemanticTokensLegend, tokens: vscode.SemanticTokens): Set<string> {
  const found = new Set<string>();
  let line = 0;
  let column = 0;
  for (let i = 0; i + 4 < tokens.data.length; i += 5) {
    line += tokens.data[i];
    column = tokens.data[i] === 0 ? column + tokens.data[i + 1] : tokens.data[i + 1];
    const modifiers = legend.tokenModifiers.filter((_, bit) => (tokens.data[i + 4] & (1 << bit)) !== 0);
    found.add(`${document.lineAt(line).text.substr(column, tokens.data[i + 2])}:${legend.tokenTypes[tokens.data[i + 3]]}:${modifiers.join(',')}`);
  }
  return found;
}

/**
 * The boundary clause of S16d in a real window: folding, selection ranges, semantic tokens, inlay hints and code lenses are asked of the
 * editor's own providers over text typed and not saved, and each answer is read as the editor would show it. The milliseconds each took
 * are written beside the other runs'.
 */
suite('Structure, colour and hints', () => {
  test('folding, selection, semantic tokens, inlay hints and code lenses are shown by the editor', async function () {
    const workspace = process.env.JAWATA_LIVE_WORKSPACE;
    const file = process.env.JAWATA_LIVE_FILE;
    const out = process.env.JAWATA_LIVE_OUT;
    const server = process.env.JAWATA_LIVE_SERVER;
    const treeName = process.env.JAWATA_LIVE_TREE ?? 'maven';
    assert.ok(workspace && file && out && server, 'JAWATA_LIVE_WORKSPACE, _FILE, _OUT and _SERVER are set');
    await vscode.workspace.getConfiguration('jawataJava').update('server', JSON.parse(server), vscode.ConfigurationTarget.Global);

    const uri = vscode.Uri.file(path.join(workspace, file));
    const document = await vscode.workspace.openTextDocument(uri);
    const editor = await vscode.window.showTextDocument(document);
    const saved = document.getText();
    await engineAnswers(uri, 180000);

    const ms: Record<string, number> = {};
    // an editor abandons a request when the document changes under it; it is asked again, as the editor would, before a step fails
    const ask = async <T>(feature: string, accept: (answer: T) => boolean, command: string, ...args: unknown[]): Promise<T> => {
      const began = Date.now();
      let answer: T | undefined;
      for (let attempt = 1; attempt <= 6; attempt++) {
        try {
          answer = await vscode.commands.executeCommand<T>(command, ...args);
          if (accept(answer)) { ms[feature] = Date.now() - began; return answer; }
        } catch (error) {
          if (!String(error).includes('Canceled') || attempt === 6) {
            throw new Error(`${feature} (${command}) failed after ${Date.now() - began} ms, attempt ${attempt}: ${String(error)}`);
          }
        }
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      assert.fail(`${feature} (${command}) gave no wanted answer in 6 attempts: ${JSON.stringify(answer)}`);
    };

    await editor.edit(builder => builder.insert(document.positionAt(saved.lastIndexOf('}')), '\n' + TYPED));
    assert.ok(document.isDirty, 'the text is unsaved');
    const text = document.getText();
    const totalLine = lineIn(text, 'int typedTotal(');
    const stepLine = lineIn(text, 'int typedStep(');
    const returnLine = lineIn(text, 'return scaled + typedStep');

    // folding: the typed method folds from its signature line to the line before its closing brace
    const folds = await ask<vscode.FoldingRange[]>('foldingRange', a => !!a && a.length > 0, 'vscode.executeFoldingRangeProvider', uri);
    assert.ok(folds.some(f => f.start === totalLine && f.end === returnLine), `the typed method folds ${totalLine}-${returnLine}: ${JSON.stringify(folds)}`);
    assert.ok(folds.some(f => f.start < totalLine && f.end > stepLine), 'the class body folds around the typed methods');

    // selection: from the name under the cursor outward, each range inside the next
    const nameAt = new vscode.Position(returnLine, document.lineAt(returnLine).text.indexOf('scaled') + 1);
    const selections = await ask<vscode.SelectionRange[]>('selectionRange', a => !!a && a.length > 0, 'vscode.executeSelectionRangeProvider', uri, [nameAt]);
    const chain: vscode.Range[] = [];
    for (let link: vscode.SelectionRange | undefined = selections[0]; link; link = link.parent) { chain.push(link.range); }
    assert.strictEqual(document.getText(chain[0]), 'scaled', 'the innermost range is the name under the cursor');
    assert.ok(chain.length >= 4, `the selection widens through the enclosing nodes: ${chain.length} ranges`);
    assert.ok(chain.every((r, i) => i === 0 || r.contains(chain[i - 1])), 'each range holds the one inside it');

    // semantic tokens: the typed names get the type and modifiers the compiler binds them to
    const legend = await ask<vscode.SemanticTokensLegend>('legend', a => !!a && a.tokenTypes.length > 0, 'vscode.provideDocumentSemanticTokensLegend', uri);
    const tokens = await ask<vscode.SemanticTokens>('semanticTokens', a => !!a && a.data.length > 0, 'vscode.provideDocumentSemanticTokens', uri);
    const names = decode(document, legend, tokens);
    assert.ok(names.has('typedTotal:method:declaration'), `the typed method is a method declaration: ${[...names].filter(n => n.startsWith('typed')).join(' ')}`);
    assert.ok(names.has('firstTyped:parameter:declaration'), 'a typed parameter is a parameter declaration');
    assert.ok(names.has('typedStep:method:'), 'the call of the typed method is a method use');
    assert.ok(names.has('summed:variable:declaration'), 'a typed local variable is a variable declaration');

    // inlay hints: the parameter each argument fills, and the type of each var
    const range = new vscode.Range(totalLine, 0, stepLine, 0);
    const hints = await ask<vscode.InlayHint[]>('inlayHints', a => !!a && a.length > 0, 'vscode.executeInlayHintProvider', uri, range);
    const labels = hints.map(h => typeof h.label === 'string' ? h.label : h.label.map(part => part.value).join(''));
    assert.ok(labels.includes('valueTyped:') && labels.includes('stepTyped:'), `the arguments of the typed call are named: ${labels.join(' ')}`);
    assert.ok(labels.includes(': int'), `a var gets its type: ${labels.join(' ')}`);

    // code lenses: the typed method that is called once counts one reference, the one nothing calls counts none
    const lenses = await ask<vscode.CodeLens[]>('codeLens',
      a => !!a && a.some(l => l.range.start.line === stepLine && !!l.command) && a.some(l => l.range.start.line === totalLine && !!l.command),
      'vscode.executeCodeLensProvider', uri, 100);
    const titleOn = (line: number) => lenses.find(l => l.range.start.line === line)?.command?.title;
    assert.strictEqual(titleOn(stepLine), '1 reference', 'the called method counts its call');
    assert.strictEqual(titleOn(totalLine), '0 references', 'the method nothing calls counts none');

    assert.strictEqual(fs.readFileSync(uri.fsPath, 'utf8'), saved, 'the file on disk is as it was');
    await vscode.window.showTextDocument(document);
    await vscode.commands.executeCommand('workbench.action.files.revert');
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
    fs.writeFileSync(`${out}.structure.${treeName}.json`, JSON.stringify(ms));
  });
});
