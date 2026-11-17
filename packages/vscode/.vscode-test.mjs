import { defineConfig } from '@vscode/test-cli';
import { createRequire } from 'node:module';
import * as fs from 'node:fs';
import * as net from 'node:net';
import * as path from 'node:path';

const require = createRequire(import.meta.url);
const here = path.dirname(new URL(import.meta.url).pathname);

/**
 * A workspace folder for a window started to test the chat's start (28h D57 (e)): its settings name the agent, so the chat connects as the
 * window starts, before a test can set anything. Kept under .vscode-test, which holds what the tests write; written anew on every run.
 */
function startWorkspace(name, agent) {
	const folder = path.join(here, '.vscode-test', `start-${name}`);
	fs.mkdirSync(path.join(folder, '.vscode'), { recursive: true });
	fs.writeFileSync(path.join(folder, '.vscode', 'settings.json'), JSON.stringify({ 'jawataChat.agent': agent }, null, 1));
	return folder;
}

/** A port nothing listens at: taken and given back at once. */
const closedPort = await new Promise(resolve => {
	const server = net.createServer().listen(0, '127.0.0.1', () => { const { port } = server.address(); server.close(() => resolve(port)); });
});
const node = process.env.npm_node_execpath || process.execPath;
const engineJar = process.env.JAWATA_ENGINE_JAR || path.resolve(here, '../../../jawata-mcp/build/dist/target/dist/jawata.jar');
// each start window has a user folder of its own, so no setting another test left there (a studio, an agent) reaches it
const ownUser = name => ['--user-data-dir', path.join(here, '.vscode-test', `user-data-start-${name}`)];

// The editor tests of npm test, each set in a VS Code of its own: the compiled tests under out/test, and
// the one that looks at the real page, which needs a window no other test has touched; and the chat's start
// (28h D57 (e)), each in a window whose workspace names the agent before the extension starts.
export default defineConfig([
	{ label: 'editor', files: 'out/test/**/*.test.js', mocha: { timeout: 60000 } },
	{ label: 'webview', files: 'out/test-webview/**/*.test.js', mocha: { timeout: 60000 } },
	{
		label: 'start', files: 'out/test-start/**/*.test.js', mocha: { timeout: 120000 }, env: { JAWATA_CHAT_CONNECT_AT_START: '1' },
		workspaceFolder: startWorkspace('connected', { command: node, args: [require.resolve('@jawata/acp-contract/replay'), require.resolve('@jawata/acp-contract/sessions/R1-jawata.jsonl')] }),
		launchArgs: ownUser('connected'),
	},
	{
		label: 'start-unreachable', files: 'out/test-start-unreachable/**/*.test.js', mocha: { timeout: 120000 }, env: { JAWATA_CHAT_CONNECT_AT_START: '1' },
		workspaceFolder: startWorkspace('unreachable', { command: 'java', args: ['-jar', engineJar, '--acp'], env: { JAWATA_URL: `http://127.0.0.1:${closedPort}`, JAWATA_KEY: 'none' } }),
		launchArgs: ownUser('unreachable'),
	},
]);
