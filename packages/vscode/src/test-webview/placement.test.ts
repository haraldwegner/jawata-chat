import * as assert from 'assert';
import * as vscode from 'vscode';
import type { JawataChatApi } from '../extension';

/**
 * The real page, in a real webview, in an editor of its own where no other test has put a port in the view's place.
 * The page can only be reached through what it sends, so each test waits for the page to say `ready` (it does so once
 * its bundle has loaded under the page's security policy and React has mounted). The defect this guards: a page that
 * does not load shows a blank pane, and nothing else in the suite looks at the real page.
 *
 * Placement: for each of the four places the setting names, the command opens the chat there, and the page mounts
 * and says ready. The chat is in one place at a time, so each is checked against the places that have said ready
 * so far: a place that opened another place, or nothing, shows. The editor takes the setting into the places that
 * exist (a view of another place is not there), so the test waits a moment after changing it.
 */
suite('Placement', function () {
	this.timeout(60000);
	const config = () => vscode.workspace.getConfiguration('jawataChat');
	const api = async () => (await vscode.extensions.getExtension<JawataChatApi | undefined>('jawata.jawata-chat')!.activate())!;
	const webviewTabs = () => vscode.window.tabGroups.all.flatMap(g => g.tabs).filter(t => t.input instanceof vscode.TabInputWebview);

	suiteTeardown(async () => { await config().update('placement', undefined, vscode.ConfigurationTarget.Global); });

	async function opensIn(place: 'left' | 'right' | 'bottom' | 'center', expectedBefore: string[]): Promise<void> {
		const { readyPlaces } = await api();
		assert.deepStrictEqual([...readyPlaces], expectedBefore, 'a page had said ready where it was not asked for');
		await config().update('placement', place, vscode.ConfigurationTarget.Global);
		await new Promise(r => setTimeout(r, 300)); // the editor takes the setting into the places that exist
		await vscode.commands.executeCommand('jawataChat.openChat');
		for (let i = 0; i < 200 && readyPlaces.length === expectedBefore.length; i++) { await new Promise(r => setTimeout(r, 100)); }
		assert.deepStrictEqual([...readyPlaces], [...expectedBefore, place], `the chat did not open in the ${place}`);
	}

	test('left: the side bar; the page is given the state it shows when it says ready', async () => {
		const chat = (await api()).chat;
		let snapshots = 0;
		const snapshot = chat.snapshot.bind(chat);
		chat.snapshot = () => { snapshots++; return snapshot(); };
		await opensIn('left', []);
		assert.ok(snapshots >= 1, 'on ready the chat gave the page its state');
	});
	test('right: the secondary side bar', () => opensIn('right', ['left']));
	test('bottom: the panel', () => opensIn('bottom', ['left', 'right']));

	test('center: a tab in the editor area, and only this one is a tab', async () => {
		assert.strictEqual(webviewTabs().length, 0, 'the other places are views, not tabs');
		await opensIn('center', ['left', 'right', 'bottom']);
		assert.strictEqual(webviewTabs().length, 1, 'the chat is a tab in the editor area');
		await vscode.commands.executeCommand('jawataChat.openChat');
		assert.strictEqual(webviewTabs().length, 1, 'opening it again shows the one tab, not another');
	});
});
