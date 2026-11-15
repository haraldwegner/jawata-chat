// The Memory screen: every sentence it can say, and what it asks the host, on a fake host.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<!doctype html><html><head></head><body><div id="root"></div></body></html>', { pretendToBeVisual: true });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.IS_REACT_ACT_ENVIRONMENT = false;
const realInterval = globalThis.setInterval;
globalThis.setInterval = (...args) => realInterval(...args).unref();

const { memoryView, summarize, mountScreen, MEMORY_TITLES, LANE_HINTS } = await import('../dist/index.js');

const stats = (more = {}) => ({
  total: 11622,
  store: { file: '/home/someone/.local/share/jawata/experience.mv.db', bytes: 119746150 },
  by_lane: { '(none)': 3, code: 11000, experience: 300, patterns: 189, rules: 9 },
  catalogue: { byNamespace: { 'java-design-patterns': 187, 'jawata-samples': 2 }, cures: { declared: 13, unresolved: 0 } },
  describing: { describedPerBundle: { unattributed: 1, 'jawata-mcp': 1000 }, describedAreas: ['org.jawata.mcp', 'org.jawata.core'] },
  ...more,
});
const status = (mode = 'shared', more = {}) => ({ mode, stats: stats(more) });

test('the summary says how many entries, how big, and which store, with the file in the mouseover', () => {
  const view = memoryView(status());
  assert.equal(view.summary.text, '11622 entries · 114.2 MB · shared by every workspace');
  assert.equal(view.summary.title, 'One store for your whole user, so what is learned in one workspace can be recalled in all. File: /home/someone/.local/share/jawata/experience.mv.db');
  assert.equal(memoryView(status('workspace')).summary.text, '11622 entries · 114.2 MB · one store per workspace');
  assert.equal(memoryView(status('memory')).summary.text, '11622 entries · 114.2 MB · held in memory only');
  // a store that says it is kept in memory is called so whatever the setting says
  assert.equal(memoryView(status('shared', { store: { file: 'in-memory' } })).summary.text, '11622 entries · – · held in memory only');
  assert.match(memoryView(status('/data/store')).summary.title, /\/data\/store/);
});

test('lost cataloguer writes and a cut list of areas are said in the open, and nothing when neither happened', () => {
  assert.deepEqual(memoryView(status()).warnings, []);
  const view = memoryView(status('shared', { describing: { describedPerBundle: { a: 2 }, lostBookkeepingWrites: 4, describedAreas: [], describedAreasTruncated: 'first 200 of 340' } }));
  assert.deepEqual(view.warnings, [
    '4 cataloguer bookkeeping write(s) were LOST — those units will be offered again, so the cataloguer\'s figures may be lower than the work done.',
    'The list of described areas is cut: first 200 of 340',
  ]);
  assert.equal(view.cataloguer.attention, true);
  assert.equal(view.cataloguer.text, 'Cataloguer: 2 units described in 1 bundles · no area summarised yet · 4 writes LOST');
});

test('what the store holds: every lane the engine names, unclassified last, each with what it holds', () => {
  const view = memoryView(status());
  assert.deepEqual(view.lanes.map(lane => `${lane.count} ${lane.lane}`), ['11000 code', '300 experience', '189 patterns', '9 rules', '3 unclassified']);
  assert.equal(view.lanes[0].title, LANE_HINTS.code);
  assert.equal(memoryView(status('shared', { by_lane: { newlane: 1 } })).lanes[0].title, 'A kind of entry the store keeps apart from the others.');
  assert.equal(view.patterns.text, 'Pattern library: 13 cures, all resolved');
  assert.match(view.patterns.title, /java-design-patterns: 187 · jawata-samples: 2$/);
  assert.equal(view.cataloguer.text, 'Cataloguer: 1001 units described in 2 bundles · 2 areas summarised');
  assert.match(view.cataloguer.title, /per bundle: jawata-mcp 1000, unattributed 1\./);
});

