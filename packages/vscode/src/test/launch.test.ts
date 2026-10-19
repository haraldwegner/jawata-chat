import * as assert from 'assert';
import { launchFor, type LaunchContext } from '../host/launch';

const unix = (env: Record<string, string>, present: string[] = []): LaunchContext => ({ platform: 'linux', env, exists: p => present.includes(p) });
const agent = { command: 'npx', args: ['-y', 'some pkg', "it's"] };

/** How the agent is started: through the person's login shell where there is one, so their profile's PATH is used. */
suite('How the agent is started', () => {
	test('a shell that takes -l is run as a login shell, with the command line as one quoted string', () => {
		for (const shell of ['/usr/bin/zsh', '/bin/bash', '/usr/bin/ksh']) {
			const how = launchFor(agent, unix({ SHELL: shell }));
			assert.deepStrictEqual(how.args.slice(0, 2), ['-l', '-c'], shell);
			assert.strictEqual(how.file, shell);
			assert.strictEqual(how.args[2], `'npx' '-y' 'some pkg' 'it'\\''s'`, 'every word is one shell word, whatever it holds');
			assert.strictEqual(how.rejectedShell, undefined);
		}
	});

	test('a shell that does not take -l is run without it', () => {
		for (const shell of ['/usr/bin/fish', '/bin/dash', '/bin/sh']) {
			const how = launchFor(agent, unix({ SHELL: shell }));
			assert.deepStrictEqual(how.args.slice(0, 1), ['-c'], shell);
			assert.strictEqual(how.file, shell);
		}
	});

	test('a shell the chat cannot hand a command line to is replaced by bash if there is one, and the log is told which was rejected', () => {
		const how = launchFor(agent, unix({ SHELL: '/bin/tcsh' }, ['/usr/bin/bash']));
		assert.strictEqual(how.file, '/usr/bin/bash');
		assert.deepStrictEqual(how.args.slice(0, 2), ['-l', '-c']);
		assert.strictEqual(how.rejectedShell, '/bin/tcsh');
	});

	test('with no shell known and no bash, plain sh is used, without -l', () => {
		const how = launchFor(agent, unix({}));
		assert.strictEqual(how.file, '/bin/sh');
		assert.strictEqual(how.args[0], '-c');
		assert.strictEqual(how.rejectedShell, undefined);
	});

	test('Windows hands the program and its arguments to the command interpreter, and no profile is read', () => {
		const how = launchFor(agent, { platform: 'win32', env: {}, exists: () => false });
		assert.deepStrictEqual([how.file, how.args, how.systemShell], ['npx', ['-y', 'some pkg', "it's"], true]);
	});
});
