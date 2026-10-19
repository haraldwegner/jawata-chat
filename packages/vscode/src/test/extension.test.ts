import * as assert from 'assert';
import * as vscode from 'vscode';

const ID = 'jawata.jawata-chat';

suite('The extension loads', () => {
	test('it is installed in the editor under its id', () => {
		assert.ok(vscode.extensions.getExtension(ID), `${ID} is not installed`);
	});

	test('it activates', async () => {
		const extension = vscode.extensions.getExtension(ID);
		assert.ok(extension);
		await extension.activate();
		assert.strictEqual(extension.isActive, true);
	});

	test('the commands a person starts a chat with are registered', async () => {
		const ours = (await vscode.commands.getCommands(true)).filter(c => c.startsWith('jawataChat.'));
		for (const command of ['connectAgent', 'newConversation', 'openChat']) {
			assert.ok(ours.includes(`jawataChat.${command}`), `jawataChat.${command} is not registered`);
		}
	});
});
