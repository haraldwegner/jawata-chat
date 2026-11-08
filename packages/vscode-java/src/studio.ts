import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { promises as fsp, realpathSync } from 'node:fs';
import * as http from 'node:http';
import * as https from 'node:https';
import * as path from 'node:path';

/**
 * Starting the jawata studio when the engine's service does not answer (Sprint 28h, stage 21 (d)).
 *
 * The language server's launcher is a pipe to the engine's service, which the studio keeps running. At activation jawata Java asks the address the deploy wrote
 * into `jawataJava.server` (env `JAWATA_URL`) whether anything answers. If something does, nothing else happens. If not, the studio is
 * started from `jawataJava.studio` (command and args, also written by the deploy), detached so it outlives the editor, and the address is
 * asked again until it answers or the time is up. Every way this can not work is told by its own sentence; nothing is guessed and nothing
 * is tried twice.
 *
 * The folders the window has open decide which jawata workspace runs (stage 21 (j)). When the window has workspace folders and the
 * studio setting carries `handoffDir`, the studio is started with `--editor-folder <folder>` for each folder, every time and whether
 * or not the service answers (a running studio receives the arguments in its single-instance callback). The studio answers in
 * `<handoffDir>/<id>.json` (see {@link handoffId}); the answer's address and key are used by this window's agent and Java server
 * and by nothing else: they are never written to a setting, a log line or a message.
 *
 * Not tied to the editor: the HTTP probe, the process start, the clock, the file read and the status line are ports, so a test supplies its own.
 */

/** The `jawataJava.studio` setting as the deploy writes it. */
export interface StudioSetting {
  command?: string;
  args?: string[];
  /** An absolute folder the studio writes its answer for a window's folders into. Absent in the earlier shape of the setting. */
  handoffDir?: string;
}

/** The address and key of the engine's service the studio found or made for this window's folders. The key is a secret: it goes into the environment of a program and nowhere else. */
export interface EngineAnswer {
  readonly url: string;
  readonly key: string;
}

/** What came of looking after the studio. `why` is a sentence for the log and for the person; it never holds the engine's key or address. */
export interface StudioOutcome {
  readonly kind: 'answers' | 'started' | 'ready' | 'no-address' | 'bad-address' | 'no-studio-setting' | 'bad-studio-setting' | 'start-failed' | 'not-in-time';
  readonly why: string;
  /** Set when the studio answered `ready`: the address and key this window's agent and Java server use instead of the settings'. */
  readonly engine?: EngineAnswer;
  /** What the studio's answer file said, when this window's folders were handed to it (`late`: no answer came in time, `gone`: the file went away while the studio was asking). */
  readonly handoff?: HandoffState | 'late' | 'unanswered';
  /** The person is told this outcome besides the log. */
  readonly warn?: boolean;
}

/** What the work needs from outside; the defaults are in {@link nodePorts}. */
export interface StudioPorts {
  /** Whether anything answers an HTTP request to the address: any status counts, a refusal or a timeout does not. */
  probe(baseUrl: string): Promise<boolean>;
  /** Starts the program detached from this process, its standard streams ignored; settles once it is started, rejects if it cannot be. */
  start(command: string, args: readonly string[]): Promise<void>;
  now(): number;
  sleep(ms: number): Promise<void>;
  /** Shows the person a status while `job` runs. */
  whileWaiting<T>(text: string, job: () => Promise<T>): Promise<T>;
  /** The text of a file, or undefined when there is no such file (or it cannot be read). */
  readFile(file: string): Promise<string | undefined>;
  /** Tells the person something once and does not wait for them. */
  say(text: string): void;
}

/**
 * How long the studio is given to bring the service up.
 * @public read by the tests
 */
export const WAIT_MS = 120_000;
/**
 * How long the studio is given to write its answer for a window's folders (and again, from the moment the file goes away). The studio gives
 * its own resident 300 seconds to answer, so a start that is slow but healthy is not reported late; this is longer than {@link WAIT_MS}, which is the
 * wait for the engine address of the setting.
 * @public read by the tests
 */
export const HANDOFF_WAIT_MS = 330_000;
/**
 * How often the address is asked while the studio comes up.
 * @public read by the tests
 */
export const POLL_MS = 1_000;

