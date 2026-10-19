import { defineConfig } from '@vscode/test-cli';

// A named visual smoke run, not part of npm test: the chat against the replay of R3, the `/`
// list opened by a real keystroke, and a screenshot written to JAWATA_VISUAL_OUT.
export default defineConfig({
	label: 'visual',
	files: 'out/test-visual/**/*.test.js',
	mocha: { timeout: 120000 },
});
