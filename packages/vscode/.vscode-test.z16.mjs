import { defineConfig } from '@vscode/test-cli';

// The keystroke measurement of Sprint 28h Stage 27 (z16), not part of npm test: the window is started with a debugging port so the test can read the
// chat's page (marks on a keystroke and the next frame, the browser's own trace). JAWATA_Z16_SESSION is `empty` or `long`, JAWATA_Z16_OUT the folder
// the numbers are written to, JAWATA_Z16_LONG the recorded session of 2000 messages. The test types with xdotool: run it under
// `xvfb-run -a -s "-screen 0 1600x1000x24"` so the keystrokes go to a virtual display and never to the person's own screen.
export default defineConfig({
	label: 'z16',
	files: 'out/test-visual/s27-z16-keystroke.test.js',
	launchArgs: ['--remote-debugging-port=9333'],
	mocha: { timeout: 240000 },
});
