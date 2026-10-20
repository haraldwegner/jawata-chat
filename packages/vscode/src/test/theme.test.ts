import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { THEME_INPUTS, themeCss } from '../ui/theme';

/**
 * The view reads neutral theme inputs (`--jc-host-*`) and names no editor variable; the extension is the one that says which
 * editor variable each input is. Both ways: an input the view reads has a mapping, and a mapping is an input the view reads.
 */
suite('The editor supplies exactly the theme inputs the view reads', () => {
	const bundle = fs.readFileSync(path.join(__dirname, '..', '..', 'dist', 'webview.js'), 'utf8');
	const read = [...new Set(bundle.match(/--jc-host-[a-z-]+/g) ?? [])].sort();

	test('every input the built view reads is set, and every input set is read', () => {
		assert.ok(read.length > 10, 'the view reads its theme inputs');
		assert.deepStrictEqual([...THEME_INPUTS].sort(), read);
	});

	test('each is set from an editor variable, and the built view names none of them', () => {
		for (const input of THEME_INPUTS) { assert.match(themeCss(), new RegExp(`${input}: var\\(--vscode-[A-Za-z-]+\\);`), input); }
		assert.ok(!/--vscode-/.test(bundle), 'the built view names an editor theme variable');
	});
});
