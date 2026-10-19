import { RequestError } from '@agentclientprotocol/sdk';
import type { InitializeResponse } from '@agentclientprotocol/sdk';
import type { AgentLink } from './agent-link.js';
import type { Chooser, Log } from './ports.js';

/** ACP's error code for "authenticate first". */
const AUTH_REQUIRED = -32000;

/** Whether an error an agent answered with means that the person has to sign in first. */
export function needsLogin(error: unknown): boolean {
  const e = error as { code?: number; message?: unknown } | null;
  return error instanceof RequestError && error.code === AUTH_REQUIRED
    || e?.code === AUTH_REQUIRED
    || (typeof e?.message === 'string' && /auth.?required/i.test(e.message));
}

/**
 * Sign in to an agent that asked for it: the agent's own methods, one chosen by the person (or
 * confirmed, when there is only one). Throws if the agent offers none, the person declines, or the
 * agent refuses; the caller then ends the agent.
 */
export async function logIn(
  link: AgentLink,
  agent: { name: string; init: InitializeResponse },
  ask: Chooser,
  log: Log,
): Promise<void> {
  const methods = agent.init.authMethods ?? [];
  if (methods.length === 0) {
    throw new Error(`Agent "${agent.name}" requires authentication but did not advertise any auth methods.`);
  }
  log.log(`Agent requires authentication. Methods: ${methods.map(m => m.name).join(', ')}`);

  const method = methods.length === 1
    ? ((await ask.confirmAuthMethod(agent.name, methods[0])) ? methods[0] : undefined)
    : await ask.chooseAuthMethod(agent.name, methods);
  if (!method) { throw new Error('Authentication cancelled by user.'); }

  try {
    log.log(`Authenticating with method: ${method.name} (${method.id})`);
    await link.authenticate({ methodId: method.id });
    log.log('Authentication successful');
  } catch (e) {
    log.logError('Authentication failed', e);
    throw new Error(`Authentication failed: ${(e as Error).message}`);
  }
}
