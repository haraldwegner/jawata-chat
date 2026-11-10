import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const { debugLaunchOf } = createRequire(import.meta.url)('../out/launch.js');

test('the debugger runs the language server\'s launcher with --dap where --lsp was, and the same environment', () => {
  const launch = debugLaunchOf({ command: 'java', args: ['-jar', 'jawata.jar', '--lsp', '--url', 'http://127.0.0.1:9'], env: { JAWATA_KEY: 'k' } });
  assert.deepEqual(launch, { ok: true, command: 'java', args: ['-jar', 'jawata.jar', '--dap', '--url', 'http://127.0.0.1:9'], env: { JAWATA_KEY: 'k' } });
});

test('the engine the studio named for this window replaces the address and key, as it does for the language server', () => {
  const launch = debugLaunchOf({ command: 'java', args: ['--lsp'], env: { JAWATA_URL: 'http://old', JAWATA_KEY: 'old' } }, { url: 'http://127.0.0.1:7', key: 'new' });
  assert.equal(launch.ok, true);
  assert.equal(launch.env.JAWATA_URL, 'http://127.0.0.1:7');
  assert.equal(launch.env.JAWATA_KEY, 'new');
});

test('a setting the language server would refuse is refused for the debugger in the same words', () => {
  for (const setting of [undefined, { command: '  ', args: ['--lsp'] }, { command: 'java', args: ['--acp'] }]) {
    const launch = debugLaunchOf(setting);
    assert.equal(launch.ok, false);
    assert.match(launch.why, /jawataJava\.server|--lsp/);
  }
});
