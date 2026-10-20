import type { AvailableCommand, SessionConfigOption, SessionNotification } from '@agentclientprotocol/sdk';
import type { SessionInfo } from './session-types.js';

/** What an agent said about a session before the chat had the session in its table. */
interface Held {
  commands?: AvailableCommand[];
  options?: SessionConfigOption[];
  title?: string;
  modeId?: string;
}

/** What an update changed about a session the chat holds; nothing, when it changed no fact the chat keeps. */
export type Noted =
  | { kind: 'commands'; commands: AvailableCommand[] }
  | { kind: 'options'; options: SessionConfigOption[] | null }
  | { kind: 'title'; title: string | null | undefined; updatedAt: string | null | undefined }
  | { kind: 'mode'; modeId: string };

/**
 * The sessions the chat holds, the one that is active, and the facts that arrived too early.
 *
 * An agent may announce a session's commands or title in the very moment its answer to `session/new`
 * is on the way, before the chat has registered the session. Such a fact is held and becomes part of
 * the session when it is added, so none is lost. This is a plain table: it speaks to no agent.
 */
export class SessionRegistry {
  private readonly sessions = new Map<string, SessionInfo>();
  private activeId: string | null = null;
  private readonly early = new Map<string, Held>();

  add(info: SessionInfo): void {
    const held = this.early.get(info.sessionId);
    if (held) {
      this.early.delete(info.sessionId);
      if (held.commands) { info.availableCommands = held.commands; }
      if (held.options) { info.configOptions = held.options; }
      if (held.title !== undefined) { info.title = held.title; }
      if (held.modeId !== undefined && info.modes) { info.modes = { ...info.modes, currentModeId: held.modeId }; }
    }
    this.sessions.set(info.sessionId, info);
  }

  /** Forget a session; if it was the active one, nothing is active. */
  drop(sessionId: string): void {
    this.sessions.delete(sessionId);
    if (this.activeId === sessionId) { this.activeId = null; }
  }

  get(sessionId: string): SessionInfo | undefined {
    return this.sessions.get(sessionId);
  }

  activate(sessionId: string | null): void {
    this.activeId = sessionId;
  }

  get active(): SessionInfo | undefined {
    return this.activeId ? this.sessions.get(this.activeId) : undefined;
  }

  get activeSessionId(): string | null {
    return this.activeId;
  }

  /** The session held with the agent of this name, if any. */
  ofAgent(agentName: string): SessionInfo | undefined {
    return [...this.sessions.values()].find(s => s.agentName === agentName);
  }

  /** The session held with the agent process of this id, if any. */
  ofProcess(agentId: string): SessionInfo | undefined {
    return [...this.sessions.values()].find(s => s.agentId === agentId);
  }

  /**
   * Write down what an update from the agent says about a session: its commands, options, title, or
   * current mode. The one entry for every such fact; a fact that arrives before the session is held.
   * Returns what changed, or nothing when the update says none of these things.
   */
  note(notification: SessionNotification): Noted | undefined {
    const id = notification.sessionId;
    const update = notification.update;
    switch (update.sessionUpdate) {
      case 'available_commands_update': {
        const commands = update.availableCommands as AvailableCommand[];
        return this.setCommands(id, commands) ? { kind: 'commands', commands } : undefined;
      }
      case 'config_option_update':
        return this.noteOptions(id, update.configOptions as SessionConfigOption[]) ? { kind: 'options', options: update.configOptions as SessionConfigOption[] } : undefined;
      case 'session_info_update':
        this.setTitle(id, update.title);
        return { kind: 'title', title: update.title, updatedAt: update.updatedAt };
      case 'current_mode_update':
        return this.setMode(id, update.currentModeId) ? { kind: 'mode', modeId: update.currentModeId } : undefined;
      default:
        return undefined;
    }
  }

  /** The answer to `session/load`: the latest snapshot of the session's modes, models and options, which replaces what was held. */
  noteAnswer(sessionId: string, answer: { modes?: SessionInfo['modes']; models?: SessionInfo['models']; configOptions?: SessionInfo['configOptions'] }): void {
    const session = this.sessions.get(sessionId);
    if (!session) { return; }
    session.modes = answer.modes ?? null;
    session.models = answer.models ?? null;
    session.configOptions = answer.configOptions ?? null;
  }

  /** The mode or the model the chat itself has just asked the agent for, on an agent that has the older lists: the session's current one. */
  noteChosen(sessionId: string, what: 'mode' | 'model', value: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) { return; }
    if (what === 'mode') {
      if (session.modes) { session.modes = { ...session.modes, currentModeId: value }; }
    } else if (session.models) { session.models = { ...session.models, currentModelId: value }; }
  }

  /** Set the mode the agent is in, or hold it until the session exists. Returns the session when it took it. */
  private setMode(sessionId: string, modeId: string): SessionInfo | undefined {
    const session = this.sessions.get(sessionId);
    if (!session) { this.holdFor(sessionId).modeId = modeId; return undefined; }
    if (session.modes) { session.modes = { ...session.modes, currentModeId: modeId }; }
    return session;
  }

  /** Set a session's commands, or hold them until it exists. Returns the session when it took them. */
  private setCommands(sessionId: string, commands: AvailableCommand[]): SessionInfo | undefined {
    const session = this.sessions.get(sessionId);
    if (session) { session.availableCommands = commands; } else { this.holdFor(sessionId).commands = commands; }
    return session;
  }

  /** Set a session's options, from the agent's update or from its answer to a change the chat asked for, or hold them until the session exists. Returns the session when it took them. */
  noteOptions(sessionId: string, options: SessionConfigOption[] | null): SessionInfo | undefined {
    const session = this.sessions.get(sessionId);
    if (session) { session.configOptions = options; } else { this.holdFor(sessionId).options = options ?? []; }
    return session;
  }

  /** Set a session's title (null removes it), or hold a title until the session exists. */
  private setTitle(sessionId: string, title: string | null | undefined): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      if (typeof title === 'string') { this.holdFor(sessionId).title = title; }
      return;
    }
    if (title === null) { delete session.title; } else if (typeof title === 'string') { session.title = title; }
  }

  clear(): void {
    this.sessions.clear();
    this.early.clear();
    this.activeId = null;
  }

  private holdFor(sessionId: string): Held {
    const held = this.early.get(sessionId) ?? {};
    this.early.set(sessionId, held);
    return held;
  }
}
