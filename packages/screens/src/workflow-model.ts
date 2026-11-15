/**
 * What the Workflow screen draws, worked out from what the host answered (Sprint 28k, Amendment 3, Stage 25j): who hires whom as an org chart,
 * the studio's Workflow view as 28h released it. A move the engine would refuse is refused by the host with the engine's reason before it is
 * held, so the chart is always one the engine will load.
 */

/** One seat's place, with the changes held for Apply laid over what is stored. */
export interface WorkflowRow {
  readonly name: string;
  /** The word typed for it, without the slash, when it has one. */
  readonly command: string | null;
  /** The seat that hires it; absent for main and for a helper. */
  readonly parent: string | null;
  readonly role: string;
  /** Where a task it could not do goes next, when anywhere. */
  readonly escalatesTo: string | null;
  /** Whether the person moved it, held or applied: what Back to default takes back. */
  readonly placed: boolean;
  /** Why it has no place in the tree, for a helper of the principal; absent for a seat in the tree. */
  readonly helper: string | null;
}

/** What the host answers for the workflow. */
export interface WorkflowState {
  readonly rows: readonly WorkflowRow[];
  readonly errors: readonly string[];
  /** The rules a stored tree broke; the engine then uses the default tree. */
  readonly refusals: readonly string[];
}

/** The principal: nobody hires it. */
export const TOP = 'main';
const ROLES = ['lead', 'worker', 'reviewer'];
const ROLE_ORDER: Readonly<Record<string, number>> = { lead: 0, worker: 1, reviewer: 2 };

export const ROLE_HINT = 'Lead decides, worker changes code, reviewer only reads.';
export const LOCK_HINT = 'Locked: the tree can only be read. Unlocked: drag a seat onto another to move it with everything under it, '
  + 'click a role to change it, right-click a seat for where its failures go.';
export const BACK_HINT = 'Returns every seat to the default tree. Takes effect on Apply.';
export const TOP_HINT = 'The principal: the seat you talk to. Nobody hires it.';
export const HELPERS_HINT = 'They are not hired. Each helps the principal, and each says what starts it.';
export const FOLD_HINT = 'Show or hide the seats under this one.';
export const FAILS_HINT = 'Where a task this seat could not do goes next.';
export const REFUSAL_HINT = 'The engine refuses a tree that breaks a rule and uses the default one in its place.';
export const SEAT_BACK_HINT = 'Returns this seat to where the default tree puts it. Takes effect on Apply.';

/** The seats in the tree, without main's helpers. */
export const placedSeats = (state: WorkflowState): WorkflowRow[] => state.rows.filter(row => row.helper === null && row.name !== TOP);

/** The helpers beside main; btw is the side discussion and is not one. */
export const helpers = (state: WorkflowState): WorkflowRow[] => state.rows.filter(row => row.helper !== null && row.name !== 'btw');

/** The seats directly under `parent`, leads first, then by name; none when it is folded. */
function kids(parent: string, rows: readonly WorkflowRow[], folded: Readonly<Record<string, boolean>>): WorkflowRow[] {
  if (folded[parent]) { return []; }
  return rows.filter(row => row.parent === parent)
    .sort((a, b) => (ROLE_ORDER[a.role] ?? 9) - (ROLE_ORDER[b.role] ?? 9) || a.name.localeCompare(b.name));
}

/** Whether a seat has anyone under it, folded or not. */
export const hasKids = (name: string, rows: readonly WorkflowRow[]): boolean => rows.some(row => row.parent === name);

/** The seats under `parent` split as branches, which take width, and leaves, which stack in one column. */
export function parts(parent: string, rows: readonly WorkflowRow[], folded: Readonly<Record<string, boolean>>): { branches: WorkflowRow[]; leaves: WorkflowRow[] } {
  const children = kids(parent, rows, folded);
  return { branches: children.filter(row => hasKids(row.name, rows)), leaves: children.filter(row => !hasKids(row.name, rows)) };
}

/** Whether moving `seat` under `target` is a move at all: not onto itself, not where it is, and not under a seat below it. */
export function canDrop(seat: string, target: string, rows: readonly WorkflowRow[]): boolean {
  if (seat === target) { return false; }
  const moving = rows.find(row => row.name === seat);
  if (!moving || moving.parent === target) { return false; }
  for (let above: string | null = target; above !== null; above = rows.find(row => row.name === above)?.parent ?? null) {
    if (above === seat) { return false; }
  }
  return true;
}

/** The role after this one, as a click on the role moves through them. */
export const nextRole = (role: string): string => ROLES[(ROLES.indexOf(role) + 1) % ROLES.length];

/** The box's mouseover: what the person can tell from it at a glance. */
export function boxTitle(row: WorkflowRow): string {
  return [row.name, row.command ? `you type /${row.command}` : '', row.escalatesTo ? `if it fails, goes to ${row.escalatesTo}` : '',
    row.placed ? 'changed by you' : ''].filter(part => part !== '').join(', ');
}

/** The seats a task can go to when this one fails. */
export const failureTargets = (row: WorkflowRow, rows: readonly WorkflowRow[]): string[] =>
  rows.filter(other => other.name !== row.name && other.helper === null).map(other => other.name).sort();
