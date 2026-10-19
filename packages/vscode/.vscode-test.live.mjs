import { defineConfig } from '@vscode/test-cli';

// A named smoke run against a REAL agent, not part of npm test. It drives the chat through its
// own commands and leaves the session recording in JAWATA_LIVE_OUT.
//   JAWATA_LIVE_WORKSPACE  folder the agent works in
//   JAWATA_LIVE_OUT        folder the recording is copied to
//   JAWATA_LIVE_PROMPT     the one prompt sent
//   JAWATA_LIVE_AGENT      JSON {command, args, env}; default Claude Code's ACP adapter
export default defineConfig({
	label: 'live',
	files: 'out/test-live/**/*.test.js',
	workspaceFolder: process.env.JAWATA_LIVE_WORKSPACE,
	mocha: { timeout: 300000 },
});
