// The release workflow (.github/workflows/release.yml): what it must do on a tag and must not do on a dispatch run. The steps are read as text,
// because the repository holds no YAML parser; each step starts at a line `      - name:`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { declaredVersions } from '../scripts/release-versions.mjs';

const text = readFileSync(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8');
const steps = text.split(/\n(?=      - name:)/).slice(1);
const named = (fragment) => steps.find(s => s.split('\n')[0].includes(fragment));
const TAG_ONLY = "if: startsWith(github.ref, 'refs/tags/')";

test('it runs on a v* tag and by hand', () => {
  assert.match(text, /on:\n  push:\n    tags:\n      - 'v\*'\n  workflow_dispatch:/);
});

test('every step that touches a release is for a tag run only, so a dispatch run publishes nothing', () => {
  const touching = steps.filter(s => /\bgh (release|api)\b/.test(s));
  assert.ok(touching.length >= 3, `found ${touching.length} release steps`);
  for (const s of touching) { assert.ok(s.includes(TAG_ONLY), `not tag-only: ${s.split('\n')[0]}`); }
});

test('the release is made as a draft with both files, published as latest, and read back', () => {
  assert.match(named('Create the release').replace(/\\\n/g, ' ').replace(/\s+/g, ' '), /gh release create "\$TAG" vsix\/\*\.vsix --draft --verify-tag .*--notes-file "docs\/release-notes\/\$\{TAG\}\.md"/);
  assert.match(named('Publish the release'), /gh release edit "\$TAG" --draft=false --latest/);
  const verify = named('Verify the release');
  for (const check of ['.draft', '.prerelease', '.body', '.assets[].name', 'releases/latest']) { assert.ok(verify.includes(check), `the verification does not read ${check}`); }
});

test('the version check runs before anything is built, and the lint, type check and tests all run', () => {
  const order = steps.map(s => s.split('\n')[0]);
  const at = (fragment) => order.findIndex(l => l.includes(fragment));
  assert.ok(at('package versions are equal') > 0 && at('package versions are equal') < at('Install dependencies'));
  for (const command of ['npm run lint', 'npm run typecheck', 'xvfb-run -a npm test']) { assert.ok(text.includes(command), command); }
});

test('both .vsix files are built and uploaded as workflow artifacts on every run', () => {
  assert.match(named('Build the two .vsix files'), /jawata-chat-\$\{VERSION\}\.vsix[\s\S]*jawata-java-\$\{VERSION\}\.vsix/);
  const upload = named('Upload the .vsix files');
  assert.ok(upload.includes('actions/upload-artifact') && !upload.includes('if:'));
});

test('the notes the workflow publishes exist for the version in the packages', () => {
  const version = declaredVersions()['jawata-chat'];
  assert.ok(existsSync(new URL(`../docs/release-notes/v${version}.md`, import.meta.url)), `docs/release-notes/v${version}.md`);
});