/** The `JAWATA_URL` of the agent setting, trimmed; undefined when there is none. */
export function addressOf(agent: { env?: Record<string, string> } | undefined): string | undefined {
  const value = agent?.env?.JAWATA_URL;
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined;
}

type Failed<K extends StudioOutcome['kind']> = { readonly ok: false; readonly outcome: { readonly kind: K; readonly why: string } };
type Resolved<T, K extends StudioOutcome['kind']> = { readonly ok: true; readonly value: T } | Failed<K>;

function studioOf(setting: StudioSetting | undefined): Resolved<{ command: string; args: string[] }, 'no-studio-setting' | 'bad-studio-setting'> {
  if (setting === undefined || setting === null || (setting.command === undefined && setting.args === undefined)) {
    return { ok: false, outcome: { kind: 'no-studio-setting', why: 'jawataJava.studio is not set, so the jawata studio is not started. The studio\'s deploy fills it in; deploy to VS Code from the studio, or start the studio yourself.' } };
  }
  const command = typeof setting.command === 'string' ? setting.command.trim() : '';
  const args = setting.args ?? [];
  if (command === '' || !Array.isArray(args) || args.some(a => typeof a !== 'string')) {
    return { ok: false, outcome: { kind: 'bad-studio-setting', why: 'jawataJava.studio needs a command (a program) and args (a list of strings); it is not started.' } };
  }
  return { ok: true, value: { command, args } };
}

function addressUrl(address: string): Resolved<string, 'bad-address'> {
  try {
    const url = new URL(address);
    if (url.protocol === 'http:' || url.protocol === 'https:') { return { ok: true, value: address }; }
  } catch { /* said below */ }
  return { ok: false, outcome: { kind: 'bad-address', why: `The engine address "${address}" (JAWATA_URL in jawataJava.server) is not an http or https address, so nothing is probed and the studio is not started.` } };
}

/** What the studio says in its answer file about this window's folders. */
export type HandoffState = 'ready' | 'asking' | 'declined' | 'none' | 'failed';

const HANDOFF_STATES: readonly string[] = ['ready', 'asking', 'declined', 'none', 'failed'];

/**
 * How long a `declined`, `none` or `failed` answer that was already in the file before the studio was started is distrusted: it may be the
 * answer to an earlier run. It is trusted when the file changes or this long has passed, whichever is first.
 * @public read by the tests
 */
export const STALE_MS = 3_000;

/**
 * How long the person is waited for while the studio's window asks whether to update a jawata workspace. A studio that died while asking must not hold the
 * chat for ever: when the time is up the extension goes on with the engine address of its own setting and says so in a warning.
 * @public read by the tests
 */
export const ASKING_WAIT_MS = 600_000;

/** The studio's answer file, read. */
interface Handoff {
  readonly state: HandoffState;
  readonly workspace: string;
  readonly url: string;
  readonly key: string;
  readonly message: string;
}

/** Reads the answer file's text; undefined when it is not a JSON object with one of the five states (a file half written is treated as not there yet). */
function handoffOfText(text: string): Handoff | undefined {
  let value: unknown;
  try { value = JSON.parse(text); } catch { return undefined; }
  if (typeof value !== 'object' || value === null) { return undefined; }
  const o = value as Record<string, unknown>;
  if (typeof o.state !== 'string' || !HANDOFF_STATES.includes(o.state)) { return undefined; }
  const text0 = (x: unknown): string => typeof x === 'string' ? x : '';
  return { state: o.state as HandoffState, workspace: text0(o.workspace), url: text0(o.url), key: text0(o.key), message: text0(o.message) };
}

/**
 * The name of the studio's answer file for a set of folders: the lowercase hex SHA-256 of the folder strings, exactly as they are passed on
 * the command line, sorted ascending by their UTF-8 bytes and joined with a single newline (no newline at the end).
 * @public read by the tests
 */
export function handoffId(folders: readonly string[]): string {
  const sorted = folders.map(f => Buffer.from(f, 'utf8')).sort(Buffer.compare);
  const joined = Buffer.concat(sorted.flatMap((b, i) => i === 0 ? [b] : [Buffer.from('\n'), b]));
  return createHash('sha256').update(joined).digest('hex');
}

/**
 * The folders of a window as the studio is told them: each by its real path (the given one when it cannot be resolved), none twice, none empty.
 * @public read by the tests
 */
