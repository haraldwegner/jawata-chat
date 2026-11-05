import { defineConfig } from '@vscode/test-cli';

// A named smoke run against a REAL agent, not part of npm test: one turn in which the agent hires a seat, then the chat's own controls
// (transcript, brains, brain choice, seat model, side question) are used and what the chat holds is written to JAWATA_LIVE_OUT.
//   JAWATA_LIVE_WORKSPACE, JAWATA_LIVE_OUT, JAWATA_LIVE_PROMPT, JAWATA_LIVE_AGENT  as for the one-turn live run
//   JAWATA_LIVE_SEAT       the seat the prompt makes the agent hire
export default defineConfig({
	label: 'live-controls',
	files: 'out/test-live/live-controls.test.js',
	workspaceFolder: process.env.JAWATA_LIVE_WORKSPACE,
	mocha: { timeout: 400000 },
});
