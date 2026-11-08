import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';
import { fileURLToPath } from 'node:url';

// Sprint 28h stage 21 (j). His words: "If I start a VScode with a workspace, then we need to start the jawata workspace which includes this."
// The compiled modules are CommonJS (the editor loads them so); npm test compiles them into out/ first.
const require = createRequire(import.meta.url);
const { ASKING_WAIT_MS, editorFoldersOf, HANDOFF_WAIT_MS, handoffId, launchArguments, nodePorts, POLL_MS, StudioStart, STALE_MS, toldToThePerson, WAIT_MS, windowRegister, withEngine } = require('../out/studio.js');
const { launchOf } = require('../out/launch.js');

const fakeStudio = fileURLToPath(new URL('./support/fake-studio.cjs', import.meta.url));
const SECRET = 'KEY-9f3a7c-do-not-log';
const cleanups = [];
afterEach(async () => { windowRegister().clear(); for (const c of cleanups.splice(0)) { await c(); } });
/** Waits (in real time) until the file's text is no longer `text`, and then lets a second of the clock go by in the code under test. */
async function untilChanged(file, text) {
  const end = Date.now() + 10000;
  while (existsSync(file) && readFileSync(file, 'utf8') === text && Date.now() < end) { await later(5); }
}
/** Waits (in real time) until the file is there. */
async function untilExists(file) {
  const end = Date.now() + 10000;
  while (!existsSync(file) && Date.now() < end) { await later(5); }
}
const later = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/** A server on a free local port that answers every request; `up()` and `down()` start and stop it. */
async function service({ up = true } = {}) {
  const probe = http.createServer();
  await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
  const { port } = probe.address();
  await new Promise(resolve => probe.close(resolve));
  let server;
  const s = {
    url: `http://127.0.0.1:${port}`,
    async up() { server = http.createServer((_q, r) => { r.statusCode = 401; r.end('x'); }); await new Promise(resolve => server.listen(port, '127.0.0.1', resolve)); },
    async down() { server?.closeAllConnections(); await new Promise(resolve => server ? server.close(resolve) : resolve()); server = undefined; },
  };
  cleanups.push(() => s.down());
  if (up) { await s.up(); }
  return s;
}

