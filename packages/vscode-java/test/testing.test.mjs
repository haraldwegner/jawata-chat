import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const { treeOf, outcomeOf } = createRequire(import.meta.url)('../out/testing.js');

const listed = [{
  name: 'FooTest', uri: 'file:///w/FooTest.java', line: 9, framework: 'JUnit5', scope: { kind: 'class', typeName: 'com.x.FooTest' },
  tests: [
    { name: 'adds', label: 'adding works', line: 12, scope: { kind: 'method', typeName: 'com.x.FooTest', methodName: 'adds' } },
    { name: 'subtracts', label: 'subtracts', line: 20, scope: { kind: 'method', typeName: 'com.x.FooTest', methodName: 'subtracts' } },
  ],
}];

test('the Testing tree has a class per item, named by its qualified name, with its methods inside it', () => {
  const tree = treeOf(listed);
  assert.equal(tree.length, 1);
  assert.equal(tree[0].id, 'com.x.FooTest');
  assert.equal(tree[0].label, 'FooTest');
  assert.deepEqual(tree[0].children.map(c => [c.id, c.label, c.line]), [['com.x.FooTest#adds', 'adding works', 12], ['com.x.FooTest#subtracts', 'subtracts', 20]]);
});

test('a failure is put on its method with the message and line, and what did not fail is left for the host to mark passed', () => {
  const tree = treeOf(listed);
  const outcome = outcomeOf(tree, { state: 'FINISHED', summary: { failed: 1 }, failures: [{ testClass: 'com.x.FooTest', testMethod: 'adds', status: 'FAILED', message: 'expected 4', line: 41 }] });
  assert.deepEqual([...outcome.failed], [['com.x.FooTest#adds', { message: 'expected 4', line: 41 }]]);
  assert.ok(outcome.ranIds.includes('com.x.FooTest#subtracts'));
  assert.equal(outcome.cancelled, false);
});

test('a parameterized test\'s method name loses its parameter types, so the failure lands on the method\'s item', () => {
  const tree = treeOf(listed);
  const outcome = outcomeOf(tree, { state: 'FINISHED', summary: {}, failures: [{ testClass: 'com.x.FooTest', testMethod: 'adds(int, int)[2]', status: 'FAILED', message: 'm' }] });
  assert.deepEqual([...outcome.failed.keys()], ['com.x.FooTest#adds']);
});

test('a failure that names no listed method turns the class red, so a class that failed to start is not shown green', () => {
  const tree = treeOf(listed);
  const outcome = outcomeOf(tree, { state: 'FINISHED', summary: {}, failures: [{ testClass: 'com.x.FooTest', testMethod: '', status: 'FAILED', message: 'could not start' }] });
  assert.deepEqual([...outcome.failed.keys()], ['com.x.FooTest']);
});

test('a failure in a method the list does not hold, such as a dynamic test, is put on its class rather than lost', () => {
  const tree = treeOf(listed);
  const outcome = outcomeOf(tree, { state: 'FINISHED', summary: {}, failures: [{ testClass: 'com.x.FooTest', testMethod: 'generatedCase', status: 'FAILED', message: 'boom' }] });
  assert.deepEqual([...outcome.failed.keys()], ['com.x.FooTest']);
});

test('a cancelled run says so, which is not the same as a passing one', () => {
  const outcome = outcomeOf(treeOf(listed), { state: 'CANCELLED', summary: { cancelled: true }, failures: [] });
  assert.equal(outcome.cancelled, true);
});
