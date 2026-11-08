import * as assert from 'assert';
import * as vscode from 'vscode';
import * as fs from 'fs';
import * as http from 'http';
import * as os from 'os';
import * as path from 'path';
import { AgentProcesses } from '../host/AgentProcesses';
import { lookAfterStudio } from '../host/lookAfterStudio';
import { addressOf, ASKING_WAIT_MS, editorFoldersOf, HANDOFF_WAIT_MS, handoffId, launchArguments, nodePorts, POLL_MS, STALE_MS, StudioStart, toldToThePerson, WAIT_MS, windowRegister, type StudioOutcome, type StudioPorts, type StudioSetting } from '../studio';

/** A server on a free local port that answers every request with `status`, or never answers; `port` is where it is (or will be). */
class FakeService {
	private server: http.Server | undefined;
	constructor(readonly port: number, private readonly status = 200, private readonly silent = false) {}
	static async freePort(): Promise<number> {
		const probe = http.createServer();
		await new Promise<void>(resolve => probe.listen(0, '127.0.0.1', resolve));
		const { port } = probe.address() as { port: number };
		await new Promise<void>(resolve => probe.close(() => resolve()));
		return port;
	}
	get address(): string { return `http://127.0.0.1:${this.port}`; }
	async up(): Promise<void> {
		this.server = http.createServer((_req, res) => { if (!this.silent) { res.statusCode = this.status; res.end('x'); } });
		await new Promise<void>(resolve => this.server!.listen(this.port, '127.0.0.1', resolve));
	}
	async down(): Promise<void> {
		this.server?.closeAllConnections();
		await new Promise<void>(resolve => this.server ? this.server.close(() => resolve()) : resolve());
		this.server = undefined;
	}
}

type FakePorts = StudioPorts & { started: Array<[string, readonly string[]]>; status: string[]; slept: number };

/** Ports whose clock only moves when the code sleeps, whose command is a function, and whose probe is the real one against the fake service. */
function ports(overrides: Partial<StudioPorts> = {}): FakePorts {
	let t = 0;
	const real = nodePorts((_text, job) => job(), 300);
	const made: FakePorts = {
		started: [],
		status: [],
		slept: 0,
		probe: real.probe,
		start: async (command, args) => { made.started.push([command, args]); },
		now: () => t,
		sleep: async (ms) => { t += ms; made.slept++; await new Promise<void>(resolve => setImmediate(resolve)); },
		whileWaiting: (text, job) => { made.status.push(text); return job(); },
		readFile: real.readFile,
		say: () => undefined,
		...overrides,
	};
	return made;
}

const studio = { command: '/opt/jawata/studio', args: ['--no-window'] };