/** A handoff folder, the studio setting that starts the fake studio with `steps`, and what the fake studio recorded. */
function world(steps, { folders = ['/home/h/proj'], removeOld = false } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'jawata-handoff-'));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  const setting = { command: process.execPath, args: [fakeStudio, '--config', JSON.stringify({ dir, steps, removeOld })], handoffDir: dir };
  const file = join(dir, `${handoffId(folders)}.json`);
  const launches = () => existsSync(join(dir, 'launches.jsonl')) ? readFileSync(join(dir, 'launches.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];
  return { dir, setting, file, folders, launches };
}

/** Real process start, real file read, real probe; the clock moves by what is slept (the `pace` is the real milliseconds a second of it takes) and the status lines are kept. */
function ports(pace = 15, overrides = {}) {
  let t = 0;
  const real = nodePorts((_text, job) => job(), 300);
  const made = {
    said: [], status: [], slept: 0,
    probe: real.probe, start: real.start, readFile: real.readFile,
    now: () => t,
    sleep: async (ms) => { t += ms; made.slept++; await later(pace); },
    whileWaiting: (text, job) => { made.status.push(text); return job(); },
    say: (text) => { made.said.push(text); },
    ...overrides,
  };
  return made;
}

test('the file name is the lowercase hex SHA-256 of the folders sorted by their UTF-8 bytes and joined with one newline', () => {
  assert.equal(handoffId(['/a/b', '/c']), '5650d16fbb762aa37a51dc25636e82d35230e7da6a6d5e77c31dd3b4007de4be');
  assert.equal(handoffId(['/home/h/proj']), '1e7edaca38dbb9d07c23cc7e5f5de48c9460cf7c53bee8eb926d3dd184ee2209');
  assert.equal(handoffId(['/c', '/a/b']), handoffId(['/a/b', '/c']), 'the order the window lists them in does not matter');
  // byte order is not the order of UTF-16 code units: U+FFFF is three bytes starting EF, U+1F600 four bytes starting F0, but its first code unit D83D sorts before FFFF
  const text = (...parts) => createHash('sha256').update(Buffer.from(parts.join('\n'), 'utf8')).digest('hex');
  assert.equal(handoffId(['/\u{1F600}', '/￿']), text('/￿', '/\u{1F600}'));
  assert.notEqual(handoffId(['/a', '/b']), handoffId(['/a/b']), 'a newline between folders, not nothing');
  assert.notEqual(handoffId(['/a']), handoffId(['/a', '']), 'no newline at the end');
});

test('the command line is the setting\'s arguments, then --editor-folder and the folder, for each folder in turn', () => {
  assert.deepEqual(launchArguments(['--background'], ['/home/h/proj']), ['--background', '--editor-folder', '/home/h/proj']);
  assert.deepEqual(launchArguments(['--background'], ['/a/b', '/c']), ['--background', '--editor-folder', '/a/b', '--editor-folder', '/c']);
  assert.deepEqual(launchArguments([], ['/a']), ['--editor-folder', '/a']);
});

test('the folders are the real paths, a path that cannot be resolved stands as given, and none is told twice or empty', () => {
  const real = (f) => { if (f === '/gone') { throw new Error('ENOENT'); } return f.replace('/link', '/real'); };
  assert.deepEqual(editorFoldersOf(['/link/a', '/gone', '/real/a', '  ', ''], real), ['/real/a', '/gone']);
  const dir = mkdtempSync(join(tmpdir(), 'jawata-real-'));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  assert.deepEqual(editorFoldersOf([dir]), [realpathSync(dir)]);
});

test('ready: the studio is started with the folders, its answer is used once its address answers, and the person is told nothing', async () => {
  const engine = await service();
  const w = world([{ afterMs: 0, state: 'ready', url: engine.url, key: SECRET, workspace: 'proj' }]);
  const p = ports();
  const outcome = await new StudioStart(p, new Map()).ensure(undefined, w.setting, w.folders);
  assert.equal(outcome.kind, 'ready', outcome.why);
  assert.deepEqual(outcome.engine, { url: engine.url, key: SECRET });
  assert.equal(outcome.handoff, 'ready');
  assert.equal(toldToThePerson(outcome), false);
  assert.deepEqual(w.launches().map(l => l.argv.slice(2)), [['--editor-folder', '/home/h/proj']]);
  assert.equal(w.launches().length, 1);
  assert.deepEqual(p.said, []);
  assert.doesNotMatch(JSON.stringify([outcome.why, p.status, p.said]), new RegExp(SECRET));
  assert.ok(!outcome.why.includes(engine.url), 'the address is not written into the sentence either');
});

test('ready: the studio is started also when the engine service already answers, and the service of the agent setting is not asked', async () => {
  const engine = await service();
  const w = world([{ afterMs: 0, state: 'ready', url: engine.url, key: SECRET }]);
  const p = ports(15, { probe: async (url) => { assert.equal(url, engine.url, 'only the studio\'s answer is probed'); return true; } });
  const outcome = await new StudioStart(p, new Map()).ensure('http://127.0.0.1:1', w.setting, w.folders);
  assert.equal(outcome.kind, 'ready');
  assert.equal(w.launches().length, 1);
});

test('asking: one status message says so, and the answer that follows is used', async () => {
  const engine = await service();
  const w = world([{ afterMs: 0, state: 'asking' }, { afterMs: 400, state: 'ready', url: engine.url, key: SECRET }]);
  const p = ports(30);
  const outcome = await new StudioStart(p, new Map()).ensure(undefined, w.setting, w.folders);
  assert.equal(outcome.kind, 'ready', outcome.why);
  assert.equal(p.said.length, 1);
  assert.match(p.said[0], /asking/);
  assert.deepEqual(p.status, ['Starting the jawata studio…'], 'the progress notice is the first phase only');
});

test('asking: it waits past the 330 seconds a missing file is given, and the answer that follows is used', async () => {
  const engine = await service();
  const w = world([{ afterMs: 0, state: 'asking' }]);
  const p = ports(2);
  const sleep = p.sleep;
  p.sleep = async (ms) => { await sleep(ms); if (p.slept === HANDOFF_WAIT_MS / POLL_MS + 60) { writeFileSync(w.file, JSON.stringify({ state: 'ready', url: engine.url, key: SECRET })); } };
  const outcome = await new StudioStart(p, new Map()).ensure(undefined, w.setting, w.folders);
  assert.equal(outcome.kind, 'ready', outcome.why);
  assert.ok(p.slept >= HANDOFF_WAIT_MS / POLL_MS + 60, `waited ${p.slept} seconds of the clock, past the deadline of a missing file`);
  assert.equal(p.said.length, 1);
});

test('asking: the person is waited for 10 minutes and no longer; then a warning, and the setting\'s engine is asked once (kind not-in-time)', async () => {
  const address = await service();
  const w = world([{ afterMs: 0, state: 'asking' }]);
  const p = ports(1);
  const sleep = p.sleep;
  p.sleep = async (ms) => { await untilExists(w.file); await sleep(ms); };
  const outcome = await new StudioStart(p, new Map()).ensure(address.url, w.setting, w.folders);
  assert.equal(ASKING_WAIT_MS, 600_000);
  assert.equal(outcome.kind, 'not-in-time', outcome.why);
  assert.equal(outcome.handoff, 'unanswered');
  assert.equal(toldToThePerson(outcome), true);
  assert.equal(outcome.engine, undefined);
  assert.match(outcome.why, /10 minutes/);
  assert.ok(p.slept >= ASKING_WAIT_MS / POLL_MS && p.slept <= ASKING_WAIT_MS / POLL_MS + 2, `slept ${p.slept}: the question is waited for 600 seconds of the clock from the first time it was seen`);
  assert.equal(p.said.length, 1);
});

test('asking: the file going away is not an answer - the studio removes it when a launch begins and writes nothing until its resident answers, so the wait goes on and the answer that follows is used', async () => {
  const dead = await service({ up: false }); // were the setting's engine taken instead, this address would not answer
  const engine = await service();
  const w = world([{ afterMs: 0, state: 'asking' }, { afterMs: 300, remove: true }, { afterMs: 700, state: 'ready', url: engine.url, key: SECRET }]);
  const p = ports(40);
  const outcome = await new StudioStart(p, new Map()).ensure(dead.url, w.setting, w.folders);
  assert.equal(outcome.kind, 'ready', outcome.why);
  assert.equal(outcome.handoff, 'ready');
  assert.equal(p.said.length, 1, 'the person is told once');
  assert.equal(w.launches().length, 1);
});

test('asking, then the file goes away: the no-file deadline of two minutes starts again from that moment, not from the launch', async () => {
  const engine = await service();
  const w = world([{ afterMs: 0, state: 'asking' }]);
  const p = ports(3);
  const sleep = p.sleep;
  p.sleep = async (ms) => {
    await sleep(ms);
    if (p.slept === 100) { rmSync(w.file, { force: true }); }
    if (p.slept === 100 + 300) { writeFileSync(w.file, JSON.stringify({ state: 'ready', url: engine.url, key: SECRET })); }
  };
  const outcome = await new StudioStart(p, new Map()).ensure(undefined, w.setting, w.folders);
  assert.equal(outcome.kind, 'ready', outcome.why);
  assert.ok(p.slept > HANDOFF_WAIT_MS / POLL_MS, `the answer came ${p.slept} seconds after the launch, more than the file wait, because the file had gone away at 100`);
  // and nothing after the removal ends the wait either
  const w2 = world([{ afterMs: 0, state: 'asking' }]);
  const q = ports(3);
  const sleep2 = q.sleep;
  q.sleep = async (ms) => { await sleep2(ms); if (q.slept === 100) { rmSync(w2.file, { force: true }); } };
  const second = await new StudioStart(q, new Map()).ensure(engine.url, w2.setting, w2.folders);
  assert.equal(second.handoff, 'late');
  assert.equal(q.slept, 100 + HANDOFF_WAIT_MS / POLL_MS, 'the file wait of the clock after the removal, then it is said');
});

test('a leftover asking answer from a studio that died is distrusted like a stale declined one: not shown to the person before its text changes or 3 seconds have passed', async () => {
  const engine = await service();
  const leftover = JSON.stringify({ state: 'asking', message: 'from a dead studio' });
  // the studio rewrites the file with its real answer: the leftover is never announced
  const busy = world([{ afterMs: 0, state: 'ready', url: engine.url, key: SECRET }]);
  writeFileSync(busy.file, leftover);
  const p = ports();
  p.sleep = async () => { p.slept++; await untilChanged(busy.file, leftover); };
  const outcome = await new StudioStart(p, new Map()).ensure(undefined, busy.setting, busy.folders);
  assert.equal(outcome.kind, 'ready', outcome.why);
  assert.deepEqual(p.said, [], 'the leftover was not announced');
  assert.equal(p.slept, 1);
  // the real studio removes the old file when the launch begins and writes its answer later: the leftover is never announced
  const removing = world([{ afterMs: 300, state: 'ready', url: engine.url, key: SECRET }], { removeOld: true });
  writeFileSync(removing.file, leftover);
  const r = ports(30);
  const rSleep = r.sleep;
  r.sleep = async (ms) => { await untilChanged(removing.file, leftover); await rSleep(ms); };
  const third = await new StudioStart(r, new Map()).ensure(undefined, removing.setting, removing.folders);
  assert.equal(third.kind, 'ready', third.why);
  assert.deepEqual(r.said, []);
  // nothing rewrites it: for the first 3 seconds nothing is said; then it is trusted, and the 10 minutes of the question run
  const quiet = world([]);
  writeFileSync(quiet.file, leftover);
  const q = ports(1);
  const saidAt = [];
  const sleep = q.sleep;
  q.sleep = async (ms) => { saidAt.push(q.said.length); await sleep(ms); };
  const second = await new StudioStart(q, new Map()).ensure(engine.url, quiet.setting, quiet.folders);
  assert.deepEqual(saidAt.slice(0, STALE_MS / POLL_MS), [0, 0, 0], 'nothing is said while the file is as it was before the launch');
  assert.equal(q.said.length, 1, 'trusted after the 3 seconds');
  assert.equal(second.handoff, 'unanswered');
});

test('none: the setting\'s engine that answers within the two minutes is used, without a warning', async () => {
  const late = await service({ up: false });
  const w = world([{ afterMs: 0, state: 'none', message: 'no jawata workspace here' }]);
  const p = ports(5);
  const sleep = p.sleep;
  let afterAnswer = 0;
  p.sleep = async (ms) => { await untilExists(w.file); await sleep(ms); if (++afterAnswer === 4) { await late.up(); } };
  const outcome = await new StudioStart(p, new Map()).ensure(late.url, w.setting, w.folders);
  assert.equal(outcome.handoff, 'none');
  assert.equal(outcome.kind, 'started', outcome.why);
  assert.equal(outcome.engine, undefined);
  assert.equal(toldToThePerson(outcome), false);
  assert.ok(p.slept >= 4 && p.slept < WAIT_MS / POLL_MS, `slept ${p.slept}: the engine of the setting came up after the studio had answered none`);
});

test('asking: a window that closes ends the wait', async () => {
  const w = world([{ afterMs: 0, state: 'asking' }]);
  const p = ports(5);
  const studio = new StudioStart(p, new Map());
  const sleep = p.sleep;
  p.sleep = async (ms) => { await sleep(ms); if (p.slept === 5) { studio.dispose(); } };
  const outcome = await studio.ensure(undefined, w.setting, w.folders);
  assert.equal(outcome.kind, 'not-in-time');
  assert.ok(p.slept < 20, `slept ${p.slept}`);
});

for (const state of ['declined', 'none']) {
  test(`${state}: the engine address of the agent setting is used as before, with a line that says why`, async () => {
    const engine = await service();
    const w = world([{ afterMs: 0, state, message: 'some words from the studio' }]);
    const outcome = await new StudioStart(ports(), new Map()).ensure(engine.url, w.setting, w.folders);
    assert.equal(outcome.handoff, state);
    assert.equal(outcome.kind, 'answers', outcome.why);
    assert.equal(outcome.engine, undefined, 'no engine of the studio is handed out');
    assert.match(outcome.why, state === 'declined' ? /declined/ : /no jawata workspace/);
    assert.match(outcome.why, /some words from the studio/);
    assert.equal(toldToThePerson(outcome), false);
  });
}

test('failed: a warning with the file\'s message, then the address of the setting as before; the key is kept out of the message', async () => {
  const engine = await service();
  const w = world([{ afterMs: 0, state: 'failed', key: SECRET, message: `could not start the resident (key ${SECRET} refused)` }]);
  const outcome = await new StudioStart(ports(), new Map()).ensure(engine.url, w.setting, w.folders);
  assert.equal(outcome.handoff, 'failed');
  assert.equal(toldToThePerson(outcome), true);
  assert.match(outcome.why, /could not start the resident/);
  assert.doesNotMatch(outcome.why, new RegExp(SECRET));
  assert.equal(outcome.kind, 'answers');
  assert.equal(outcome.engine, undefined);
});

test('no file within 330 seconds of the launch: said, a warning, and the setting\'s address is asked once, not waited for', async () => {
  const engine = await service();
  const w = world([]);
  const p = ports(1);
  const outcome = await new StudioStart(p, new Map()).ensure(engine.url, w.setting, w.folders);
  assert.equal(outcome.handoff, 'late');
  assert.equal(toldToThePerson(outcome), true);
  assert.match(outcome.why, /within 330 seconds/);
  assert.equal(HANDOFF_WAIT_MS, 330_000);
  assert.equal(p.slept, HANDOFF_WAIT_MS / POLL_MS, 'one sleep per second of the wait for the file');
  assert.equal(outcome.kind, 'answers');
  const down = await service({ up: false });
  const q = ports(1);
  const worse = await new StudioStart(q, new Map()).ensure(down.url, world([]).setting, ['/home/h/proj']);
  assert.equal(worse.kind, 'not-in-time');
  assert.equal(q.slept, HANDOFF_WAIT_MS / POLL_MS, 'the wait for the file, and not a second wait for the engine of the setting');
});

test('a stale ready answer for an address that does not answer is not used', async () => {
  const dead = await service({ up: false });
  const w = world([]);
  writeFileSync(w.file, JSON.stringify({ folders: w.folders, workspace: 'old', url: dead.url, key: SECRET, state: 'ready', message: '' }));
  const p = ports(1);
  const outcome = await new StudioStart(p, new Map()).ensure(undefined, w.setting, w.folders);
  assert.equal(outcome.engine, undefined);
  assert.equal(outcome.handoff, 'late');
  assert.equal(p.slept, HANDOFF_WAIT_MS / POLL_MS, 'it is looked at every second until the wait for the file is up');
});

test('a slow but healthy start: an answer 300 seconds after the launch is used, not reported late', async () => {
  const engine = await service();
  const w = world([]);
  const p = ports(1);
  const sleep = p.sleep;
  p.sleep = async (ms) => { await sleep(ms); if (p.slept === 300) { writeFileSync(w.file, JSON.stringify({ state: 'ready', url: engine.url, key: SECRET })); } };
  const outcome = await new StudioStart(p, new Map()).ensure(undefined, w.setting, w.folders);
  assert.equal(outcome.kind, 'ready', outcome.why);
  assert.equal(outcome.handoff, 'ready');
  assert.equal(toldToThePerson(outcome), false);
  assert.ok(p.slept >= 300 && p.slept <= 301, `slept ${p.slept}`);
});

test('a ready answer in the file whose address answers is used at once', async () => {
  const live = await service();
  const w = world([]);
  writeFileSync(w.file, JSON.stringify({ state: 'ready', url: live.url, key: SECRET }));
  const p = ports();
  const outcome = await new StudioStart(p, new Map()).ensure(undefined, w.setting, w.folders);
  assert.equal(outcome.kind, 'ready');
  assert.equal(p.slept, 0);
});

test('a declined, none or failed answer that was in the file before the launch is distrusted for 3 seconds, or until the file changes', async () => {
  const engine = await service();
  const stale = JSON.stringify({ state: 'declined', message: 'from an earlier run' });
  // nothing rewrites it: trusted when 3 seconds have passed
  const quiet = world([]);
  writeFileSync(quiet.file, stale);
  const p = ports(2);
  const outcome = await new StudioStart(p, new Map()).ensure(engine.url, quiet.setting, quiet.folders);
  assert.equal(outcome.handoff, 'declined');
  assert.equal(p.slept, STALE_MS / POLL_MS, 'looked at once a second, and trusted when the 3 seconds are up');
  // the studio rewrites it with a ready answer a moment after the launch: the change is seen at once
  const busy = world([{ afterMs: 0, state: 'ready', url: engine.url, key: SECRET }]);
  writeFileSync(busy.file, stale);
  const q = ports();
  q.sleep = async (ms) => { q.slept++; await untilChanged(busy.file, stale); };
  const second = await new StudioStart(q, new Map()).ensure(undefined, busy.setting, busy.folders);
  assert.equal(second.kind, 'ready');
  assert.equal(q.slept, 1, 'seen at the first look after the file changed, long before the 3 seconds');
  // a changed declined answer is trusted at once too
  const changed = world([{ afterMs: 0, state: 'declined', message: 'this run' }]);
  writeFileSync(changed.file, stale);
  const r = ports();
  r.sleep = async (ms) => { r.slept++; await untilChanged(changed.file, stale); };
  const third = await new StudioStart(r, new Map()).ensure(engine.url, changed.setting, changed.folders);
  assert.match(third.why, /this run/);
  assert.ok(r.slept <= 2, `slept ${r.slept}: seen when the file changed, long before the 3 seconds`);
});

test('a file that is not yet whole, or says a state that does not exist, is waited for, not obeyed', async () => {
  const engine = await service();
  const w = world([{ afterMs: 150, state: 'ready', url: engine.url, key: SECRET }]);
  writeFileSync(w.file, '{"state": "ready", "url": "http://');
  assert.equal((await new StudioStart(ports(), new Map()).ensure(undefined, w.setting, w.folders)).kind, 'ready');
  const w2 = world([{ afterMs: 150, state: 'ready', url: engine.url, key: SECRET }]);
  writeFileSync(w2.file, JSON.stringify({ state: 'maybe', url: engine.url, key: SECRET }));
  assert.equal((await new StudioStart(ports(), new Map()).ensure(undefined, w2.setting, w2.folders)).kind, 'ready');
});

test('the earlier shape of the setting, and a window with no folder, are looked after as before: the address is asked and no folder is passed', async () => {
  const engine = await service();
  const before = ports();
  before.start = async () => { throw new Error('must not be started'); };
  assert.equal((await new StudioStart(before, new Map()).ensure(engine.url, { command: 'studio', args: ['--background'] }, ['/home/h/proj'])).kind, 'answers');
  assert.equal((await new StudioStart(before, new Map()).ensure(engine.url, { command: 'studio', args: ['--background'], handoffDir: '/x' }, [])).kind, 'answers');
  const down = await service({ up: false });
  const p = ports();
  const started = [];
  p.start = async (command, args) => { started.push([command, args]); setTimeout(() => { void down.up(); }, 0); };
  assert.equal((await new StudioStart(p, new Map()).ensure(down.url, { command: 'studio', args: ['--background'] }, ['/home/h/proj'])).kind, 'started');
  assert.deepEqual(started, [['studio', ['--background']]], 'no --editor-folder without a handoffDir');
});

test('a handoffDir that is not an absolute folder is refused as it is, and nothing is started', async () => {
  const p = ports();
  p.start = async () => { throw new Error('must not be started'); };
  const outcome = await new StudioStart(p, new Map()).ensure(undefined, { command: 'studio', args: [], handoffDir: 'relative/dir' }, ['/home/h/proj']);
  assert.equal(outcome.kind, 'bad-studio-setting');
  assert.equal(toldToThePerson(outcome), true);
});

test('a studio that cannot be started with the folders is said so and nothing is waited for', async () => {
  const p = ports();
  p.start = async () => { throw new Error('spawn nope ENOENT'); };
  const outcome = await new StudioStart(p, new Map()).ensure(undefined, { command: '/opt/studio', args: ['--background'], handoffDir: tmpdir() }, ['/home/h/proj']);
  assert.equal(outcome.kind, 'start-failed');
  assert.match(outcome.why, /\/opt\/studio --background --editor-folder \/home\/h\/proj.*ENOENT/);
  assert.equal(p.slept, 0);
});

test('the two extensions of one window send one launch for the same folders, also when the second asks after the first is done', async () => {
  const engine = await service();
  const w = world([{ afterMs: 0, state: 'ready', url: engine.url, key: SECRET }]);
  const register = new Map();
  const starts = [];
  const counted = () => { const p = ports(); const start = p.start; p.start = async (command, args) => { starts.push(args); await start(command, args); }; return p; };
  const chat = new StudioStart(counted(), register);
  const java = new StudioStart(counted(), register);
  const [a, b] = await Promise.all([chat.ensure('http://127.0.0.1:1', w.setting, w.folders), java.ensure('http://127.0.0.1:1', w.setting, w.folders)]);
  assert.equal(a, b);
  assert.equal(w.launches().length, 1, 'one launch for two extensions');
  assert.equal(starts.length, 1, 'one launch for two extensions, counted where the studio is started');
  const late = await new StudioStart(counted(), register).ensure('http://127.0.0.1:1', w.setting, w.folders);
  assert.equal(late.kind, 'ready');
  assert.equal(starts.length, 1, 'still one launch when the second asks later, counted where the studio is started');
  await later(300);
  assert.equal(w.launches().length, 1, 'and the studio itself got one');
  // other folders are another launch
  const other = world([{ afterMs: 0, state: 'ready', url: engine.url, key: SECRET }], { folders: ['/home/h/other'] });
  assert.equal((await java.ensure(undefined, other.setting, other.folders)).kind, 'ready');
  assert.equal(other.launches().length, 1);
});

test('the window register is the one the extensions share, so two extensions that do not pass one still send one launch', async () => {
  const engine = await service();
  const w = world([{ afterMs: 0, state: 'ready', url: engine.url, key: SECRET }]);
  await Promise.all([new StudioStart(ports()).ensure(undefined, w.setting, w.folders), new StudioStart(ports()).ensure(undefined, w.setting, w.folders)]);
  assert.equal(w.launches().length, 1);
});

test('an engine that has stopped since the answer is not handed out again: the folders are handed to the studio anew, once', async () => {
  const engine = await service();
  const w = world([{ afterMs: 0, state: 'ready', url: engine.url, key: SECRET }]);
  const register = new Map();
  assert.equal((await new StudioStart(ports(), register).ensure(undefined, w.setting, w.folders)).kind, 'ready');
  await engine.down();
  const results = await Promise.all([new StudioStart(ports(), register).ensure(undefined, w.setting, w.folders), new StudioStart(ports(), register).ensure(undefined, w.setting, w.folders)]);
  assert.equal(w.launches().length, 2, 'one more launch, not two');
  assert.equal(results[0], results[1]);
});

test('the engine of the answer goes over JAWATA_URL and JAWATA_KEY of the launch and nothing else changes; the setting is not touched', () => {
  const setting = { command: 'java', args: ['--lsp'], env: { JAWATA_URL: 'http://127.0.0.1:1', JAWATA_KEY: 'old', OTHER: 'x' } };
  const launch = launchOf(setting, { url: 'http://127.0.0.1:2', key: SECRET });
  assert.deepEqual(launch.env, { JAWATA_URL: 'http://127.0.0.1:2', JAWATA_KEY: SECRET, OTHER: 'x' });
  assert.equal(setting.env.JAWATA_KEY, 'old', 'the setting\'s own object is left as it was');
  assert.deepEqual(launchOf(setting).env, setting.env, 'no engine: as before');
  assert.deepEqual(launchOf({ command: 'java', args: ['--lsp'] }, { url: 'u', key: 'k' }).env, { JAWATA_URL: 'u', JAWATA_KEY: 'k' });
  assert.deepEqual(withEngine({ A: '1' }, undefined), { A: '1' });
  assert.equal(withEngine(undefined, undefined), undefined);
});
