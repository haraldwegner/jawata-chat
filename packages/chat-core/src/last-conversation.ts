import type { SessionConfigOption } from '@agentclientprotocol/sdk';

import type { HostPorts, LastConversation } from './ports.js';

/** The option of a session that holds the principal's brain: the agent a conversation is held with. */
export const PRINCIPAL_BRAIN_OPTION = 'principal-brain';

/** What of a session is remembered: its id, and the options its agent is read from. */
interface Shown {
  sessionId: string;
  configOptions: SessionConfigOption[] | null;
}

/** The agent a session is on, as the session's options name it (`brain` or `brain|model`); undefined when they name none. */
export function agentOf(session: Shown | undefined): string | undefined {
  const option = session?.configOptions?.find(o => o.id === PRINCIPAL_BRAIN_OPTION);
  return option?.type === 'select' && option.currentValue ? option.currentValue : undefined;
}

/** Whether a session reported to be on `now` is on `wanted` already: the same choice, or the wanted brain with some model of it. */
export function isOn(now: string | undefined, wanted: string): boolean {
  return now === wanted || (now?.startsWith(`${wanted}|`) ?? false);
}

/**
 * The window's memory of its last conversation, over the host's store: what was read or written last, so that a change to that
 * conversation can be told from a change to another. A store that fails is logged; the chat then behaves as with nothing remembered.
 */
export class LastConversationMemory {
  private kept: LastConversation | undefined;

  constructor(private readonly host: Pick<HostPorts, 'lastConversation' | 'log'>) {}

  /** What the window remembers; undefined when nothing, or when it cannot be read. */
  recall(): LastConversation | undefined {
    try {
      this.kept = this.host.lastConversation?.load();
    } catch (e) {
      this.host.log.logError('The last conversation of this window could not be read', e);
      this.kept = undefined;
    }
    return this.kept;
  }

  /** Whether this session is the remembered one. */
  holds(sessionId: string): boolean {
    return this.kept?.sessionId === sessionId;
  }

  /**
   * Remember this session and the agent it is on. `picked` is the person's own choice of agent, taken as it is. Without it the session's
   * options are read, and an agent that names the remembered brain without a model (it does until that brain's own session is open) does
   * not erase the remembered model.
   */
  keep(session: Shown, picked?: string): void {
    const before = this.holds(session.sessionId) ? this.kept?.agent : undefined;
    const now = picked ?? agentOf(session);
    const agent = !picked && now && before?.startsWith(`${now}|`) ? before : now ?? before;
    if (this.holds(session.sessionId) && this.kept?.agent === agent) { return; }
    this.write({ sessionId: session.sessionId, ...(agent ? { agent } : {}) });
  }

  /** Nothing is to come back. */
  forget(): void {
    this.write(undefined);
  }

  private write(last: LastConversation | undefined): void {
    this.kept = last;
    try {
      this.host.lastConversation?.save(last);
    } catch (e) {
      this.host.log.logError('The last conversation of this window could not be kept', e);
    }
  }
}
