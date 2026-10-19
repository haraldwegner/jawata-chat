import * as assert from 'assert';
import * as cp from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { ChatWebviewProvider } from '../ui/ChatWebviewProvider';

/**
 * The page is the `chat-view` bundle: the provider's html loads `dist/webview.js`, the file is in
 * the built extension and in the `.vsix`, and the earlier inline page is gone.
 */
suite('The chat page is the chat-view bundle', function () {
	this.timeout(60000);
	const root = path.join(__dirname, '..', '..');

	test('the provider\'s html loads the bundle by its webview uri, under a nonce-only script policy', () => {
		const html: { value: string } = { value: '' };
		const fakeView = {
			webview: {
				options: {},
				cspSource: 'vscode-resource:',
				asWebviewUri: (uri: vscode.Uri) => vscode.Uri.parse('https://webview.test' + uri.path),
				set html(v: string) { html.value = v; },
				onDidReceiveMessage: () => ({ dispose() { /* none */ } }),
				postMessage: () => Promise.resolve(true),
			},
			onDidDispose: () => ({ dispose() { /* none */ } }),
			show() { /* none */ },
		};
		const mounted: unknown[] = [];
		const seen = new Set<string>();
		// the nonce is random: many pages, so that a character the pattern does not allow cannot hide behind luck
		for (let i = 0; i < 50; i++) {
			new ChatWebviewProvider(vscode.Uri.file(root), host => mounted.push(host)).resolveWebviewView(fakeView as never);
			const nonce = /script-src 'nonce-([A-Za-z0-9+/_-]+=*)'/.exec(html.value)?.[1];
			assert.ok(nonce, `a nonce policy: ${html.value}`);
			assert.ok(html.value.includes(`<script nonce="${nonce}" src="https://webview.test${vscode.Uri.file(path.join(root, 'dist', 'webview.js')).path}"></script>`), html.value);
			assert.ok(html.value.includes('<div id="root"></div>'));
			assert.ok(!/<script nonce="[^"]*">/.test(html.value), 'no inline script');
			seen.add(nonce);
		}
		assert.strictEqual(seen.size, 50, 'every page has a nonce of its own');
		assert.strictEqual(mounted.length, 50, 'and each one was handed to what serves it');
	});

	test('the built extension holds the bundle, and it is the chat-view page', () => {
		const bundle = path.join(root, 'dist', 'webview.js');
		assert.ok(fs.existsSync(bundle), 'dist/webview.js is built');
		const text = fs.readFileSync(bundle, 'utf8');
		assert.ok(text.includes('session-banner') && text.includes('slash-popup'), 'it holds the view and its styles');
	});

	test('the .vsix contains the bundle', () => {
		const out = cp.execFileSync(process.execPath, [require.resolve('@vscode/vsce/vsce'), 'ls', '--no-dependencies'], { cwd: root, encoding: 'utf8' });
		assert.ok(out.split('\n').some(l => l.trim() === 'dist/webview.js'), out);
		assert.ok(out.split('\n').some(l => l.trim() === 'dist/extension.js'));
	});

	test('the bundle runs in a page that has no node globals, mounts the chat and asks the core for the state', async () => {
		// a webview is a browser page: no `process`, no `require`; a bundle that reads either does not mount
		// (it did: React's `process.env.NODE_ENV` was left in, and the chat pane was blank in VS Code)
		const { JSDOM } = await import('jsdom');
		const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', { runScripts: 'outside-only', pretendToBeVisual: true });
		const sent: unknown[] = [];
		const errors: string[] = [];
		(dom.window as unknown as { acquireVsCodeApi: () => unknown }).acquireVsCodeApi = () => ({ postMessage: (m: unknown) => { sent.push(m); } });
		dom.window.addEventListener('error', e => errors.push(String(e.message)));
		dom.window.eval(fs.readFileSync(path.join(root, 'dist', 'webview.js'), 'utf8'));
		// the chat mounts, and asks for the state once React has run its effects
		for (let i = 0; i < 100 && !(dom.window.document.querySelector('.session-banner') && sent.length > 0); i++) { await new Promise(r => setTimeout(r, 20)); }
		assert.deepStrictEqual(errors, []);
		assert.ok(dom.window.document.querySelector('.session-banner'), 'the chat is mounted');
		assert.ok(dom.window.document.querySelector('.empty-state'), 'with no session it offers to connect');
		assert.strictEqual(JSON.stringify(sent), '[{"type":"ready"}]'); // objects made in the page's realm are not this realm's
		dom.window.close();
	});

	test('the earlier inline page is gone: no script, no stylesheet and no webview api in the provider', () => {
		const provider = fs.readFileSync(path.join(root, 'src', 'ui', 'ChatWebviewProvider.ts'), 'utf8');
		assert.ok(!/acquireVsCodeApi|<style>|addEventListener\('message'/.test(provider));
		assert.ok(provider.split('\n').length < 80, 'the provider only holds the page');
	});
});
