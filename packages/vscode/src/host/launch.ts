import { basename } from 'node:path';
import type { AgentConfigEntry } from '@jawata/chat-core';

/** What the decision about how to start the agent depends on; a test supplies its own. */
export interface LaunchContext {
  platform: string;
  env: Record<string, string | undefined>;
  exists(path: string): boolean;
}

/** How to start the agent: the program to run, its arguments, and whether the system shell is to resolve the name. */
export interface Launch {
  file: string;
  args: string[];
  /** Windows resolves `npx` and the like through its command interpreter, which `shell: true` asks for. */
  systemShell: boolean;
  /** The shell the person has that cannot be used, when another had to be taken in its place. */
  rejectedShell?: string;
}

/** The shells a command line can be handed to, and whether each takes `-l` (run as a login shell, so the person's profile is read). */
const SHELLS: Record<string, boolean> = { zsh: true, bash: true, ksh: true, fish: false, sh: false, dash: false };

const BASH_PLACES = ['/bin/bash', '/usr/bin/bash'];

/** A word as one shell word, whatever it holds. */
const asShellWord = (word: string): string => `'${word.split(`'`).join(`'\\''`)}'`;

function shellFor(ctx: LaunchContext): { shell: string; login: boolean; rejected?: string } {
  const own = ctx.env.SHELL;
  const takesLogin = own === undefined ? undefined : SHELLS[basename(own)];
  if (own !== undefined && takesLogin !== undefined) { return { shell: own, login: takesLogin }; }
  const bash = BASH_PLACES.find(place => ctx.exists(place));
  return bash ? { shell: bash, login: true, rejected: own } : { shell: '/bin/sh', login: false, rejected: own };
}

/**
 * Start the configured program the way the person's own shell would, so that tools their profile puts
 * on the PATH (nvm, Homebrew) are found by name. Windows has no such profile step: the command
 * interpreter resolves the name.
 */
export function launchFor(config: AgentConfigEntry, ctx: LaunchContext): Launch {
  const args = config.args ?? [];
  if (ctx.platform === 'win32') { return { file: config.command, args, systemShell: true }; }
  const { shell, login, rejected } = shellFor(ctx);
  const line = [config.command, ...args].map(asShellWord).join(' ');
  return { file: shell, args: [...(login ? ['-l'] : []), '-c', line], systemShell: false, ...(rejected === undefined ? {} : { rejectedShell: rejected }) };
}