export function editorFoldersOf(folders: readonly string[], real: (folder: string) => string = realpathSync): string[] {
  const out: string[] = [];
  for (const folder of folders) {
    if (folder.trim() === '') { continue; }
    let resolved = folder;
    try { resolved = real(folder); } catch { /* the given path stands */ }
    if (!out.includes(resolved)) { out.push(resolved); }
  }
  return out;
}

/**
 * The studio's command line for a window: the setting's own arguments, then `--editor-folder <folder>` for each folder.
 * @public read by the tests
 */
export function launchArguments(args: readonly string[], folders: readonly string[]): string[] {
  return [...args, ...folders.flatMap(folder => ['--editor-folder', folder])];
}

/** The environment of a program started for this window: the one given, with the engine's address and key put over `JAWATA_URL` and `JAWATA_KEY` when the studio gave an engine. */
export function withEngine(env: Record<string, string> | undefined, engine: EngineAnswer | undefined): Record<string, string> | undefined {
  return engine === undefined ? env : { ...env, JAWATA_URL: engine.url, JAWATA_KEY: engine.key };
}

/** Whether the person is told this outcome besides the log: the ones where the studio was needed and was not there, and any the studio's answer made a warning of. */
export function toldToThePerson(outcome: StudioOutcome): boolean {
  return outcome.warn === true || TOLD.has(outcome.kind);
}

const TOLD: ReadonlySet<StudioOutcome['kind']> = new Set(['bad-address', 'no-studio-setting', 'bad-studio-setting', 'start-failed', 'not-in-time']);

/** What is needed to hand a window's folders to the studio. */
interface Plan {
  readonly command: string;
  readonly args: readonly string[];
  readonly file: string;
  readonly folders: readonly string[];
}

/** What one look at the answer file came to. */
type Look =
  | { readonly kind: 'wait' }
  | { readonly kind: 'asking' }
  | { readonly kind: 'gone' }
  | { readonly kind: 'answer'; readonly handoff: Handoff };

/** `text` without the engine's key, which a message from outside must not carry into a log or a notification. */
const withoutKey = (text: string, key: string): string => key === '' ? text : text.split(key).join('…');

/** The sentence after the first when the studio's own message says more. */
const said = (message: string): string => message.trim() === '' ? '' : ` ${message.trim().replace(/[.]*$/, '')}.`;

/**
 * Looks after the studio for one editor window: hands it the window's folders and waits for its answer, or asks whether the service answers,
 * starts the studio when it does not, and waits. The start that is under way is kept in `inProgress`, by address (by folders for a handoff),
 * so a second ask joins it and no second studio is started; the default register is shared by every extension of the window that carries
 * this module (see {@link windowRegister}). A handoff stays in the register for as long as the window lives, so the second extension to
 * activate gets the answer of the first and sends no launch of its own.
 */
export class StudioStart {
  private closed = false;

  constructor(
    private readonly ports: StudioPorts,
    private readonly inProgress: Map<string, Promise<StudioOutcome>> = windowRegister(),
  ) {}

  /** The editor window is closing or the extension is: whatever waits for the studio stops. */
  dispose(): void {
    this.closed = true;
  }

  /**
   * Never rejects. With `folders` and a studio setting that carries `handoffDir` the folders are handed to the studio; otherwise the
   * address in the agent setting is asked, as it was before folders were handed over.
   */
  ensure(address: string | undefined, studio: StudioSetting | undefined, folders: readonly string[] = []): Promise<StudioOutcome> {
    const plan = planOf(studio, folders);
    const run = plan === undefined ? this.viaAddress(address, studio)
      : 'outcome' in plan ? Promise.resolve(plan.outcome)
        : this.viaHandoff(address, plan);
    return run.catch((e: unknown): StudioOutcome => ({ kind: 'start-failed', why: `Looking after the studio failed: ${e instanceof Error ? e.message : String(e)}` }));
  }

  private viaAddress(address: string | undefined, studio: StudioSetting | undefined): Promise<StudioOutcome> {
    if (address === undefined) {
      return Promise.resolve({ kind: 'no-address', why: 'There is no engine address (JAWATA_URL in the env of jawataJava.server), so jawata Java does not look for the studio and goes on as it is.' });
    }
    const url = addressUrl(address);
    if (!url.ok) { return Promise.resolve(url.outcome); }
    return this.run(url.value, studio);
  }

