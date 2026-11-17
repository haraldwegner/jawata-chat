import { defineConfig } from '@vscode/test-cli';

// A named smoke run against the REAL route, not part of npm test: the chat in an isolated VS Code, the bridge and the engine of a release,
// Claude as the principal's brain. A first message, a model pick, a message with a tool, a hire, Stop and a message after Stop (28h S19).
//   JAWATA_LIVE_AGENT, JAWATA_LIVE_OUT, JAWATA_LIVE_SEATS, JAWATA_LIVE_WORKSPACE  as in src/test-live/live-s19.test.ts
export default defineConfig({
	label: 'live-s19',
	files: 'out/test-live/live-s19.test.js',
	workspaceFolder: process.env.JAWATA_LIVE_WORKSPACE,
	mocha: { timeout: 900000 },
});
