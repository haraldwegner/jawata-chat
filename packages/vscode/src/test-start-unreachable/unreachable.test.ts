import * as assert from 'assert';
import * as vscode from 'vscode';
import type { JawataChatApi } from '../extension';
import type { VscodeNotifier } from '../host/VscodeNotifier';

/**
 * 28h D57 (e), in a VS Code started for it (`.vscode-test.mjs`, label `start-unreachable`): the workspace's settings name the jawata agent's
 * own bridge (`java -jar jawata.jar --acp`) with an engine address nothing listens at. The chat still opens with the window, and what the person
 * is told is one sentence that says why it is not connected and what to do.
 */
suite('The chat says why it is not connected at start', function () {
	this.timeout(120000);

	test('with the engine stopped, the person is told why in one sentence', async () => {
		const api = (await vscode.extensions.getExtension<JawataChatApi | undefined>('jawata.jawata-chat')!.activate())!;
		await api.started;

		assert.ok(api.chat.hasPage, 'the chat is open');
		assert.ok(!api.sessionManager.getActiveSession(), 'no session is open');
		const told = (api.host.notifier as VscodeNotifier).told;
		const reason = told.find(line => line.includes('does not answer'));
		assert.ok(reason, `the person was told why: ${JSON.stringify(told)}`);
		assert.ok(reason.includes('start the jawata studio'), `and what to do: ${reason}`);
		assert.ok(!reason.includes('\n') && !reason.includes('Exception'), `in one sentence, no stack trace: ${reason}`);
	});
});
