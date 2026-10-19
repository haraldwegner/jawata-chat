import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Everything the chat tells its page passes the one ViewPort: no other production file posts to a
 * webview. (The page's own `vscode.postMessage` calls inside the page's script are the other
 * direction and are not host code.)
 */
suite('One port to the page', () => {
	const src = path.join(__dirname, '..', '..', 'src');
	const production = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
		const p = path.join(dir, e.name);
		if (e.isDirectory()) { return e.name.startsWith('test') ? [] : production(p); }
		return p.endsWith('.ts') && e.name !== 'ViewPort.ts' ? [p] : [];
	});

	test('no production file but ViewPort.ts posts to a webview', () => {
		const files = production(src);
		assert.ok(files.length > 5, `found ${files.length} files`);
		for (const f of files) {
			const text = fs.readFileSync(f, 'utf8');
			assert.ok(!/\bwebview\.postMessage\(/.test(text), `${path.relative(src, f)} posts to a webview directly`);
		}
	});
});
