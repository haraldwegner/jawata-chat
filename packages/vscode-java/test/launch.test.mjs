import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';

// the compiled module is CommonJS (the editor loads it so); npm test compiles it into out/ first
const { launchOf, rivalNotice, rivalRemovalOf, uninstallOrder } =createRequire(import.meta.url)('../out/launch.js');

test('a command with --lsp among its arguments is run as written, with its environment', () => {
  const launch = launchOf({ command: 'java', args: ['-jar', 'jawata.jar', '--lsp', '--url', 'http://127.0.0.1:9'], env: { JAWATA_KEY: 'k' } });
  assert.deepEqual(launch, { ok: true, command: 'java', args: ['-jar', 'jawata.jar', '--lsp', '--url', 'http://127.0.0.1:9'], env: { JAWATA_KEY: 'k' } });
});

test('no setting, or an empty command, is refused with the sentence that says what to set', () => {
  for (const setting of [undefined, {}, { command: '   ', args: ['--lsp'] }]) {
    const launch = launchOf(setting);
    assert.equal(launch.ok, false);
    assert.match(launch.why, /jawataJava\.server\.command/);
  }
});

test('arguments without --lsp are refused, because the launcher would then not forward the language server', () => {
  const launch = launchOf({ command: 'java', args: ['-jar', 'jawata.jar', '--acp'] });
  assert.equal(launch.ok, false);
  assert.match(launch.why, /--lsp/);
});

const redHat = { id: 'redhat.java', name: 'Language Support for Java(TM) by Red Hat', dependsOn: [] };
const javaDebug = { id: 'vscjava.vscode-java-debug', name: 'Debugger for Java', dependsOn: ['redhat.java'] };
const javaTest = { id: 'vscjava.vscode-java-test', name: 'Test Runner for Java', dependsOn: ['RedHat.Java', 'vscjava.vscode-java-debug'] };
const python = { id: 'ms-python.python', name: 'Python', dependsOn: [] };

test('a rival is found by its identifier whatever the case, with every installed extension that needs it, directly or through another', () => {
  const removal = rivalRemovalOf([python, javaTest, { ...redHat, id: 'RedHat.Java' }, javaDebug], ['redhat.java', 'other.java']);
  assert.deepEqual(removal.rivals.map(e => e.id), ['RedHat.Java']);
  assert.deepEqual(removal.dependents.map(e => e.id).sort(), ['vscjava.vscode-java-debug', 'vscjava.vscode-java-test']);
  assert.equal(rivalRemovalOf([python, { id: 'x.y', name: 'X', dependsOn: ['ms-python.python'] }], ['redhat.java']), null, 'no rival, nothing to remove');
});

test('the notice says in plain words what is wrong and what to do, and names the rival and each extension that goes with it', () => {
  const alone = rivalNotice(rivalRemovalOf([redHat], ['redhat.java']));
  assert.match(alone, /Language Support for Java\(TM\) by Red Hat \(redhat\.java\) is still installed/);
  assert.match(alone, /second Java server/);
  assert.match(alone, /Uninstall it\.$/);
  assert.doesNotMatch(alone, /Switch|workspace|shares the editor/, 'the old wording is gone');
  const withDependents = rivalNotice(rivalRemovalOf([redHat, javaDebug, javaTest], ['redhat.java']));
  assert.match(withDependents, /Uninstall it, together with the extensions that need it: /);
  assert.match(withDependents, /Debugger for Java \(vscjava\.vscode-java-debug\)/);
  assert.match(withDependents, /Test Runner for Java \(vscjava\.vscode-java-test\)/);
});

test('the button uninstalls what needs a rival before what it needs, and the rival last, so the editor refuses none of them', () => {
  assert.deepEqual(uninstallOrder(rivalRemovalOf([redHat, javaDebug, javaTest], ['redhat.java'])), ['vscjava.vscode-java-test', 'vscjava.vscode-java-debug', 'redhat.java']);
  assert.deepEqual(uninstallOrder(rivalRemovalOf([javaTest, javaDebug, redHat], ['redhat.java'])), ['vscjava.vscode-java-test', 'vscjava.vscode-java-debug', 'redhat.java']);
  assert.deepEqual(uninstallOrder(rivalRemovalOf([redHat], ['redhat.java'])), ['redhat.java']);
});