  private async run(address: string, setting: StudioSetting | undefined): Promise<StudioOutcome> {
    if (await this.ports.probe(address)) { return { kind: 'answers', why: `The engine service answers at ${address}.` }; }
    const studio = studioOf(setting);
    if (!studio.ok) { return { kind: studio.outcome.kind, why: `The engine service does not answer at ${address}. ${studio.outcome.why}` }; }
    // Only a start that has really begun is kept: whoever finds one under way for this address waits for it and is told its outcome. The check
    // and the registration follow each other with nothing awaited between them, so two asks at once cannot both start.
    const joined = this.inProgress.get(address);
    if (joined) { return joined; }
    const start = this.startAndWait(address, studio.value.command, studio.value.args);
    this.inProgress.set(address, start);
    void start.then(() => { this.inProgress.delete(address); });
    return start;
  }

  private async startAndWait(address: string, command: string, args: string[]): Promise<StudioOutcome> {
    try {
      await this.ports.start(command, args);
    } catch (e) {
      return { kind: 'start-failed', why: `The engine service does not answer at ${address} and the studio could not be started (${[command, ...args].join(' ')}): ${e instanceof Error ? e.message : String(e)}` };
    }
    return this.waitForAnswer(address, `The studio was started (${command})`);
  }

  /** Asks the address once a second for two minutes; `label` says what has been done so far, for the sentence. */
  private async waitForAnswer(address: string, label: string): Promise<StudioOutcome> {
    const deadline = this.ports.now() + WAIT_MS;
    const answered = await this.ports.whileWaiting('Starting the jawata studio…', async () => {
      while (this.ports.now() < deadline) {
        await this.ports.sleep(POLL_MS);
        if (await this.ports.probe(address)) { return true; }
      }
      return false;
    });
    return answered
      ? { kind: 'started', why: `${label} and the engine service now answers at ${address}.` }
      : { kind: 'not-in-time', why: `${label} but the engine service did not answer at ${address} within ${WAIT_MS / 1000} seconds; going on without it.` };
  }

  // ---- the window's folders handed to the studio ----

  private async viaHandoff(address: string | undefined, plan: Plan): Promise<StudioOutcome> {
    const key = `folders:${plan.file}`;
    const cached = this.inProgress.get(key);
    if (cached === undefined) { return this.beginHandoff(key, address, plan); }
    const outcome = await cached;
    // an engine that has stopped since is not handed out again: the folders are handed to the studio anew, by one of the askers
    if (outcome.engine === undefined || await this.ports.probe(outcome.engine.url)) { return outcome; }
    const current = this.inProgress.get(key);
    return current !== undefined && current !== cached ? current : this.beginHandoff(key, address, plan);
  }

  private beginHandoff(key: string, address: string | undefined, plan: Plan): Promise<StudioOutcome> {
    const run = this.handOver(address, plan).catch((e: unknown): StudioOutcome => ({ kind: 'start-failed', why: `Handing the folders to the studio failed: ${e instanceof Error ? e.message : String(e)}` }));
    this.inProgress.set(key, run);
    return run;
  }

