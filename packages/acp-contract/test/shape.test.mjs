// shapeOf names the contract's fields and ignores prose.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readSession, shapeOf } from '../dist/index.js';

const r2 = readSession(new URL('../sessions/R2.jsonl', import.meta.url));

test('a tool call carries its kind, status and whether it has a title', () => {
  assert.ok(shapeOf(r2).includes('recv session/update tool_call kind=edit status=pending title=yes'));
});

test('a permission request carries its option kinds', () => {
  assert.ok(shapeOf(r2).includes('recv session/request_permission options=allow_once,allow_always,reject_once'));
});

test('a request carries its params keys', () => {
  assert.equal(shapeOf(r2)[0], 'send initialize params=clientCapabilities,clientInfo,protocolVersion');
});

test('prose is not shape, a changed field is', () => {
  const chunk = r2.find((l) => l.msg.params?.update?.sessionUpdate === 'agent_message_chunk');
  const reworded = structuredClone(chunk);
  reworded.msg.params.update.content.text = 'something else entirely';
  assert.deepEqual(shapeOf([reworded]), shapeOf([chunk]));
  const call = r2.find((l) => l.msg.params?.update?.sessionUpdate === 'tool_call');
  const rekinded = structuredClone(call);
  rekinded.msg.params.update.kind = 'read';
  assert.notDeepEqual(shapeOf([rekinded]), shapeOf([call]));
});

test('the shape of a command list is the set of jawata groups it carries, not the machine-dependent names', () => {
  const grouped = shapeOf(readSession(new URL('../sessions/R3.jsonl', import.meta.url))).find((s) => s.includes('available_commands_update'));
  assert.match(grouped, /groups=seat,skill,utility$/);
  const plain = shapeOf(readSession(new URL('../sessions/R1.jsonl', import.meta.url))).find((s) => s.includes('available_commands_update'));
  assert.match(plain, /groups=$/);
});
