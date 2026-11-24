import { defineConfig } from '@vscode/test-cli';

// The Up and Down check of Sprint 28h Stage 27 (z65), not part of npm test: the window is started with a debugging port so the test can read the
// chat's field while real keys (xdotool) are pressed in it. JAWATA_Z65_OUT is the folder the result is written to. Run it under
// `xvfb-run -a -s "-screen 0 1600x1000x24"` so the keys go to a virtual display and never to the person's own screen.
export default defineConfig({
	label: 'z65',
	files: 'out/test-visual/s27-z65-up-wrapped.test.js',
	launchArgs: ['--remote-debugging-port=9333'],
	mocha: { timeout: 240000 },
});
