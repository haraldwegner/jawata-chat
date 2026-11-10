import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtempSync, readFileSync, existsSync, rmSync, realpathSync } from 'node:fs';
import http from 'node:http';
import Module from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';
import { fileURLToPath } from 'node:url';

// Sprint 28h stage 21 (j): the extension itself, run against a stand-in for the editor's API (the compiled module is loaded with 'vscode' and
// the language client replaced), so that what reaches the language server's launch and what is written to the log can be read.
const require = createRequire(import.meta.url);
const { handoffId, windowRegister } = require('../out/studio.js');
const fakeStudio = fileURLToPath(new URL('./support/fake-studio.cjs', import.meta.url));
const SECRET = 'KEY-ext-77be1-do-not-log';

const cleanups = [];
afterEach(async () => { windowRegister().clear(); for (const c of cleanups.splice(0)) { await c(); } });

async function engineService() {
  const server = http.createServer((_q, r) => { r.statusCode = 401; r.end('x'); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  cleanups.push(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  return `http://127.0.0.1:${server.address().port}`;
}

/** Loads the extension with the editor replaced; returns what it did. */
function editor({ settings, folders }) {
  const log = [];
  const warnings = [];
  const infos = [];
  const clients = [];
  const subscriptions = [];
  const commandNames = [];
  const debugFactories = {};
  const controllers = [];
  const config = (section) => ({ get: (key, fallback) => settings[`${section}.${key}`] ?? fallback });
  const vscode = {
    window: {
      createOutputChannel: () => ({ appendLine: (l) => { log.push(l); }, show() {}, dispose() {} }),
      showWarningMessage: (m) => { warnings.push(m); return Promise.resolve(undefined); },
      showInformationMessage: (m) => { infos.push(m); return Promise.resolve(undefined); },
      withProgress: (_o, job) => job(),
      registerTreeDataProvider: () => ({ dispose() {} }),
    },
    workspace: {
      getConfiguration: config,
      workspaceFolders: folders.map(fsPath => ({ uri: { scheme: 'file', fsPath } })),
      registerTextDocumentContentProvider: () => ({ dispose() {} }),
    },
    extensions: { all: [] },
    commands: { registerCommand: (name) => { commandNames.push(name); return { dispose() {} }; }, executeCommand: () => Promise.resolve(undefined) },
    ProgressLocation: { Notification: 15 },
    EventEmitter: class { event = () => ({ dispose() {} }); fire() {} },
    Uri: { parse: (s) => s },
    Position: class {},
    Range: class {},
    Location: class {},
    TestMessage: class {},
    TestRunProfileKind: { Run: 1 },
    Disposable: class { constructor(fn) { this.dispose = fn ?? (() => {}); } static from(...parts) { return new this(() => parts.forEach(p => p?.dispose?.())); } },
    DebugAdapterExecutable: class { constructor(command, args, options) { this.command = command; this.args = args; this.options = options; } },
    debug: {
      registerDebugAdapterDescriptorFactory: (type, factory) => { debugFactories[type] = factory; return { dispose() {} }; },
      registerDebugConfigurationProvider: () => ({ dispose() {} }),
      onDidReceiveDebugSessionCustomEvent: () => ({ dispose() {} }),
      onDidTerminateDebugSession: () => ({ dispose() {} }),
    },
    tests: {
      createTestController: (id) => { controllers.push(id); return { items: { replace() {} }, createRunProfile() {}, dispose() {} }; },
    },
  };
  class LanguageClient {
    constructor(id, name, server, options) { this.server = server; this.options = options; clients.push(this); }
    async start() {}
    async stop() {}
    sendRequest() { return Promise.resolve(null); }
  }
  const load = Module._load;
  Module._load = function (request, ...rest) {
    if (request === 'vscode') { return vscode; }
    if (request === 'vscode-languageclient/node') { return { LanguageClient, TransportKind: { stdio: 0 } }; }
    return load.call(this, request, ...rest);
  };
  // every module that imports the editor's API holds the stand-in it was first loaded with, so each is loaded afresh with this one
  for (const loaded of ['extension', 'features', 'projectsView']) { delete require.cache[require.resolve(`../out/${loaded}.js`)]; }
  const extension = require('../out/extension.js');
  Module._load = load;
  return { extension, log, warnings, infos, clients, commandNames, debugFactories, controllers, context: { subscriptions } };
}

function setup(steps, withHandoff = true) {
  const dir = mkdtempSync(join(tmpdir(), 'jawata-ext-'));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  const folder = realpathSync(dir);
  const studio = { command: process.execPath, args: [fakeStudio, '--config', JSON.stringify({ dir, steps })], ...(withHandoff ? { handoffDir: dir } : {}) };
  const launches = () => existsSync(join(dir, 'launches.jsonl')) ? readFileSync(join(dir, 'launches.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];
  return { dir, folder, studio, launches };
}

test('jawata Java hands the window\'s folders to the studio and starts the language server with the engine the studio names; the key is in no log line or message', async () => {
  const mine = await engineService();
  const configured = await engineService();
  const s = setup([{ afterMs: 0, state: 'ready', url: mine, key: SECRET, workspace: 'proj' }]);
  const server = { command: 'java', args: ['-jar', 'jawata.jar', '--lsp'], env: { JAWATA_URL: configured, JAWATA_KEY: 'the-key-in-the-setting', KEEP: '1' } };
  const e = editor({ settings: { 'jawataJava.server': server, 'jawataJava.studio': s.studio }, folders: [s.dir] });
  await e.extension.activate(e.context);
  assert.equal(e.clients.length, 1);
  const env = e.clients[0].server.options.env;
  assert.equal(env.JAWATA_URL, mine, 'the studio\'s engine, not the setting\'s');
  assert.equal(env.JAWATA_KEY, SECRET);
  assert.equal(env.KEEP, '1');
  assert.deepEqual(server.env, { JAWATA_URL: configured, JAWATA_KEY: 'the-key-in-the-setting', KEEP: '1' }, 'the setting itself is not written to');
  assert.deepEqual(s.launches().map(l => l.folders), [[s.folder]]);
  assert.equal(s.launches()[0].id, handoffId([s.folder]));
  const everythingSaid = JSON.stringify([e.log, e.warnings, e.infos]);
  assert.ok(!everythingSaid.includes(SECRET), 'the key is not in the log, a warning or a message');
  assert.ok(!everythingSaid.includes(mine), 'nor is the address');
  assert.ok(e.log.some(l => l.startsWith('studio: ready:')), e.log.join('\n'));
  await e.extension.deactivate();
});

test('the extension contributes the debugger, the Testing view and the refactor command itself, and the debugger runs the launcher with --dap against the engine the studio named', async () => {
  const mine = await engineService();
  const s = setup([{ afterMs: 0, state: 'ready', url: mine, key: SECRET, workspace: 'proj' }]);
  const server = { command: 'java', args: ['-jar', 'jawata.jar', '--lsp'], env: { KEEP: '1' } };
  const e = editor({ settings: { 'jawataJava.server': server, 'jawataJava.studio': s.studio }, folders: [s.dir] });
  await e.extension.activate(e.context);
  assert.deepEqual(e.controllers, ['jawataJava'], 'one Testing controller');
  assert.ok(e.commandNames.includes('jawata.refactor'), 'the command the engine\'s code actions carry is registered');
  assert.ok(e.debugFactories.jawata, 'the debugger type the package contributes has an adapter');
  const adapter = e.debugFactories.jawata.createDebugAdapterDescriptor({});
  assert.deepEqual(adapter.args, ['-jar', 'jawata.jar', '--dap']);
  assert.equal(adapter.options.env.JAWATA_URL, mine, 'the debugger goes to the studio\'s engine, as the language server does');
  assert.equal(adapter.options.env.KEEP, '1');
  await e.extension.deactivate();
});

test('without a handoffDir, or with no folder open, the language server gets the settings\' own environment and no folder is passed', async () => {
  const configured = await engineService();
  const server = { command: 'java', args: ['--lsp'], env: { JAWATA_URL: configured, JAWATA_KEY: 'k' } };
  const none = setup([{ afterMs: 0, state: 'ready', url: 'http://127.0.0.1:1', key: SECRET }], false);
  const a = editor({ settings: { 'jawataJava.server': server, 'jawataJava.studio': none.studio }, folders: [none.dir] });
  await a.extension.activate(a.context);
  assert.deepEqual({ url: a.clients[0].server.options.env.JAWATA_URL, key: a.clients[0].server.options.env.JAWATA_KEY }, { url: configured, key: 'k' });
  assert.deepEqual(none.launches(), [], 'the service answers, so nothing is started');
  await a.extension.deactivate();
  windowRegister().clear();
  const empty = setup([{ afterMs: 0, state: 'ready', url: 'http://127.0.0.1:1', key: SECRET }]);
  const b = editor({ settings: { 'jawataJava.server': server, 'jawataJava.studio': empty.studio }, folders: [] });
  await b.extension.activate(b.context);
  assert.equal(b.clients[0].server.options.env.JAWATA_URL, configured);
  assert.deepEqual(empty.launches(), []);
  await b.extension.deactivate();
});

test('a failed answer is a warning with the studio\'s message, and the language server starts with the settings\' environment', async () => {
  const configured = await engineService();
  const s = setup([{ afterMs: 0, state: 'failed', key: SECRET, message: `no resident for these folders (${SECRET})` }]);
  const server = { command: 'java', args: ['--lsp'], env: { JAWATA_URL: configured, JAWATA_KEY: 'k' } };
  const e = editor({ settings: { 'jawataJava.server': server, 'jawataJava.studio': s.studio }, folders: [s.dir] });
  await e.extension.activate(e.context);
  assert.equal(e.warnings.length, 1);
  assert.match(e.warnings[0], /no resident for these folders/);
  assert.ok(!JSON.stringify([e.log, e.warnings]).includes(SECRET));
  assert.equal(e.clients[0].server.options.env.JAWATA_URL, configured);
  await e.extension.deactivate();
});
