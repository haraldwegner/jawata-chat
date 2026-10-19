// The control of the dead-export gate. The gate is `npm run knip` at the workspace root, which fails the ladder; this shows that an
// export used only by a test is reported by this configuration shape, so a gate that reads "0" can be believed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const knip = fileURLToPath(new URL('../../../node_modules/knip/bin/knip.js', import.meta.url));
const control = fileURLToPath(new URL('./knip-control/', import.meta.url));

test('control: an export used only by a test is reported', () => {
  const r = spawnSync(process.execPath, [knip, '--production', '--directory', control, '--no-progress'], { encoding: 'utf8' });
  assert.notEqual(r.status, 0, 'knip found nothing wrong in the control: ' + r.stdout);
  assert.match(r.stdout, /usedOnlyByATest/);
  assert.doesNotMatch(r.stdout, /\bused\b\s+function|\bused\s+src/, 'the export that production uses is not reported');
});
