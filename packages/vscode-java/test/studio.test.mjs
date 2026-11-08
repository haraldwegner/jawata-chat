import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, existsSync, rmSync } from 'node:fs';
import http from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';

// the compiled module is CommonJS (the editor loads it so); npm test compiles it into out/ first
const { addressOf, nodePorts, POLL_MS, StudioStart, WAIT_MS, windowRegister } = createRequire(import.meta.url)('../out/studio.js');

const studio = { command: '/opt/jawata/studio', args: ['--no-window'] };
const services = [];

/** A server on a free local port that answers every request with `status`, or never answers; it is up only when `up` is true. */
async function service({ status = 200, silent = false, up = true } = {}) {
  const probe = http.createServer();
  await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
  const { port } = probe.address();
  await new Promise(resolve => probe.close(resolve));
  let server;
  const s = {
    address: `http://127.0.0.1:${port}`,
    async up() {
      server = http.createServer((_req, res) => { if (!silent) { res.statusCode = status; res.end('x'); } });
      await new Promise(resolve => server.listen(port, '127.0.0.1', resolve));
    },
    async down() {
      server?.closeAllConnections();
      await new Promise(resolve => server ? server.close(resolve) : resolve());
      server = undefined;
    },
  };
  services.push(s);
  if (up) { await s.up(); }
  return s;
}

/** Ports whose clock only moves when the code sleeps and whose command is a function; the probe is the real one against the fake service. */
function ports(overrides = {}) {
  let t = 0;
  const real = nodePorts((_text, job) => job(), 300);
  const made = {
    started: [], status: [], slept: 0,
    probe: real.probe,
    start: async (command, args) => { made.started.push([command, args]); },
    now: () => t,
    sleep: async (ms) => { t += ms; made.slept++; await new Promise(resolve => setImmediate(resolve)); },
    whileWaiting: (text, job) => { made.status.push(text); return job(); },
    ...overrides,
  };
  return made;
}

const later = (ms) => new Promise(resolve => setTimeout(resolve, ms));

afterEach(async () => { await Promise.all(services.splice(0).map(s => s.down())); windowRegister().clear(); });

test('the address is the JAWATA_URL of the server setting and nothing else', () => {
  assert.equal(addressOf({ env: { JAWATA_URL: ' http://127.0.0.1:7 ' } }), 'http://127.0.0.1:7');
  assert.equal(addressOf({ env: {} }), undefined);
  assert.equal(addressOf({ env: { JAWATA_URL: '  ' } }), undefined);
  assert.equal(addressOf(undefined), undefined);
});

test('any HTTP answer is an answer, a refusal and a service that says nothing are not', async () => {
  const probe = nodePorts((_t, job) => job(), 300).probe;
  for (const status of [200, 401, 404, 500]) { assert.equal(await probe((await service({ status })).address), true, String(status)); }
  assert.equal(await probe((await service({ up: false })).address), false, 'nothing listens');
  assert.equal(await probe((await service({ silent: true })).address), false, 'it accepts and says nothing');
});

test('a service that answers is left alone: the studio is not started and nothing is shown', async () => {
  const p = ports();
  const outcome = await new StudioStart(p, new Map()).ensure((await service({ status: 401 })).address, studio);
  assert.equal(outcome.kind, 'answers');
  assert.deepEqual(p.started, []);
  assert.deepEqual(p.status, []);
});

test('a service that does not answer: the studio setting is run as written, a status shown, and the start goes on when it answers', async () => {
  const s = await service({ up: false });
  const p = ports();
  p.start = async (command, args) => { p.started.push([command, args]); setTimeout(() => { void s.up(); }, 0); };
  p.sleep = async () => { p.slept++; await later(20); };
  const outcome = await new StudioStart(p, new Map()).ensure(s.address, studio);
  assert.equal(outcome.kind, 'started', outcome.why);
  assert.deepEqual(p.started, [['/opt/jawata/studio', ['--no-window']]]);
  assert.deepEqual(p.status, ['Starting the jawata studio…']);
});

test('the studio that never brings the service up is waited for two minutes on the clock, asked once a second, and then said so', async () => {
  const s = await service({ up: false });
  const p = ports();
  const outcome = await new StudioStart(p, new Map()).ensure(s.address, studio);
  assert.equal(outcome.kind, 'not-in-time');
  assert.match(outcome.why, /did not answer at .* within 120 seconds/);
  assert.equal(p.slept, WAIT_MS / POLL_MS, 'one sleep per second of the wait, so no loop without an end');
  assert.equal(p.started.length, 1, 'started once');
});

test('no studio setting: said exactly that, nothing is started and nothing waited for', async () => {
  const s = await service({ up: false });
  for (const setting of [undefined, {}]) {
    const p = ports();
    const outcome = await new StudioStart(p, new Map()).ensure(s.address, setting);
    assert.equal(outcome.kind, 'no-studio-setting');
    assert.match(outcome.why, /jawataJava\.studio is not set/);
    assert.deepEqual(p.started, []);
    assert.equal(p.slept, 0);
  }
});

