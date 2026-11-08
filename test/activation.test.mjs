import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

// Sprint 28h Stage 21 (d), audit finding 1. His words: "VSCode starts and any start should immediately start studio."
// The studio is started by each extension when it activates, so an extension that activates only on its first use (the
// chat had no activation event at all, jawata Java waited for a Java file) starts the studio on first use, not on
// VS Code starting.
const packages = ['packages/vscode/package.json', 'packages/vscode-java/package.json'];

for (const file of packages) {
  test(`${file} activates when VS Code has started, not only on first use`, () => {
    const manifest = JSON.parse(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'));
    assert.ok(Array.isArray(manifest.activationEvents), `${file} has no activationEvents list`);
    assert.ok(manifest.activationEvents.includes('onStartupFinished'),
      `${file} does not activate on startup: ${JSON.stringify(manifest.activationEvents)}`);
  });
}
