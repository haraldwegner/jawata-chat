// A stand-in for the jawata studio, a real program the extension starts: it reads the folders it is started with (--editor-folder <folder>, repeated),
// works out the name of the answer file the way the contract says, and writes the answers its --config names, each after its own delay, each by
// writing a temporary file and renaming it (so a reader never sees half a file). It records every start it gets in <dir>/launches.jsonl.
//   "removeOld": true removes the answer file of an earlier run first, as the real studio does.
//   --config {"dir": "<handoffDir>", "steps": [{"afterMs": 0, "state": "ready", "url": "...", "key": "...", "message": "...", "workspace": "..."}, {"afterMs": 50, "remove": true}]}
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const argv = process.argv.slice(2);
const config = JSON.parse(argv[argv.indexOf('--config') + 1]);
const folders = argv.flatMap((a, i) => a === '--editor-folder' ? [argv[i + 1]] : []);
const id = createHash('sha256').update(folders.map(f => Buffer.from(f, 'utf8')).sort(Buffer.compare).map(b => b.toString('latin1')).join('\n'), 'latin1').digest('hex');
const file = path.join(config.dir, `${id}.json`);
// the real studio removes the answer file of an earlier run when a launch begins, and writes nothing until its resident has answered
if (config.removeOld) { fs.rmSync(file, { force: true }); }
fs.appendFileSync(path.join(config.dir, 'launches.jsonl'), JSON.stringify({ argv, folders, id }) + '\n');

for (const step of config.steps ?? []) {
  setTimeout(() => {
    if (step.remove) { fs.rmSync(file, { force: true }); return; }
    const { afterMs: _ignored, remove: _also, ...answer } = step;
    const body = JSON.stringify({ folders, workspace: '', url: '', key: '', message: '', ...answer });
    fs.writeFileSync(`${file}.tmp`, body);
    fs.renameSync(`${file}.tmp`, file);
  }, step.afterMs ?? 0);
}
