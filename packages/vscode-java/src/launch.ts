/** The `jawataJava.server` setting as the person writes it. */
export interface ServerSetting {
  command?: string;
  args?: string[];
  env?: Record<string, string>;
}

/** What to run for the language server, or the reason there is nothing to run, worded for the person who has to fix the setting. */
export type Launch =
  | { readonly ok: true; readonly command: string; readonly args: readonly string[]; readonly env: Readonly<Record<string, string>> }
  | { readonly ok: false; readonly why: string };

/** The one argument that makes the launcher forward a language client's messages; without it the program would be the agent's pipe or the engine itself. */
const LSP_FLAG = '--lsp';

/** Reads the setting. Nothing is guessed: a missing command or a missing `--lsp` is said, not defaulted. */
export function launchOf(setting: ServerSetting | undefined): Launch {
  const command = setting?.command?.trim() ?? '';
  if (command === '') {
    return { ok: false, why: 'Set jawataJava.server.command to the program that runs the jawata launcher (for example java with -jar <jawata.jar> --lsp --url <the engine address>).' };
  }
  const args = setting?.args ?? [];
  if (!args.includes(LSP_FLAG)) {
    return { ok: false, why: `jawataJava.server.args has no ${LSP_FLAG}, so the launcher would not forward the language server's messages.` };
  }
  return { ok: true, command, args, env: setting?.env ?? {} };
}

/** Which of the `rivals` (extensions that run a Java language server of their own) are among the `installed` extension identifiers; identifiers compare without regard to case. */
export function rivalsOf(installed: readonly string[], rivals: readonly string[]): string[] {
  const present = new Set(installed.map(id => id.toLowerCase()));
  return rivals.filter(id => present.has(id.toLowerCase()));
}

/** The sentence shown to the person when a rival is installed; it names every rival and what to do about it. */
export function rivalNotice(rivals: readonly string[]): string {
  return `jawata Java shares the editor with ${rivals.join(', ')}, which runs a Java language server of its own: two servers would read the same files and each would answer the editor. Switch ${rivals.length === 1 ? 'it' : 'them'} off for this workspace.`;
}
