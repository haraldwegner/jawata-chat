import { defineConfig } from '@vscode/test-cli';

// Sprint 28h Stage 27: a real principal in the chat window, run under `xvfb-run -a`, never against the person's own screen. Not part of npm test.
//   JAWATA_LIVE_WORKSPACE, JAWATA_LIVE_OUT, JAWATA_LIVE_PROMPT, JAWATA_LIVE_AGENT  as for the one-turn live run
//   JAWATA_LIVE_PROMPT2    optional: sent after the first turn ended, JAWATA_LIVE_GAP_MS (3000) later
//   JAWATA_LIVE_LISTEN_MS  how long the window listens at the end (20000)
export default defineConfig({
	label: 'live-principal',
	files: 'out/test-live/live-principal.test.js',
	workspaceFolder: process.env.JAWATA_LIVE_WORKSPACE,
	mocha: { timeout: 600000 },
});
