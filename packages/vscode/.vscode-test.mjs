import { defineConfig } from '@vscode/test-cli';

// The editor tests of npm test, each set in a VS Code of its own: the compiled tests under out/test, and
// the one that looks at the real page, which needs a window no other test has touched.
export default defineConfig([
	{ label: 'editor', files: 'out/test/**/*.test.js', mocha: { timeout: 60000 } },
	{ label: 'webview', files: 'out/test-webview/**/*.test.js', mocha: { timeout: 60000 } },
]);
