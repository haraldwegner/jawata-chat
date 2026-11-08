// The release workflow's gate on versions (scripts/release-versions.mjs): the tag and both extensions' versions are one version.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { declaredVersions, problemsWith } from '../scripts/release-versions.mjs';

const SCRIPT = new URL('../scripts/release-versions.mjs', import.meta.url).pathname;

test('the two extensions declare one version in this repository', () => {
  const versions = declaredVersions();
  assert.deepEqual(Object.keys(versions).sort(), ['jawata-chat', 'jawata-java']);
  assert.deepEqual(problemsWith(versions, undefined), []);
});

test('a tag equal to both versions is accepted, and the script prints the version for the workflow', () => {
  const version = declaredVersions()['jawata-chat'];
  assert.equal(execFileSync('node', [SCRIPT, `v${version}`], { encoding: 'utf8' }).trim(), `version=${version}`);
  assert.equal(execFileSync('node', [SCRIPT], { encoding: 'utf8' }).trim(), `version=${version}`);
});

test('a tag that differs from either package, or packages that differ from each other, fail with the reason', () => {
  assert.deepEqual(problemsWith({ 'jawata-chat': '0.1.0', 'jawata-java': '0.1.0' }, 'v0.1.1'), [
    'the tag is v0.1.1 but jawata-chat is at 0.1.0', 'the tag is v0.1.1 but jawata-java is at 0.1.0']);
  const split = problemsWith({ 'jawata-chat': '0.2.0', 'jawata-java': '0.1.0' }, 'v0.2.0');
  assert.equal(split.length, 2);
  assert.match(split[0], /different versions/);
  assert.equal(split[1], 'the tag is v0.2.0 but jawata-java is at 0.1.0');
  assert.match(problemsWith({ 'jawata-chat': '0.1.0', 'jawata-java': '0.1.0' }, '0.1.0')[0], /not v<major>/);
  assert.equal(problemsWith({ 'jawata-chat': '0.2.0', 'jawata-java': '0.1.0' }, undefined).length, 1, 'a run without a tag still needs the two to agree');
});

test('the script itself exits 1 and names the mismatch when the tag is not the packages\' version', () => {
  const run = spawnSync('node', [SCRIPT, 'v9.9.9'], { encoding: 'utf8' });
  assert.equal(run.status, 1);
  assert.match(run.stderr, /the tag is v9\.9\.9 but jawata-chat is at /);
  assert.equal(run.stdout, '');
});
