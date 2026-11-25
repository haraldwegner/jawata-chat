import type { LastConversation, LastConversationStore } from '@jawata/chat-core';

const KEY = 'lastConversation';

/** The part of VS Code's workspace storage this needs; `context.workspaceState` is one. */
interface WindowState {
  get<T>(key: string): T | undefined;
  update(key: string, value: unknown): PromiseLike<void>;
}

/**
 * This window's last conversation, kept in the extension's storage for the workspace the window has open, so that each window comes back
 * to its own after a restart. A window with no folder open has no workspace of its own to keep it under: it remembers nothing.
 */
export class LastConversationState implements LastConversationStore {
  /** @param onError told when it could not be written; the chat goes on */
  constructor(
    private readonly state: WindowState,
    private readonly folderOpen: () => boolean,
    private readonly onError: (message: string, error: unknown) => void,
  ) {}

  load(): LastConversation | undefined {
    if (!this.folderOpen()) { return undefined; }
    const kept = this.state.get<{ sessionId?: unknown; agent?: unknown } | null>(KEY);
    if (typeof kept?.sessionId !== 'string' || kept.sessionId === '') { return undefined; }
    return { sessionId: kept.sessionId, ...(typeof kept.agent === 'string' ? { agent: kept.agent } : {}) };
  }

  save(last: LastConversation | undefined): void {
    if (!this.folderOpen()) { return; }
    this.state.update(KEY, last).then(undefined, e => { this.onError('the last conversation of this window could not be written', e); });
  }
}