  private async handOver(address: string | undefined, plan: Plan): Promise<StudioOutcome> {
    const before = await this.ports.readFile(plan.file);
    const args = launchArguments(plan.args, plan.folders);
    try {
      await this.ports.start(plan.command, args);
    } catch (e) {
      return { kind: 'start-failed', why: `The studio could not be started with the folders of this window (${[plan.command, ...args].join(' ')}): ${e instanceof Error ? e.message : String(e)}` };
    }
    const launchedAt = this.ports.now();
    let deadline = launchedAt + HANDOFF_WAIT_MS;
    let told = false;
    let look: Look | 'late' | 'closed' | 'unanswered';
    for (;;) {
      look = await this.ports.whileWaiting('Starting the jawata studio…', () => this.waitForAnswerFile(plan.file, before, launchedAt, deadline));
      if (look === 'late') {
        return this.goOn(address, { handoff: 'late', warn: true, said: `The studio did not write its answer for this window's folders within ${HANDOFF_WAIT_MS / 1000} seconds.`, wait: false });
      }
      if (look === 'closed') { return { kind: 'not-in-time', why: 'The window closed while the studio was answering.' }; }
      if (look.kind !== 'asking') { break; }
      if (!told) {
        told = true;
        this.ports.say('The jawata studio is asking, in its own window, whether to update a jawata workspace for the folders of this window. The chat and jawata Java wait for your answer.');
      }
      look = await this.waitForAsked(plan.file, before, launchedAt);
      if (look === 'closed') { return { kind: 'not-in-time', why: 'The window closed while the studio was asking.' }; }
      if (look === 'unanswered') {
        return this.goOn(address, { handoff: 'unanswered', kind: 'not-in-time', said: `The studio was still asking whether to update a jawata workspace after ${ASKING_WAIT_MS / 60_000} minutes.`, wait: false });
      }
      // The file went away. The studio removes the old answer when a launch begins and writes nothing until its resident has answered, so this is
      // not an answer: the wait for the file begins again, with its two minutes counted from now.
      if (look.kind !== 'gone') { break; }
      deadline = this.ports.now() + HANDOFF_WAIT_MS;
    }
    if (look.kind !== 'answer') { return { kind: 'not-in-time', why: 'The studio\'s answer was not understood.' }; }
    return this.outcomeOf(look.handoff, address);
  }

  private outcomeOf(h: Handoff, address: string | undefined): Promise<StudioOutcome> | StudioOutcome {
    const message = withoutKey(h.message, h.key);
    switch (h.state) {
      case 'ready':
        return {
          kind: 'ready', handoff: 'ready', engine: { url: h.url, key: h.key },
          why: `The jawata studio runs ${h.workspace === '' ? 'a jawata workspace' : `the jawata workspace ${withoutKey(h.workspace, h.key)}`} for the folders of this window, and its engine is used for this window.`,
        };
      case 'failed':
        return this.goOn(address, { handoff: 'failed', warn: true, said: `The jawata studio could not prepare a jawata workspace for the folders of this window.${said(message)}`, wait: true });
      case 'declined':
        return this.goOn(address, { handoff: 'declined', said: `The jawata studio asked and the update of its jawata workspace was declined.${said(message)}`, wait: true });
      default:
        return this.goOn(address, { handoff: 'none', said: `The jawata studio has no jawata workspace for the folders of this window.${said(message)}`, wait: true });
    }
  }

  /** The engine of the agent setting, as before the folders were handed over: asked, and waited for when `wait` (the studio is not given a second two minutes after it already used one). */
  private async goOn(address: string | undefined, why: { handoff: HandoffState | 'late' | 'unanswered'; said: string; warn?: boolean; kind?: StudioOutcome['kind']; wait: boolean }): Promise<StudioOutcome> {
    const rest = await this.engineOfSetting(address, why.wait);
    return { ...rest, ...(why.kind === undefined ? {} : { kind: why.kind }), handoff: why.handoff, ...(why.warn || rest.warn ? { warn: true } : {}), why: `${why.said} Going on with the engine address of the agent setting. ${rest.why}` };
  }

  private async engineOfSetting(address: string | undefined, wait: boolean): Promise<StudioOutcome> {
    if (address === undefined) { return { kind: 'no-address', why: 'There is no engine address (JAWATA_URL in the agent or server setting).' }; }
    const url = addressUrl(address);
    if (!url.ok) { return url.outcome; }
    if (await this.ports.probe(address)) { return { kind: 'answers', why: `The engine service answers at ${address}.` }; }
    if (!wait) { return { kind: 'not-in-time', why: `The engine service does not answer at ${address}; going on without it.` }; }
    return this.waitForAnswer(address, 'The studio is running');
  }

  /** Until the answer file says something that ends the wait, or asks (then the person is the one waited for), or the `deadline` of a file that is not there is up. */
  private async waitForAnswerFile(file: string, before: string | undefined, launchedAt: number, deadline: number): Promise<Look | 'late' | 'closed'> {
    for (;;) {
      const look = await this.look(file, before, launchedAt, false);
      if (look.kind !== 'wait') { return look; }
      if (this.closed) { return 'closed'; }
      if (this.ports.now() >= deadline) { return 'late'; }
      await this.ports.sleep(POLL_MS);
    }
  }

