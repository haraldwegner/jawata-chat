import { withEngine, type EngineAnswer } from './studio';

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

/**
 * Reads the setting. Nothing is guessed: a missing command or a missing `--lsp` is said, not defaulted. When the studio named an engine for
 * this window, its address and key replace `JAWATA_URL` and `JAWATA_KEY` in the environment of this launch and of no other.
 */
export function launchOf(setting: ServerSetting | undefined, engine?: EngineAnswer): Launch {
  const command = setting?.command?.trim() ?? '';
  if (command === '') {
    return { ok: false, why: 'Set jawataJava.server.command to the program that runs the jawata launcher (for example java with -jar <jawata.jar> --lsp --url <the engine address>).' };
  }
  const args = setting?.args ?? [];
  if (!args.includes(LSP_FLAG)) {
    return { ok: false, why: `jawataJava.server.args has no ${LSP_FLAG}, so the launcher would not forward the language server's messages.` };
  }
  return { ok: true, command, args, env: withEngine(setting?.env, engine) ?? {} };
}

/** The one argument that makes the launcher carry a debug adapter's messages instead of a language client's. */
const DAP_FLAG = '--dap';

/**
 * What to run for the person's debugger: the same launcher, engine and environment as the language server, with the debug flag where the language
 * flag was. The debugger is the engine's own face, so it needs no setting of its own; a setting the language server would refuse is refused in the
 * same words.
 */
export function debugLaunchOf(setting: ServerSetting | undefined, engine?: EngineAnswer): Launch {
  const launch = launchOf(setting, engine);
  if (!launch.ok) { return launch; }
  return { ...launch, args: launch.args.map(arg => (arg === LSP_FLAG ? DAP_FLAG : arg)) };
}

/** An installed extension as the rival notice needs it: its identifier, the name the person sees, and the identifiers it depends on. */
export interface InstalledExtension {
  readonly id: string;
  readonly name: string;
  readonly dependsOn: readonly string[];
}

/** The rivals that are installed, and every installed extension that needs one of them, directly or through another. */
export interface RivalRemoval {
  readonly rivals: readonly InstalledExtension[];
  readonly dependents: readonly InstalledExtension[];
}

const same = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();

/**
 * Which of the `rivals` (extensions that run a Java language server of their own) are `installed`, with the installed extensions that
 * need them; null when none is installed. Identifiers compare without regard to case.
 */
export function rivalRemovalOf(installed: readonly InstalledExtension[], rivals: readonly string[]): RivalRemoval | null {
  const found = installed.filter(e => rivals.some(r => same(r, e.id)));
  if (found.length === 0) { return null; }
  const going = new Set(found.map(e => e.id.toLowerCase()));
  const dependents: InstalledExtension[] = [];
  for (let grew = true; grew;) {
    grew = false;
    for (const e of installed) {
      if (!going.has(e.id.toLowerCase()) && e.dependsOn.some(d => going.has(d.toLowerCase()))) {
        going.add(e.id.toLowerCase());
        dependents.push(e);
        grew = true;
      }
    }
  }
  return { rivals: found, dependents };
}

const named = (list: readonly InstalledExtension[]): string => list.map(e => `${e.name} (${e.id})`).join(', ');

/** What the person is told when a rival is installed: what is wrong and what to do, naming the rival and each extension that goes with it. */
export function rivalNotice(removal: RivalRemoval): string {
  const one = removal.rivals.length === 1;
  const them = one ? 'it' : 'them';
  const with_ = removal.dependents.length === 0 ? '' : `, together with the extensions that need ${them}: ${named(removal.dependents)}`;
  return `${named(removal.rivals)} ${one ? 'is' : 'are'} still installed and ${one ? 'starts' : 'start'} a second Java server, so the editor gets two answers for every Java file. Uninstall ${them}${with_}.`;
}

/** The order the button uninstalls in: an extension only after everything that needs it, the rivals last, so the editor refuses none. */
export function uninstallOrder(removal: RivalRemoval): string[] {
  const left = [...removal.dependents];
  const order: string[] = [];
  while (left.length > 0) {
    const needed = (e: InstalledExtension) => left.some(other => other !== e && other.dependsOn.some(d => same(d, e.id)));
    const free = left.filter(e => !needed(e));
    const next = free.length > 0 ? free : [...left]; // a cycle among them: the editor is asked as they come
    for (const e of next) { order.push(e.id); left.splice(left.indexOf(e), 1); }
  }
  return [...order, ...removal.rivals.map(e => e.id)];
}
