// The contract number is pinned (ledger C14-2, C15-2): the names of what passes between the core and a page, recorded for each number.
// A change to the names without a new number is red; the rule for the number is written beside VIEW_CONTRACT_VERSION in view.ts.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { VIEW_CONTRACT_VERSION, VIEW_INTENT_TYPES } from '../dist/view.js';
import { initialViewState } from '../dist/view-state.js';

const RECORD = new URL('./contract-shapes.json', import.meta.url);

/** The names the contract is made of now: the message types (read off the union in view.ts), the intent types, the fields of the state. */
export const shapeNow = () => {
  const source = readFileSync(new URL('../src/view.ts', import.meta.url), 'utf8');
  const union = source.slice(source.indexOf('export type ViewMessage'), source.indexOf('export type ViewIntent'));
  return {
    messages: [...new Set([...union.matchAll(/\{ type: '([A-Za-z-]+)'/g)].map(m => m[1]))].sort(),
    intents: [...VIEW_INTENT_TYPES].sort(),
    state: Object.keys(initialViewState()).sort(),
  };
};

test('the names of the messages, the intents and the state are those recorded for this contract number', () => {
  const recorded = JSON.parse(readFileSync(RECORD, 'utf8'));
  if (process.env.JAWATA_UPDATE_CONTRACT_SHAPE === '1') {
    writeFileSync(RECORD, JSON.stringify({ ...recorded, [VIEW_CONTRACT_VERSION]: shapeNow() }, null, 2) + '\n');
    return;
  }
  assert.ok(recorded[VIEW_CONTRACT_VERSION], `no shape is recorded for contract number ${VIEW_CONTRACT_VERSION}: a new number needs its shape recorded (JAWATA_UPDATE_CONTRACT_SHAPE=1)`);
  assert.deepEqual(shapeNow(), recorded[VIEW_CONTRACT_VERSION], `the shape changed and the number did not: raise VIEW_CONTRACT_VERSION (rule in view.ts) and record the new shape`);
});

test('a number recorded earlier is never rewritten: the shapes of 3 and later are history', () => {
  const recorded = JSON.parse(readFileSync(RECORD, 'utf8'));
  assert.ok(Object.keys(recorded).every(n => Number(n) <= VIEW_CONTRACT_VERSION), 'no shape is recorded for a number the contract has not reached');
});
