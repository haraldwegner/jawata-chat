import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';

// the compiled module is CommonJS (the editor loads it so); npm test compiles it into out/ first
const { launchOf, rivalNotice, rivalsOf } = createRequire(import.meta.url)('../out/launch.js');

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

test('a rival is found by its identifier whatever the case, and an extension that is not one is left out', () => {
  assert.deepEqual(rivalsOf(['ms-python.python', 'RedHat.Java', 'jawata.jawata-chat'], ['redhat.java', 'other.java']), ['redhat.java']);
  assert.deepEqual(rivalsOf(['ms-python.python'], ['redhat.java']), []);
});

test('the notice names every rival and says to switch it off', () => {
  assert.match(rivalNotice(['redhat.java']), /redhat\.java.*Switch it off/);
  assert.match(rivalNotice(['a.one', 'b.two']), /a\.one, b\.two.*Switch them off/);
});
