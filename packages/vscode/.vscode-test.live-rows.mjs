import { defineConfig } from '@vscode/test-cli';

// A named smoke run against a REAL agent, not part of npm test: the rows the controls run left half-run (two hires and a session load, a stop, the hire tree)
// (transcript, brains, brain choice, seat model, side question) are used and what the chat holds is written to JAWATA_LIVE_OUT.
//   JAWATA_LIVE_WORKSPACE, JAWATA_LIVE_OUT, JAWATA_LIVE_PROMPT, JAWATA_LIVE_AGENT  as for the one-turn live run
//   JAWATA_LIVE_MODE       two | stop | tree
export default defineConfig({
	label: 'live-rows',
	files: 'out/test-live/live-rows.test.js',
	workspaceFolder: process.env.JAWATA_LIVE_WORKSPACE,
	mocha: { timeout: 400000 },
});
