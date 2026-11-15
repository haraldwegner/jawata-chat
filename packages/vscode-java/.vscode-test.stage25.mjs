import { defineConfig } from '@vscode/test-cli';

// Sprint 28i, Stage 25, step A9: a named run against a REAL engine, not part of npm test. build/s25-window-run.sh in jawata-mcp starts the engine,
// loads the scratch tree and calls this with
//   JAWATA_LIVE_WORKSPACE        folder of the scratch tree the window opens
//   JAWATA_LIVE_SERVER           JSON {command, args, env}: the launcher with --lsp and the engine's address
//   JAWATA_LIVE_DEBUG_CLASSPATH  where the debug program was compiled
//   JAWATA_LIVE_OUT              file the measured numbers are written to
//   JAWATA_LIVE_USER_DATA        folder for the window's own profile, so no installed extension of the person's reaches it
export default defineConfig({
	label: 'stage25',
	files: 'out/test-live/stage25.test.js',
	workspaceFolder: process.env.JAWATA_LIVE_WORKSPACE,
	launchArgs: process.env.JAWATA_LIVE_USER_DATA
		? ['--user-data-dir', process.env.JAWATA_LIVE_USER_DATA, '--extensions-dir', `${process.env.JAWATA_LIVE_USER_DATA}/extensions`, '--disable-workspace-trust']
		: [],
	mocha: { timeout: 600000 },
});
