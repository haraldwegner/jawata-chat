import { defineConfig } from '@vscode/test-cli';

// A named run against a REAL engine, not part of npm test: build/s16-window-run.sh in jawata-mcp starts the engine, loads a copy of a
// sample tree and calls this with
//   JAWATA_LIVE_WORKSPACE  folder of the sample tree the editor opens
//   JAWATA_LIVE_SERVER     JSON {command, args, env}: the launcher with --lsp and the engine's address
//   JAWATA_LIVE_FILE       the Java file to edit, relative to the workspace folder
//   JAWATA_LIVE_OUT        file the measured numbers are written to
//   JAWATA_LIVE_USER_DATA  folder for the window's own profile, so no installed extension of the person's reaches it
export default defineConfig({
	label: 'live',
	files: 'out/test-live/**/*.test.js',
	workspaceFolder: process.env.JAWATA_LIVE_WORKSPACE,
	launchArgs: process.env.JAWATA_LIVE_USER_DATA
		? ['--user-data-dir', process.env.JAWATA_LIVE_USER_DATA, '--extensions-dir', `${process.env.JAWATA_LIVE_USER_DATA}/extensions`, '--disable-workspace-trust']
		: [],
	mocha: { timeout: 180000 },
});