test('a studio setting that is not a command with string arguments is refused as it is, not repaired', async () => {
  const s = await service({ up: false });
  for (const setting of [{ command: '  ', args: [] }, { args: ['x'] }, { command: 'studio', args: [1] }, { command: 'studio', args: 'x' }]) {
    const p = ports();
    const outcome = await new StudioStart(p, new Map()).ensure(s.address, setting);
    assert.equal(outcome.kind, 'bad-studio-setting', JSON.stringify(setting));
    assert.deepEqual(p.started, []);
  }
});

test('no address, or one that is not http, is said as such and nothing is probed or started', async () => {
  const p = ports({ probe: async () => { throw new Error('probed'); } });
  const none = await new StudioStart(p, new Map()).ensure(undefined, studio);
  assert.equal(none.kind, 'no-address');
  assert.match(none.why, /JAWATA_URL/);
  assert.equal((await new StudioStart(p, new Map()).ensure('127.0.0.1:9', studio)).kind, 'bad-address');
  assert.equal((await new StudioStart(p, new Map()).ensure('ftp://127.0.0.1:9', studio)).kind, 'bad-address');
  assert.deepEqual(p.started, []);
});

test('a command that cannot be started is said with the command and the reason, and nothing is waited for', async () => {
  const s = await service({ up: false });
  const p = ports({ start: async () => { throw new Error('spawn nope ENOENT'); } });
  const outcome = await new StudioStart(p, new Map()).ensure(s.address, studio);
  assert.equal(outcome.kind, 'start-failed');
  assert.match(outcome.why, /\/opt\/jawata\/studio --no-window.*ENOENT/);
  assert.equal(p.slept, 0);
});

test('a start under way is joined, not repeated; once it is over a new ask may start again', async () => {
  const s = await service({ up: false });
  const register = new Map();
  const p = ports();
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  p.start = async (command, args) => { p.started.push([command, args]); await gate; };
  p.sleep = async () => { p.slept++; await later(20); };
  const first = new StudioStart(p, register).ensure(s.address, studio);
  const second = new StudioStart(p, register).ensure(s.address, studio); // the chat extension of the same window, its own object
  await later(100);
  assert.equal(p.started.length, 1, 'one studio while one start is under way');
  setTimeout(() => { void s.up(); }, 0);
  release();
  const [a, b] = await Promise.all([first, second]);
  assert.equal(a, b, 'both are told the same outcome');
  assert.equal(a.kind, 'started');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(register.size, 0, 'the register is empty again when the start is over');
  await s.down();
  p.start = async (command, args) => { p.started.push([command, args]); setTimeout(() => { void s.up(); }, 0); };
  assert.equal((await new StudioStart(p, register).ensure(s.address, studio)).kind, 'started');
  assert.equal(p.started.length, 2);
});

test('the extensions of one window share one register by default', () => {
  assert.equal(windowRegister(), windowRegister());
});

test('the real start runs the command with its arguments detached and ignoring its streams, and a command that is not there is rejected', { skip: process.platform === 'win32' }, async () => {
  const dir = mkdtempSync(join(tmpdir(), 'jawata-studio-start-'));
  try {
    const marker = join(dir, 'ran.txt');
    // the program reports its own process id, its process group and where its standard streams lead
    await nodePorts((_t, job) => job()).start('sh', ['-c', 'printf "%s|%s|%s|%s" "$1" "$$" "$(ps -o pgid= -p $$ | tr -d " ")" "$(readlink /proc/$$/fd/0 /proc/$$/fd/1 /proc/$$/fd/2 2>/dev/null | tr "\\n" " ")" > "$0"', marker, 'a b']);
    const deadline = Date.now() + 10000;
    while (!existsSync(marker) && Date.now() < deadline) { await later(50); }
    const [argument, pid, group, streams] = readFileSync(marker, 'utf8').split('|');
    assert.equal(argument, 'a b');
    assert.equal(group, pid, 'detached: the program leads a process group of its own, so the editor closing does not take it along');
    if (process.platform === 'linux') { assert.equal(streams.trim(), '/dev/null /dev/null /dev/null', 'its standard streams are ignored'); }
    await assert.rejects(nodePorts((_t, job) => job()).start(join(dir, 'no-such-studio'), []), /ENOENT/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the studio setting is declared with a description that says the studio\'s deploy fills it in, and a workspace cannot set it', () => {
  const props = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).contributes.configuration.properties;
  const setting = props['jawataJava.studio'];
  assert.ok(setting, 'jawataJava.studio is declared');
  assert.match(setting.description, /deploy/);
  assert.equal(setting.scope, 'machine', 'a program to start must not come from a workspace');
  assert.deepEqual(Object.keys(setting.properties).sort(), ['args', 'command', 'handoffDir']);
  assert.equal(setting.properties.handoffDir.type, 'string');
  assert.match(setting.description, /handoffDir/);
});