  /** The studio is asking the person: until the file says more, goes away (then the caller waits for the file again), the window closes, or {@link ASKING_WAIT_MS} are up. */
  private async waitForAsked(file: string, before: string | undefined, launchedAt: number): Promise<Look | 'closed' | 'unanswered'> {
    const askedAt = this.ports.now();
    for (;;) {
      if (this.closed) { return 'closed'; }
      if (this.ports.now() - askedAt >= ASKING_WAIT_MS) { return 'unanswered'; }
      await this.ports.sleep(POLL_MS);
      const look = await this.look(file, before, launchedAt, true);
      if (look.kind === 'answer' || look.kind === 'gone') { return look; }
    }
  }

  private async look(file: string, before: string | undefined, launchedAt: number, wasAsking: boolean): Promise<Look> {
    const text = await this.ports.readFile(file);
    if (text === undefined) { return wasAsking ? { kind: 'gone' } : { kind: 'wait' }; }
    const handoff = handoffOfText(text);
    if (handoff === undefined) { return { kind: 'wait' }; }
    if (handoff.state === 'ready') {
      // a ready answer is used once its address answers: one for a resident that has stopped is not
      return await this.usable(handoff.url) ? { kind: 'answer', handoff } : { kind: 'wait' };
    }
    // an answer, or a question, that was in the file before the studio was started may belong to an earlier run
    if (text === before && this.ports.now() - launchedAt < STALE_MS) { return { kind: 'wait' }; }
    return handoff.state === 'asking' ? { kind: 'asking' } : { kind: 'answer', handoff };
  }

  private async usable(url: string): Promise<boolean> {
    return addressUrl(url).ok && await this.ports.probe(url);
  }
}

/** The plan for handing folders to the studio, or the outcome that says why it cannot be (a setting that is wrong), or nothing when the setting and the window do not call for it. */
function planOf(setting: StudioSetting | undefined, folders: readonly string[]): Plan | { readonly outcome: StudioOutcome } | undefined {
  const dir = setting?.handoffDir;
  if (dir === undefined || folders.length === 0) { return undefined; }
  const studio = studioOf(setting);
  if (!studio.ok) { return { outcome: studio.outcome }; }
  if (typeof dir !== 'string' || !path.isAbsolute(dir)) {
    return { outcome: { kind: 'bad-studio-setting', why: 'The studio setting\'s handoffDir has to be an absolute folder; the studio is not started.' } };
  }
  return { command: studio.value.command, args: studio.value.args, file: path.join(dir, `${handoffId(folders)}.json`), folders };
}

const REGISTER = Symbol.for('jawata.studio.startInProgress');

/**
 * The starts under way in this editor window. The chat and jawata Java run in one extension host and each carries its own copy of this
 * module, so the register hangs on the host's global object under a shared symbol: whichever asks first starts the studio, the other joins.
 * @public read by the tests
 */
export function windowRegister(): Map<string, Promise<StudioOutcome>> {
  const holder = globalThis as unknown as Record<symbol, Map<string, Promise<StudioOutcome>> | undefined>;
  return holder[REGISTER] ??= new Map();
}

/** The real probe, process start and clock; `whileWaiting` is the editor's, so the caller gives it. */
export function nodePorts(whileWaiting: StudioPorts['whileWaiting'], probeTimeoutMs = 3000, say: StudioPorts['say'] = () => undefined): StudioPorts {
  return {
    probe: baseUrl => new Promise<boolean>(resolve => {
      const client = baseUrl.startsWith('https:') ? https : http;
      const request = client.get(baseUrl, { timeout: probeTimeoutMs }, response => { response.resume(); resolve(true); });
      request.on('timeout', () => { request.destroy(); resolve(false); });
      request.on('error', () => { resolve(false); });
    }),
    start: (command, args) => new Promise<void>((resolve, reject) => {
      const child = spawn(command, [...args], { detached: true, stdio: 'ignore' });
      child.once('error', reject);
      child.once('spawn', () => { child.unref(); resolve(); });
    }),
    now: () => Date.now(),
    sleep: ms => new Promise(resolve => setTimeout(resolve, ms)),
    whileWaiting,
    readFile: file => fsp.readFile(file, 'utf8').then(text => text, () => undefined),
    say,
  };
}
