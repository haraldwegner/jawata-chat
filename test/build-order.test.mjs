// One command builds the repository (ledger 28i-C17-5): the order comes from the packages' own dependencies, not the alphabet.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildOrder, packagesOf } from '../scripts/build.mjs';

test('every package is built after the packages of this repository it depends on, and every package has a build script', () => {
  const packages = packagesOf();
  assert.ok(packages.length >= 4, `found ${packages.length} packages`);
  const order = buildOrder(packages).map(p => p.name);
  for (const p of packages) {
    for (const dep of p.needs.filter(n => order.includes(n))) {
      assert.ok(order.indexOf(dep) < order.indexOf(p.name), `${p.name} is built before ${dep}, which it reads`);
    }
    assert.ok(p.scripts.build, `${p.folder} has no build script`);
  }
});

test('control: the order follows the dependencies when the alphabet says otherwise, and a circle is refused', () => {
  const pkg = (name, needs) => ({ folder: name, name, needs, library: true, scripts: { build: 'x' } });
  assert.deepEqual(buildOrder([pkg('a', ['z']), pkg('z', [])]).map(p => p.name), ['z', 'a']);
  assert.throws(() => buildOrder([pkg('a', ['b']), pkg('b', ['a'])]), /circle/);
});