test('what an action did is said in sentences, a question answered no says nothing changed, and Clean up says each of its three steps', () => {
  assert.deepEqual(summarize('load', { loaded: 3, files: 5, unchanged: 2 }), ['Loaded 3 of 5 file(s), 2 unchanged (skipped)']);
  assert.deepEqual(summarize('wipe', { cancelled: true }), ['Cancelled: nothing was changed.']);
  assert.deepEqual(summarize('wipe', { removed: 7, backup: 'x-wipe.zip' }), ['Removed 7 entr(ies)', 'A copy of the previous state was kept: x-wipe.zip']);
  assert.deepEqual(summarize('cleanUp', { prune: { removed: 2 }, dedup: { group_count: 1, merged: 1 }, compact: { compacted: true, bytes_before: 2048, bytes_after: 1024 } }),
    ['Removed 2 entr(ies)', '1 duplicate group(s), 1 merged', 'Store compacted: 2.0 KB → 1.0 KB']);
  assert.deepEqual(summarize('restore', { backups: [] }), ['No copies yet.']);
});

/** A host that answers from the given status and records what it was asked. */
function fakeHost(reading, answers = {}) {
  const asked = [];
  return {
    asked,
    theme: () => 'light',
    knowledgeStatus: async () => { asked.push('knowledgeStatus'); return reading; },
    experienceVerb: async (verb, args) => { asked.push(`${verb} ${JSON.stringify(args)}`); return answers[verb] ?? {}; },
    saveDialog: async () => { asked.push('saveDialog'); return answers.saveDialog ?? null; },
    openDialog: async () => { asked.push('openDialog'); return answers.openDialog ?? null; },
  };
}

