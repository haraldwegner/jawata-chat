import type { ViewSession } from './view.js';

/**
 * The id of the session's autocontinue switch (CR1; provisional until 28h's D19 names the field): a plain ACP select option with the
 * values `off` and `on`, so an editor that knows nothing of jawata shows it as it shows any selector.
 */
export const AUTONOMY_OPTION = 'autonomy';

/** Whether the session's autocontinue grant is armed, as the agent last reported it; null when the session carries no such option. */
export function autonomyOf(session: ViewSession | null | undefined): { armed: boolean } | null {
  for (const option of session?.configOptions ?? []) {
    if (option.id === AUTONOMY_OPTION && option.type === 'select') { return { armed: option.currentValue === 'on' }; }
  }
  return null;
}
