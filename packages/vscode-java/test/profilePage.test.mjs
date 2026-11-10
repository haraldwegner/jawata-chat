import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const { answerPage } = require('../out/profileHost.js');
const { webviewSource } = require('../out/profileSource.js');

const where = { uri: 'file:///w/Target', range: { start: { line: 1, character: 2 }, end: { line: 1, character: 5 } } };
const ranked = { dimension: 'cpu', totalSamples: 1, totalMethods: 1, rows: [{ symbol: 'a.B#c', samples: 1 }] };

function host(options = {}) {
  const opened = [];
  // an explicit session: undefined means no program is running, so a default parameter would be the wrong way to say "s1 unless told otherwise"
  const session = 'session' in options ? options.session : 's1';
  return { session: () => session, profile: options.profile ?? (async () => ranked), open: async l => { opened.push(l); }, opened };
}

test('a record request is answered with the ranking, asked of the engine for the editor\'s own session and the seconds and measure the page named', async () => {
  const asked = [];
  const reply = await answerPage({ type: 'sample', id: 7, seconds: 3, dimension: 'wall' }, host({ profile: async r => { asked.push(r); return ranked; } }));
  assert.deepEqual(reply, { type: 'sampled', id: 7, result: ranked });
  assert.deepEqual(asked, [{ sessionId: 's1', seconds: 3, dimension: 'wall' }]);
});

test('with no program running under the debugger the answer says so and the engine is not asked', async () => {
  let asked = false;
  const reply = await answerPage({ type: 'sample', id: 1, seconds: 5, dimension: 'cpu' }, host({ session: undefined, profile: async () => { asked = true; return ranked; } }));
  assert.deepEqual(reply, { type: 'failed', id: 1, why: reply.why });
  assert.match(reply.why, /No program of yours is running under the jawata debugger/);
  assert.equal(asked, false);
});

test('a recording the engine refuses is answered with its reason, under the same id', async () => {
  const reply = await answerPage({ type: 'sample', id: 4, seconds: 5, dimension: 'cpu' }, host({ profile: async () => { throw new Error('Flight Recorder is off'); } }));
  assert.deepEqual(reply, { type: 'failed', id: 4, why: 'Flight Recorder is off' });
});

test('an open request opens the place and has no answer', async () => {
  const h = host();
  assert.equal(await answerPage({ type: 'open', location: where }, h), undefined);
  assert.deepEqual(h.opened, [where]);
});

test('in the webview each record request waits for the answer with its own id, and a refusal rejects it with the reason', async () => {
  const posted = [];
  let deliver;
  const source = webviewSource({ post: m => posted.push(m), listen: h => { deliver = h; } });
  const first = source.sample({ seconds: 2, dimension: 'cpu' });
  const second = source.sample({ seconds: 4, dimension: 'alloc' });
  assert.deepEqual(posted.map(m => [m.id, m.seconds, m.dimension]), [[1, 2, 'cpu'], [2, 4, 'alloc']]);
  deliver({ type: 'failed', id: 2, why: 'no such session' });
  deliver({ type: 'sampled', id: 1, result: ranked });
  assert.deepEqual(await first, ranked);
  await assert.rejects(second, /no such session/);
});

test('opening a place from the page is posted to the editor and not waited for, and an answer nobody asked for is ignored', async () => {
  const posted = [];
  let deliver;
  const source = webviewSource({ post: m => posted.push(m), listen: h => { deliver = h; } });
  source.open(where);
  assert.deepEqual(posted, [{ type: 'open', location: where }]);
  assert.doesNotThrow(() => deliver({ type: 'sampled', id: 99, result: ranked }));
});