async function until(condition, what = 'the screen to settle') {
  for (let i = 0; i < 300; i++) {
    if (condition()) { return; }
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.fail(`timed out waiting for ${what}`);
}

const mounted = async (host) => {
  const root = document.createElement('div');
  document.body.appendChild(root);
  const handle = mountScreen(root, host, 'memory');
  await until(() => root.textContent.includes('entries'), 'the store to be read');
  return { root, handle };
};
const button = (root, words) => [...root.querySelectorAll('button')].find(one => one.textContent === words);

test('the screen shows the store and every control with its mouseover, word for word', async () => {
  const { root } = await mounted(fakeHost(status()));
  assert.equal(root.querySelector('p[title]').textContent, '11622 entries · 114.2 MB · shared by every workspace');
  const titles = Object.fromEntries([...root.querySelectorAll('button, summary')].map(one => [one.textContent, one.title]));
  // word for word: the studio's mouseovers, Load without "Runs on EVERY reachable workspace of this store." (ux report section 5) and
  // Reload status without the workspaces, which are not true inside Eclipse
  assert.deepEqual(titles, {
    Load: 'Seed the store from your memory files: the instruction files found in your projects, or, when Preferences > jawata > Memory names folders, those folders and nothing else. Idempotent: re-loading replaces, so this is also the re-initialize after a wipe. Say: "load my memory files"',
    'Back up now': 'Take a copy of the whole store right now. Wipe, Clean up, Import and Restore each take their own automatically. Say: "back up the store"',
    'Clean up': 'One hygiene pass: prune aged rejected/superseded entries, merge duplicate groups and compact the store file. Each is also available by prompt.',
    'More ▾': 'Less common actions',
    'Reload status': 'Re-read entry counts, store file and size.',
    'Export…': 'Write the whole store to a portable JSON file — opens the save dialog. Say: "export the store to a file"',
    'Import…': 'Re-ingest a previously exported JSON file (deduplicated by id) — opens the file picker. Say: "import the export file"',
    'Restore…': 'List the kept versions, newest first, and put one back. Say: "restore the store"',
    'Curation…': 'The standing RULES, and the entries nobody has vouched for yet — each with the one action its lane\'s lifecycle allows. Say: "list the rules" / "promote that entry"',
    'Wipe…': 'Delete everything in this store. Re-initialize afterwards with Load. Say: "wipe the store"',
  });
  assert.equal(MEMORY_TITLES.load, titles.Load);
  assert.match(root.textContent, /No action run yet — what the last action did appears here\./);
  assert.match(root.textContent, /11000 code/);
  assert.equal(root.querySelector('h3[title]').textContent, 'What the store holds');
});

test('Load asks the host, says what it did, and reads the store again', async () => {
  const host = fakeHost(status(), { load: { loaded: 4, files: 4 } });
  const { root } = await mounted(host);
  button(root, 'Load').click();
  await until(() => root.textContent.includes('Loaded 4 of 4 file(s)'), 'the answer of Load');
  assert.deepEqual(host.asked, ['knowledgeStatus', 'load {}', 'knowledgeStatus']);
  assert.match(root.textContent, /Status of “load”/);
});

test('a destructive action the person declined in the host\'s question changes nothing and reads nothing again', async () => {
  const host = fakeHost(status(), { wipe: { cancelled: true } });
  const { root } = await mounted(host);
  button(root, 'Wipe…').click();
  await until(() => root.textContent.includes('Cancelled: nothing was changed.'), 'the cancelled answer');
  assert.deepEqual(host.asked, ['knowledgeStatus', 'wipe {}']);
});

test('Export asks the host where to write, and a cancelled dialog sends nothing to the store', async () => {
  const cancelled = fakeHost(status());
  const { root } = await mounted(cancelled);
  button(root, 'Export…').click();
  await until(() => cancelled.asked.includes('saveDialog'), 'the save dialog');
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.deepEqual(cancelled.asked, ['knowledgeStatus', 'saveDialog']);

  const chosen = fakeHost(status(), { saveDialog: '/tmp/out.json', export: { exported: 9, path: '/tmp/out.json' } });
  const second = await mounted(chosen);
  button(second.root, 'Export…').click();
  await until(() => second.root.textContent.includes('Exported 9 entr(ies) to /tmp/out.json'), 'the export');
  assert.ok(chosen.asked.includes('export {"path":"/tmp/out.json"}'), chosen.asked.join());
});

test('Restore lists the versions, and putting one back names it to the host', async () => {
  const host = fakeHost(status(), { restore: { backups: ['2026-11-15-wipe.zip'], depth: 10 } });
  const { root } = await mounted(host);
  button(root, 'Restore…').click();
  await until(() => root.textContent.includes('2026-11-15-wipe.zip'), 'the versions');
  assert.match(root.textContent, /Versions — 1 kept, 10 deep/);
  button(root, 'Restore').click();
  await until(() => host.asked.includes('restore {"name":"2026-11-15-wipe.zip"}'), 'the restore');
  assert.equal(button(root, 'Refresh versions').title, MEMORY_TITLES.restore);
});

test('Curation lists rules and entries, and a rule needs both a source and a sentence', async () => {
  const host = fakeHost(status());
  host.experienceVerb = async (verb, args) => {
    host.asked.push(`${verb} ${JSON.stringify(args)}`);
    if (verb === 'list' && args.type === 'rule') { return { entries: [{ id: 'r1', type: 'rule', summary: 'Keep it short.', rule_version: 2 }] }; }
    if (verb === 'list') { return { entries: [{ id: 'e1', type: 'lesson', summary: 'A thing learned.', status: 'candidate' }, { id: 'r1', type: 'rule' }] }; }
    return { id: 'r2', rule_version: 1, derived_from: ['e1'] };
  };
  const { root } = await mounted(host);
  button(root, 'Curation…').click();
  await until(() => root.textContent.includes('Entries — 1, 1 awaiting review'), 'the curation lists');
  // the two hint paragraphs the ux report removes live on in these two mouseovers
  assert.equal(root.querySelector('h3[title]').title, 'A retired rule keeps its row and its date, which is what answers “what did this say, and until when”. Amending one — a new version, the old kept — is a prompt verb: the amended sentence is the work, and nothing here can write it.');
  assert.doesNotMatch(root.textContent, /A retired rule keeps its row/, 'the paragraph itself is gone from the screen');
  assert.match(root.textContent, /v2 Keep it short\./);
  assert.match(root.textContent, /Up to 200 shown, in the store's own order\./);
  const promote = button(root, 'Promote to rule');
  assert.equal(promote.disabled, true, 'nothing ticked and no sentence');
  assert.match(promote.title, /^Write a standing rule drawn from the ticked entries\. .* Tick at least one entry and write the sentence — neither is optional, because a rule with no sources is an assertion nobody can check and a generated sentence is not a rule\./);
  assert.doesNotMatch(root.textContent, /neither is optional/, 'the paragraph itself is gone from the screen');
});

test('a store that cannot be read says so', async () => {
  const root = document.createElement('div');
  document.body.appendChild(root);
  mountScreen(root, { theme: () => 'light', knowledgeStatus: (() => { let tries = 0; return async () => { if (++tries === 1) { throw new Error('no engine'); } return status(); }; })() }, 'memory');
  await until(() => root.textContent.includes('Could not read the store: no engine'), 'the failure');
});

test('refresh reads the store again', async () => {
  const host = fakeHost(status());
  const { handle } = await mounted(host);
  await handle.refresh();
  assert.equal(host.asked.filter(one => one === 'knowledgeStatus').length, 2);
});

test('an action is named in the person\'s words while it runs and after, not by its internal name', async () => {
  let finish;
  const host = fakeHost(status());
  host.experienceVerb = (verb) => { host.asked.push(verb); return new Promise(resolve => { finish = resolve; }); };
  const { root } = await mounted(host);
  button(root, 'Clean up').click();
  await until(() => root.textContent.includes('running “clean up”…'), 'the running line');
  finish({ cancelled: true });
  await until(() => root.textContent.includes('Status of “clean up”'), 'the status heading');
  assert.doesNotMatch(root.textContent, /cleanUp/);
});

test('a first read that fails says so and is asked again on its own, so a view opened early is not left dead', async () => {
  const root = document.createElement('div');
  document.body.appendChild(root);
  let calls = 0;
  mountScreen(root, { theme: () => 'light', knowledgeStatus: async () => { if (++calls === 1) { throw new Error('not running'); } return status(); } }, 'memory');
  await until(() => root.textContent.includes('Could not read the store: not running'), 'the failure');
  assert.match(root.textContent, /Asking again automatically…/);
  for (let i = 0; i < 800 && !root.textContent.includes('entries'); i++) { await new Promise(resolve => setTimeout(resolve, 10)); }
  assert.match(root.textContent, /11622 entries/, 'read again after the first back-off');
  assert.equal(calls, 2);
});

test('the More menu closes on a click outside it and on Escape', async () => {
  const { root } = await mounted(fakeHost(status()));
  const menu = root.querySelector('details');
  menu.open = true;
  document.body.dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true }));
  assert.equal(menu.open, false, 'a click outside closed it');
  menu.open = true;
  menu.querySelector('summary').dispatchEvent(new window.MouseEvent('mousedown', { bubbles: true }));
  assert.equal(menu.open, true, 'a click inside leaves it open');
  document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape' }));
  assert.equal(menu.open, false, 'Escape closed it');
});

test('Wipe and putting a version back are in the danger colour, and opening curation is named so', async () => {
  const host = fakeHost(status(), { restore: { backups: ['v1.zip'], depth: 3 } });
  const { root } = await mounted(host);
  assert.equal(button(root, 'Wipe…').className, 'screen-danger');
  button(root, 'Restore…').click();
  await until(() => button(root, 'Restore') !== undefined, 'the versions');
  assert.equal(button(root, 'Restore').className, 'screen-danger');
  button(root, 'Curation…').click();
  await until(() => root.textContent.includes('Status of “curation”'), 'the curation status');
});