suite('The chat looks after the studio', () => {
	const services: FakeService[] = [];
	const service = async (status = 200, silent = false, up = true): Promise<FakeService> => {
		const s = new FakeService(await FakeService.freePort(), status, silent);
		services.push(s);
		if (up) { await s.up(); }
		return s;
	};
	teardown(async () => { await Promise.all(services.splice(0).map(s => s.down())); windowRegister().clear(); });

	test('the address is the JAWATA_URL of the agent setting and nothing else', () => {
		assert.strictEqual(addressOf({ env: { JAWATA_URL: ' http://127.0.0.1:7 ' } }), 'http://127.0.0.1:7');
		assert.strictEqual(addressOf({ env: {} }), undefined);
		assert.strictEqual(addressOf({ env: { JAWATA_URL: '  ' } }), undefined);
		assert.strictEqual(addressOf(undefined), undefined);
	});

	test('any HTTP answer is an answer, a refusal and a service that says nothing are not', async () => {
		const probe = nodePorts((_t, job) => job(), 300).probe;
		for (const status of [200, 401, 404, 500]) {
			assert.strictEqual(await probe((await service(status)).address), true, String(status));
		}
		assert.strictEqual(await probe((await service(200, false, false)).address), false, 'nothing listens');
		assert.strictEqual(await probe((await service(200, true)).address), false, 'it accepts and says nothing');
	});

	test('a service that answers is left alone: the studio is not started and nothing is shown', async () => {
		const p = ports();
		const outcome = await new StudioStart(p, new Map()).ensure((await service(401)).address, studio);
		assert.strictEqual(outcome.kind, 'answers');
		assert.deepStrictEqual(p.started, []);
		assert.deepStrictEqual(p.status, []);
	});

	test('a service that does not answer: the studio setting is run as written, a status shown, and the chat goes on when it answers', async () => {
		const s = await service(200, false, false);
		const p = ports();
		p.start = async (command, args) => { p.started.push([command, args]); setTimeout(() => { void s.up(); }, 0); };
		p.sleep = async () => { p.slept++; await new Promise<void>(resolve => setTimeout(resolve, 20)); };
		const outcome = await new StudioStart(p, new Map()).ensure(s.address, studio);
		assert.strictEqual(outcome.kind, 'started', outcome.why);
		assert.deepStrictEqual(p.started, [['/opt/jawata/studio', ['--no-window']]]);
		assert.deepStrictEqual(p.status, ['Starting the jawata studio…']);
	});

	test('the studio that never brings the service up is waited for two minutes on the clock, asked once a second, and then said so', async () => {
		const s = await service(200, false, false);
		const p = ports();
		const outcome = await new StudioStart(p, new Map()).ensure(s.address, studio);
		assert.strictEqual(outcome.kind, 'not-in-time');
		assert.match(outcome.why, /did not answer at .* within 120 seconds/);
		assert.strictEqual(p.slept, WAIT_MS / POLL_MS, 'one sleep per second of the wait, so no loop without an end');
		assert.strictEqual(p.started.length, 1, 'started once');
	});

	test('no studio setting: said exactly that, nothing is started and nothing waited for', async () => {
		const s = await service(200, false, false);
		for (const setting of [undefined, {}]) {
			const p = ports();
			const outcome = await new StudioStart(p, new Map()).ensure(s.address, setting);
			assert.strictEqual(outcome.kind, 'no-studio-setting');
			assert.match(outcome.why, /jawataChat\.studio is not set/);
			assert.deepStrictEqual(p.started, []);
			assert.strictEqual(p.slept, 0);
		}
	});

	test('a studio setting that is not a command with string arguments is refused as it is, not repaired', async () => {
		const s = await service(200, false, false);
		for (const setting of [{ command: '  ', args: [] }, { args: ['x'] }, { command: 'studio', args: [1] as unknown as string[] }, { command: 'studio', args: 'x' as unknown as string[] }]) {
			const p = ports();
			const outcome = await new StudioStart(p, new Map()).ensure(s.address, setting);
			assert.strictEqual(outcome.kind, 'bad-studio-setting', JSON.stringify(setting));
			assert.deepStrictEqual(p.started, []);
		}
	});

	test('no address, or one that is not http, is said as such and nothing is probed or started', async () => {
		const p = ports({ probe: async () => { throw new Error('probed'); } });
		const none = await new StudioStart(p, new Map()).ensure(undefined, studio);
		assert.strictEqual(none.kind, 'no-address');
		assert.match(none.why, /JAWATA_URL/);
		assert.strictEqual((await new StudioStart(p, new Map()).ensure('127.0.0.1:9', studio)).kind, 'bad-address');
		assert.strictEqual((await new StudioStart(p, new Map()).ensure('ftp://127.0.0.1:9', studio)).kind, 'bad-address');
		assert.deepStrictEqual(p.started, []);
	});

	test('a command that cannot be started is said with the command and the reason, and the chat does not wait', async () => {
		const s = await service(200, false, false);
		const p = ports({ start: async () => { throw new Error('spawn nope ENOENT'); } });
		const outcome = await new StudioStart(p, new Map()).ensure(s.address, studio);
		assert.strictEqual(outcome.kind, 'start-failed');
		assert.match(outcome.why, /\/opt\/jawata\/studio --no-window.*ENOENT/);
		assert.strictEqual(p.slept, 0);
	});

	test('a start under way is joined, not repeated; once it is over a new ask may start again', async () => {
		const s = await service(200, false, false);
		const register = new Map<string, Promise<StudioOutcome>>();
		const p = ports();
		let release!: () => void;
		const gate = new Promise<void>(resolve => { release = resolve; });
		p.start = async (command, args) => { p.started.push([command, args]); await gate; };
		p.sleep = async () => { p.slept++; await new Promise<void>(resolve => setTimeout(resolve, 20)); };
		const first = new StudioStart(p, register).ensure(s.address, studio);
		const second = new StudioStart(p, register).ensure(s.address, studio); // another extension of the window, its own object
		await new Promise<void>(resolve => setTimeout(resolve, 100));
		assert.strictEqual(p.started.length, 1, 'one studio while one start is under way');
		setTimeout(() => { void s.up(); }, 0);
		release();
		const [a, b] = await Promise.all([first, second]);
		assert.strictEqual(a, b, 'both are told the same outcome');
		assert.strictEqual(a.kind, 'started');
		await new Promise<void>(resolve => setImmediate(resolve));
		assert.strictEqual(register.size, 0, 'the register is empty again when the start is over');
		await s.down();
		p.start = async (command, args) => { p.started.push([command, args]); setTimeout(() => { void s.up(); }, 0); };
		assert.strictEqual((await new StudioStart(p, register).ensure(s.address, studio)).kind, 'started');
		assert.strictEqual(p.started.length, 2);
	});

	test('the extensions of one window share one register by default', () => {
		assert.strictEqual(windowRegister(), windowRegister());
	});

	test('the real start runs the command with its arguments detached and ignoring its streams, and a command that is not there is rejected', async function () {
		if (process.platform === 'win32') { this.skip(); } // the fake command is a POSIX shell line; the editor's own binary must not be used as a stand-in
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jawata-studio-start-'));
		try {
			const marker = path.join(dir, 'ran.txt');
			const real = nodePorts((_t, job) => job());
			// the program reports its own process id, its process group and where its standard streams lead
			await real.start('sh', ['-c', 'printf "%s|%s|%s|%s" "$1" "$$" "$(ps -o pgid= -p $$ | tr -d " ")" "$(readlink /proc/$$/fd/0 /proc/$$/fd/1 /proc/$$/fd/2 2>/dev/null | tr "\\n" " ")" > "$0"', marker, 'a b']);
			const deadline = Date.now() + 10000;
			while (!fs.existsSync(marker) && Date.now() < deadline) { await new Promise<void>(resolve => setTimeout(resolve, 50)); }
			const [argument, pid, group, streams] = fs.readFileSync(marker, 'utf8').split('|');
			assert.strictEqual(argument, 'a b');
			assert.strictEqual(group, pid, 'detached: the program leads a process group of its own, so the editor closing does not take it along');
			if (process.platform === 'linux') { assert.strictEqual(streams.trim(), '/dev/null /dev/null /dev/null', 'its standard streams are ignored'); }
			await assert.rejects(real.start(path.join(dir, 'no-such-studio'), []), /ENOENT/);
		} finally {
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});

	test('both studio settings are declared with a description that says the studio\'s deploy fills them in, and a workspace cannot set them', () => {
		const packages = path.join(__dirname, '..', '..', '..');
		for (const [pkg, key] of [['vscode', 'jawataChat.studio'], ['vscode-java', 'jawataJava.studio']]) {
			const props = JSON.parse(fs.readFileSync(path.join(packages, pkg, 'package.json'), 'utf8')).contributes.configuration.properties;
			const setting = props[key];
			assert.ok(setting, `${key} is declared`);
			assert.match(setting.description, /deploy/);
			assert.strictEqual(setting.scope, 'machine', 'a program to start must not come from a workspace');
			assert.deepStrictEqual(Object.keys(setting.properties).sort(), ['args', 'command', 'handoffDir']);
			assert.strictEqual(setting.properties.handoffDir.type, 'string');
			assert.match(setting.description, /handoffDir/);
		}
	});
});

suite('The editor settings and the first agent start', () => {
	const config = () => vscode.workspace.getConfiguration('jawataChat');
	const saved = new Map<string, unknown>();
	/** Writes a user setting for the test and remembers what the person had, so teardown puts it back as it was. */
	const set = async (key: string, value: unknown): Promise<void> => {
		if (!saved.has(key)) { saved.set(key, config().inspect(key)?.globalValue); }
		await config().update(key, value, vscode.ConfigurationTarget.Global);
	};
	teardown(async () => {
		for (const [key, value] of saved) { await config().update(key, value, vscode.ConfigurationTarget.Global); }
		saved.clear();
		windowRegister().clear();
	});

	test('the address comes from the agent setting\'s env and the command from jawataChat.studio, as the editor holds them', async () => {
		const service = new FakeService(await FakeService.freePort());
		const agent = config().get<Record<string, unknown>>('agent') ?? {};
		await set('agent', { ...agent, env: { JAWATA_URL: service.address } });
		await set('studio', { command: 'the-studio', args: ['--no-window'] });
		const p = ports();
		p.start = async (command, args) => { p.started.push([command, args]); await service.up(); };
		try {
			const outcome = await lookAfterStudio(new StudioStart(p, new Map()));
			assert.strictEqual(outcome.kind, 'started', outcome.why);
			assert.deepStrictEqual(p.started, [['the-studio', ['--no-window']]]);
		} finally {
			await service.down();
		}
	});

	test('with no address in the agent setting nothing is looked for', async () => {
		const agent = config().get<Record<string, unknown>>('agent') ?? {};
		await set('agent', { ...agent, env: {} });
		await set('studio', { command: 'the-studio' });
		const p = ports();
		assert.strictEqual((await lookAfterStudio(new StudioStart(p, new Map()))).kind, 'no-address');
		assert.deepStrictEqual(p.started, []);
	});

	test('the first agent start waits for the studio that is being brought up, and a start that failed does not hold it', async () => {
		const agents = new AgentProcesses();
		let readyAtOnce = false;
		void agents.ready().then(() => { readyAtOnce = true; });
		await new Promise<void>(resolve => setImmediate(resolve));
		assert.strictEqual(readyAtOnce, true, 'with nothing held it is ready at once');
		let release!: () => void;
		agents.holdUntil(new Promise<void>(resolve => { release = resolve; }));
		let waited = true;
		const waiting = agents.ready().then(() => { waited = false; });
		await new Promise<void>(resolve => setTimeout(resolve, 30));
		assert.strictEqual(waited, true, 'held while the studio is starting');
		release();
		await waiting;
		agents.holdUntil(Promise.reject(new Error('studio start blew up')));
		await agents.ready();
		agents.dispose();
	});
});

// Sprint 28h stage 21 (j): the folders the window has open decide which jawata workspace runs.
const fakeStudio = path.join(__dirname, '..', '..', '..', 'vscode-java', 'test', 'support', 'fake-studio.cjs');
const SECRET = 'KEY-chat-5d0e-do-not-log';

suite('The chat hands the window\'s folders to the studio', () => {
	const cleanups: Array<() => Promise<void> | void> = [];
	teardown(async () => { windowRegister().clear(); for (const c of cleanups.splice(0)) { await c(); } });
	const later = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms));

	const engine = async (): Promise<FakeService> => {
		const s = new FakeService(await FakeService.freePort());
		await s.up();
		cleanups.push(() => s.down());
		return s;
	};

	/** A handoff folder, the studio setting that starts the fake studio with `steps`, and what the fake studio recorded. */
	const world = (steps: object[], folders = ['/home/h/proj'], removeOld = false) => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jawata-handoff-'));
		cleanups.push(() => fs.rmSync(dir, { recursive: true, force: true }));
		const setting: StudioSetting = { command: process.execPath, args: [fakeStudio, '--config', JSON.stringify({ dir, steps, removeOld })], handoffDir: dir };
		const file = path.join(dir, `${handoffId(folders)}.json`);
		const launches = (): Array<{ argv: string[]; folders: string[]; id: string }> => fs.existsSync(path.join(dir, 'launches.jsonl'))
			? fs.readFileSync(path.join(dir, 'launches.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];
		return { dir, setting, file, folders, launches };
	};

	/** Real process start, file read and probe; the clock moves by what is slept (`pace` real milliseconds a second of it). */
	const real = (pace = 15, overrides: Partial<StudioPorts> = {}) => {
		let t = 0;
		const base = nodePorts((_text, job) => job(), 300);
		const made = {
			said: [] as string[], status: [] as string[], slept: 0,
			...base,
			now: () => t,
			sleep: async (ms: number) => { t += ms; made.slept++; await later(pace); },
			whileWaiting: <T>(text: string, job: () => Promise<T>) => { made.status.push(text); return job(); },
			say: (text: string) => { made.said.push(text); },
			...overrides,
		};
		return made;
	};

	test('the file name is the SHA-256 of the sorted folders joined with a newline, the arguments carry each folder, the folders are real paths', () => {
		assert.strictEqual(handoffId(['/a/b', '/c']), '5650d16fbb762aa37a51dc25636e82d35230e7da6a6d5e77c31dd3b4007de4be');
		assert.strictEqual(handoffId(['/home/h/proj']), '1e7edaca38dbb9d07c23cc7e5f5de48c9460cf7c53bee8eb926d3dd184ee2209');
		assert.strictEqual(handoffId(['/c', '/a/b']), handoffId(['/a/b', '/c']));
		assert.deepStrictEqual(launchArguments(['--background'], ['/home/h/proj']), ['--background', '--editor-folder', '/home/h/proj']);
		assert.deepStrictEqual(launchArguments(['--background'], ['/a/b', '/c']), ['--background', '--editor-folder', '/a/b', '--editor-folder', '/c']);
		assert.deepStrictEqual(editorFoldersOf(['/link/a', '/gone', '/real/a', ''], f => { if (f === '/gone') { throw new Error('ENOENT'); } return f.replace('/link', '/real'); }), ['/real/a', '/gone']);
	});

	test('ready: started with the folders also when the service answers, the answer is used, the key is in no sentence', async () => {
		const service = await engine();
		const w = world([{ afterMs: 0, state: 'ready', url: service.address, key: SECRET, workspace: 'proj' }]);
		const p = real();
		const outcome = await new StudioStart(p, new Map()).ensure(service.address, w.setting, w.folders);
		assert.strictEqual(outcome.kind, 'ready', outcome.why);
		assert.deepStrictEqual(outcome.engine, { url: service.address, key: SECRET });
		assert.strictEqual(w.launches().length, 1);
		assert.deepStrictEqual(w.launches()[0].argv.slice(2), ['--editor-folder', '/home/h/proj']);
		assert.ok(!JSON.stringify([outcome.why, p.status, p.said]).includes(SECRET));
		assert.strictEqual(toldToThePerson(outcome), false);
	});

	const untilChanged = async (file: string, text: string): Promise<void> => {
		const end = Date.now() + 10000;
		while (fs.existsSync(file) && fs.readFileSync(file, 'utf8') === text && Date.now() < end) { await later(5); }
	};
	const untilExists = async (file: string): Promise<void> => {
		const end = Date.now() + 10000;
		while (!fs.existsSync(file) && Date.now() < end) { await later(5); }
	};

	test('asking: one status message; the person is waited for 10 minutes and no longer, then a warning (not-in-time) and the setting\'s engine', async () => {
		const service = await engine();
		const w = world([{ afterMs: 0, state: 'asking' }]);
		const p = real(1);
		const sleep = p.sleep;
		p.sleep = async ms => { await untilExists(w.file); await sleep(ms); };
		const outcome = await new StudioStart(p, new Map()).ensure(service.address, w.setting, w.folders);
		assert.strictEqual(ASKING_WAIT_MS, 600_000);
		assert.strictEqual(outcome.kind, 'not-in-time', outcome.why);
		assert.strictEqual(outcome.handoff, 'unanswered');
		assert.strictEqual(toldToThePerson(outcome), true);
		assert.ok(p.slept >= ASKING_WAIT_MS / POLL_MS && p.slept <= ASKING_WAIT_MS / POLL_MS + 2, `slept ${p.slept}`);
		assert.strictEqual(p.said.length, 1);
		assert.match(p.said[0], /asking/);
	});

	test('asking, the file goes away, the answer follows: the setting\'s engine is not taken in between', async () => {
		const dead = new FakeService(await FakeService.freePort());
		const service = await engine();
		const w = world([{ afterMs: 0, state: 'asking' }, { afterMs: 300, remove: true }, { afterMs: 700, state: 'ready', url: service.address, key: SECRET }]);
		const outcome = await new StudioStart(real(40), new Map()).ensure(dead.address, w.setting, w.folders);
		assert.strictEqual(outcome.kind, 'ready', outcome.why);
	});

	test('asking, the file goes away: the two minutes for a missing file start again from that moment', async () => {
		const service = await engine();
		const w = world([{ afterMs: 0, state: 'asking' }]);
		const p = real(3);
		const sleep = p.sleep;
		p.sleep = async ms => {
			await sleep(ms);
			if (p.slept === 100) { fs.rmSync(w.file, { force: true }); }
			if (p.slept === 100 + 300) { fs.writeFileSync(w.file, JSON.stringify({ state: 'ready', url: service.address, key: SECRET })); }
		};
		const outcome = await new StudioStart(p, new Map()).ensure(undefined, w.setting, w.folders);
		assert.strictEqual(outcome.kind, 'ready', outcome.why);
		assert.ok(p.slept > HANDOFF_WAIT_MS / POLL_MS);
	});

	test('a leftover asking answer from a dead studio is distrusted like a stale declined one: never announced before its text changes or 3 seconds pass', async () => {
		const service = await engine();
		const leftover = JSON.stringify({ state: 'asking', message: 'from a dead studio' });
		const busy = world([{ afterMs: 0, state: 'ready', url: service.address, key: SECRET }]);
		fs.writeFileSync(busy.file, leftover);
		const p = real();
		p.sleep = async () => { p.slept++; await untilChanged(busy.file, leftover); };
		assert.strictEqual((await new StudioStart(p, new Map()).ensure(undefined, busy.setting, busy.folders)).kind, 'ready');
		assert.deepStrictEqual(p.said, []);
		const removing = world([{ afterMs: 300, state: 'ready', url: service.address, key: SECRET }], ['/home/h/proj'], true);
		fs.writeFileSync(removing.file, leftover);
		const r = real(30);
		const rSleep = r.sleep;
		r.sleep = async ms => { await untilChanged(removing.file, leftover); await rSleep(ms); };
		assert.strictEqual((await new StudioStart(r, new Map()).ensure(undefined, removing.setting, removing.folders)).kind, 'ready');
		assert.deepStrictEqual(r.said, []);
		const quiet = world([]);
		fs.writeFileSync(quiet.file, leftover);
		const q = real(1);
		const saidAt: number[] = [];
		const qSleep = q.sleep;
		q.sleep = async ms => { saidAt.push(q.said.length); await qSleep(ms); };
		const second = await new StudioStart(q, new Map()).ensure(service.address, quiet.setting, quiet.folders);
		assert.deepStrictEqual(saidAt.slice(0, STALE_MS / POLL_MS), [0, 0, 0]);
		assert.strictEqual(q.said.length, 1);
		assert.strictEqual(second.handoff, 'unanswered');
	});

	test('none: the setting\'s engine that answers within the two minutes is used, without a warning', async () => {
		const late = new FakeService(await FakeService.freePort());
		cleanups.push(() => late.down());
		const w = world([{ afterMs: 0, state: 'none', message: 'no jawata workspace here' }]);
		const p = real(5);
		const sleep = p.sleep;
		let afterAnswer = 0;
		p.sleep = async ms => { await untilExists(w.file); await sleep(ms); if (++afterAnswer === 4) { await late.up(); } };
		const outcome = await new StudioStart(p, new Map()).ensure(late.address, w.setting, w.folders);
		assert.strictEqual(outcome.handoff, 'none');
		assert.strictEqual(outcome.kind, 'started', outcome.why);
		assert.strictEqual(toldToThePerson(outcome), false);
		assert.ok(p.slept >= 4 && p.slept < WAIT_MS / POLL_MS);
	});

	test('asking and then ready: the answer is used', async () => {
		const service = await engine();
		const w = world([{ afterMs: 0, state: 'asking' }, { afterMs: 400, state: 'ready', url: service.address, key: SECRET }]);
		const outcome = await new StudioStart(real(30), new Map()).ensure(undefined, w.setting, w.folders);
		assert.strictEqual(outcome.kind, 'ready', outcome.why);
	});

	for (const state of ['declined', 'none']) {
		test(`${state}: the engine address of the setting is used as before, with the reason`, async () => {
			const service = await engine();
			const w = world([{ afterMs: 0, state, message: 'words from the studio' }]);
			const outcome = await new StudioStart(real(), new Map()).ensure(service.address, w.setting, w.folders);
			assert.strictEqual(outcome.handoff, state);
			assert.strictEqual(outcome.kind, 'answers', outcome.why);
			assert.strictEqual(outcome.engine, undefined);
			assert.match(outcome.why, /words from the studio/);
			assert.strictEqual(toldToThePerson(outcome), false);
		});
	}

	test('failed: a warning with the message, without the key; then as before', async () => {
		const service = await engine();
		const w = world([{ afterMs: 0, state: 'failed', key: SECRET, message: `no resident (${SECRET})` }]);
		const outcome = await new StudioStart(real(), new Map()).ensure(service.address, w.setting, w.folders);
		assert.strictEqual(outcome.handoff, 'failed');
		assert.strictEqual(toldToThePerson(outcome), true);
		assert.match(outcome.why, /no resident/);
		assert.ok(!outcome.why.includes(SECRET));
	});

	test('a slow but healthy start: an answer 300 seconds after the launch is used, not reported late', async () => {
		const service = await engine();
		const w = world([]);
		const p = real(1);
		const sleep = p.sleep;
		p.sleep = async ms => { await sleep(ms); if (p.slept === 300) { fs.writeFileSync(w.file, JSON.stringify({ state: 'ready', url: service.address, key: SECRET })); } };
		const outcome = await new StudioStart(p, new Map()).ensure(undefined, w.setting, w.folders);
		assert.strictEqual(outcome.kind, 'ready', outcome.why);
		assert.strictEqual(toldToThePerson(outcome), false);
	});

	test('no file in 330 seconds: said as a warning and the setting\'s address asked once', async () => {
		const service = await engine();
		const w = world([]);
		const p = real(1);
		const outcome = await new StudioStart(p, new Map()).ensure(service.address, w.setting, w.folders);
		assert.strictEqual(outcome.handoff, 'late');
		assert.strictEqual(toldToThePerson(outcome), true);
		assert.strictEqual(HANDOFF_WAIT_MS, 330_000);
		assert.strictEqual(p.slept, HANDOFF_WAIT_MS / POLL_MS);
	});

	test('a stale ready file whose address does not answer is not used; a stale declined one is trusted after 3 seconds', async () => {
		const dead = new FakeService(await FakeService.freePort());
		const w = world([]);
		fs.writeFileSync(w.file, JSON.stringify({ state: 'ready', url: dead.address, key: SECRET }));
		const p = real(1);
		const outcome = await new StudioStart(p, new Map()).ensure(undefined, w.setting, w.folders);
		assert.strictEqual(outcome.engine, undefined);
		assert.strictEqual(outcome.handoff, 'late');
		const service = await engine();
		const quiet = world([]);
		fs.writeFileSync(quiet.file, JSON.stringify({ state: 'declined', message: 'earlier run' }));
		const q = real(2);
		const second = await new StudioStart(q, new Map()).ensure(service.address, quiet.setting, quiet.folders);
		assert.strictEqual(second.handoff, 'declined');
		assert.strictEqual(q.slept, STALE_MS / POLL_MS);
	});

	test('the two extensions of one window send one launch, also when the second asks after the first is done', async () => {
		const service = await engine();
		const w = world([{ afterMs: 0, state: 'ready', url: service.address, key: SECRET }]);
		const register = new Map<string, Promise<StudioOutcome>>();
		const [a, b] = await Promise.all([
			new StudioStart(real(), register).ensure(undefined, w.setting, w.folders),
			new StudioStart(real(), register).ensure(undefined, w.setting, w.folders),
		]);
		assert.strictEqual(a, b);
		assert.strictEqual((await new StudioStart(real(), register).ensure(undefined, w.setting, w.folders)).kind, 'ready');
		assert.strictEqual(w.launches().length, 1);
	});

	test('without a handoffDir or without folders the address is asked and no folder is passed', async () => {
		const service = await engine();
		const p = real();
		p.start = async () => { throw new Error('must not be started'); };
		assert.strictEqual((await new StudioStart(p, new Map()).ensure(service.address, { command: 'studio', args: ['--background'] }, ['/home/h/proj'])).kind, 'answers');
		assert.strictEqual((await new StudioStart(p, new Map()).ensure(service.address, { command: 'studio', args: ['--background'], handoffDir: '/x' }, [])).kind, 'answers');
	});

	test('the engine of the answer reaches the agent\'s environment, over the setting\'s, and the key is in no log line', async function () {
		if (process.platform === 'win32') { this.skip(); }
		const service = await engine();
		const w = world([{ afterMs: 0, state: 'ready', url: service.address, key: SECRET, workspace: 'proj' }]);
		const config = vscode.workspace.getConfiguration('jawataChat');
		const savedAgent = config.inspect('agent')?.globalValue;
		const savedStudio = config.inspect('studio')?.globalValue;
		cleanups.push(async () => { await config.update('agent', savedAgent, vscode.ConfigurationTarget.Global); await config.update('studio', savedStudio, vscode.ConfigurationTarget.Global); });
		const out = path.join(w.dir, 'agent-env.json');
		const agent = {
			command: process.execPath,
			args: ['-e', 'require("fs").writeFileSync(process.argv[1], JSON.stringify([process.env.JAWATA_URL, process.env.JAWATA_KEY, process.env.OTHER]))', out],
			env: { JAWATA_URL: 'http://127.0.0.1:1', JAWATA_KEY: 'the-key-in-the-setting', OTHER: 'kept' },
		};
		await config.update('agent', agent, vscode.ConfigurationTarget.Global);
		await config.update('studio', w.setting, vscode.ConfigurationTarget.Global);
		const lines: string[] = [];
		const agents = new AgentProcesses();
		try {
			agents.holdUntil(lookAfterStudio(new StudioStart(real(), new Map()), w.folders, line => { lines.push(line); }));
			await agents.ready();
			agents.spawnAgent('agent', agent);
			const deadline = Date.now() + 15000;
			while (!fs.existsSync(out) && Date.now() < deadline) { await later(50); }
			assert.deepStrictEqual(JSON.parse(fs.readFileSync(out, 'utf8')), [service.address, SECRET, 'kept']);
			assert.deepStrictEqual(lines.map(l => l.split(':')[1].trim()), ['ready']);
			assert.ok(!lines.join('\n').includes(SECRET));
			assert.strictEqual((vscode.workspace.getConfiguration('jawataChat').get<{ env: Record<string, string> }>('agent'))?.env.JAWATA_KEY, 'the-key-in-the-setting', 'the setting is not written to');
		} finally {
			agents.dispose();
		}
	});

	test('with no engine from the studio the agent has the setting\'s environment as before', async function () {
		if (process.platform === 'win32') { this.skip(); }
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jawata-agent-env-'));
		cleanups.push(() => fs.rmSync(dir, { recursive: true, force: true }));
		const out = path.join(dir, 'env.json');
		const agent = { command: process.execPath, args: ['-e', 'require("fs").writeFileSync(process.argv[1], JSON.stringify([process.env.JAWATA_URL, process.env.JAWATA_KEY]))', out], env: { JAWATA_URL: 'http://127.0.0.1:1', JAWATA_KEY: 'plain' } };
		const agents = new AgentProcesses();
		try {
			agents.holdUntil(Promise.resolve({ kind: 'declined' as never, why: 'x' }));
			await agents.ready();
			agents.spawnAgent('agent', agent);
			const deadline = Date.now() + 15000;
			while (!fs.existsSync(out) && Date.now() < deadline) { await later(50); }
			assert.deepStrictEqual(JSON.parse(fs.readFileSync(out, 'utf8')), ['http://127.0.0.1:1', 'plain']);
		} finally {
			agents.dispose();
		}
	});
});
