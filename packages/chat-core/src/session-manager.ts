import type {
  ContentBlock,
  NewSessionResponse,
  PromptResponse,
  SessionConfigOption,
  SessionInfo as ListedSession,
  SessionNotification,
} from '@agentclientprotocol/sdk';

import { AgentSupply, type LiveAgent } from './agent-supply.js';
import type { ConnectionManager } from './connection-manager.js';
import { Emitter } from './emitter.js';
import { logIn, needsLogin } from './login.js';
import type { HostPorts } from './ports.js';
import type { Disposable } from './view.js';
import type { TranscriptTurn } from './view-state.js';
import { SessionRegistry } from './session-registry.js';
import type { ChatSessions, SessionEvents, SessionInfo, SessionLifecycle } from './session-types.js';

export type { SessionEvents, SessionInfo } from './session-types.js';

type Needs = Pick<HostPorts, 'agents' | 'settings' | 'chooser' | 'log'>;

/** The shape of a `session/new`, `session/load` or `session/resume` answer, as far as the chat reads it. */
interface SessionAnswer {
  modes?: SessionInfo['modes'];
  models?: SessionInfo['models'];
  configOptions?: SessionConfigOption[] | null;
}

/**
 * The chat's sessions with its agent: opening, loading, resuming and ending them, the verbs of a
 * conversation, and the one place that records what the agent says about a session (its commands,
 * options and title), so a fact has a single writer. The pieces it is made of: a {@link SessionRegistry}
 * for the table, an {@link AgentSupply} for the running agent, and {@link logIn} for signing in.
 */
export class SessionManager extends Emitter<SessionEvents> implements ChatSessions, SessionLifecycle {
  private readonly table = new SessionRegistry();
  private readonly supply: AgentSupply;
  private readonly hearing: Disposable[];
  /** The connects under way, by agent: a second ask for the same agent shares the first. */
  private readonly connecting = new Map<string, Promise<SessionInfo>>();

  constructor(private readonly host: Needs, links: ConnectionManager) {
    super();
    this.supply = new AgentSupply(host, links);
    this.hearing = [
      this.supply.onUpdate(this.hear),
      this.supply.onEnded(this.processEnded),
      this.supply.onFailed(this.processFailed),
    ];
  }

  // --- opening and ending ---

  /** Connect to the agent and open a session with it; the session that is open already is reused, and so is a connect that is under way. */
  connectToAgent(agentName: string): Promise<SessionInfo> {
    const under = this.connecting.get(agentName);
    if (under) { return under; }
    const started = this.connectOnce(agentName).finally(() => { this.connecting.delete(agentName); });
    this.connecting.set(agentName, started);
    return started;
  }

  private async connectOnce(agentName: string): Promise<SessionInfo> {
    const held = this.table.ofAgent(agentName);
    if (held) {
      this.table.activate(held.sessionId);
      this.emit('active-session-changed', held.sessionId);
      return held;
    }
    const current = this.table.active;
    if (current) { await this.disconnectAgent(current.agentName); }

    this.host.log.log(`SessionManager: connecting to agent "${agentName}"`);
    const live = await this.supply.obtain(agentName);
    const cwd = this.host.settings.workspaceCwd();

    let answer: NewSessionResponse;
    try {
      answer = await this.signedInFor(live, () => live.connection.connection.newSession({ cwd, mcpServers: [] }));
    } catch (e) {
      this.host.log.logError('Failed to create session', e);
      this.supply.stop(live.agentId);
      throw e;
    }
    // registered at once, so an update the agent sends while its answer is still being read finds the session
    const session = this.describe(live, answer.sessionId, cwd, answer as SessionAnswer);
    this.table.add(session);
    this.table.activate(session.sessionId);

    this.emit('agent-connected', agentName);
    this.emit('active-session-changed', session.sessionId);
    this.host.log.log(`Connected to agent ${agentName}, session ${session.sessionId}`);
    return session;
  }

  /** End the session and open a fresh one with the same agent; the page is told to clear. */
  async newConversation(): Promise<SessionInfo | null> {
    const current = this.table.active;
    if (!current) { return null; }
    await this.disconnectAgent(current.agentName);
    this.emit('clear-chat');
    return this.connectToAgent(current.agentName);
  }

  /** End the agent's process and forget the session held with it. */
  async disconnectAgent(agentName: string): Promise<void> {
    const session = this.table.ofAgent(agentName);
    if (!session) { return; }
    this.host.log.log(`Disconnecting agent ${agentName}`);
    this.table.drop(session.sessionId);
    this.supply.stop(session.agentId);
    this.emit('agent-disconnected', agentName);
    this.emit('active-session-changed', null);
  }

  // --- sessions the agent already has ---

  /** The sessions the agent lists (`session/list`), a page at a time. */
  async listSessions(agentName: string, page: { cwd?: string; cursor?: string } = {}): Promise<{ sessions: ListedSession[]; nextCursor?: string }> {
    const live = await this.supply.obtain(agentName);
    if (!this.supply.capabilitiesOf(agentName)?.list) {
      throw new Error(`Agent "${agentName}" does not support session/list.`);
    }
    const request = { ...(page.cwd ? { cwd: page.cwd } : {}), ...(page.cursor ? { cursor: page.cursor } : {}) };
    const answer = await this.signedInFor(live, () => live.connection.connection.listSessions(request));
    return { sessions: answer?.sessions ?? [], nextCursor: answer?.nextCursor ?? undefined };
  }

  /**
   * Open a session the agent has by loading it (`session/load`): the agent replays the conversation as
   * updates, which reach the page between a load start and a load end.
   */
  async loadSession(agentName: string, sessionId: string): Promise<SessionInfo> {
    const live = await this.makeRoomFor(agentName, sessionId, 'load');
    const session = this.describe(live, sessionId, this.host.settings.workspaceCwd());
    // active before the replay begins: the replayed updates are for the active session, and are not dropped
    this.table.add(session);
    this.table.activate(sessionId);
    this.emit('agent-connected', agentName);
    this.emit('active-session-changed', sessionId);
    this.emit('session-load-start', sessionId, agentName);

    try {
      const answer = (await live.connection.connection.loadSession({ sessionId, cwd: session.cwd, mcpServers: [] })) as SessionAnswer;
      // the answer is the latest snapshot of the session's modes, models and options
      session.modes = answer.modes ?? null;
      session.models = answer.models ?? null;
      session.configOptions = answer.configOptions ?? null;
    } catch (e) {
      this.table.drop(sessionId);
      this.emit('session-load-end', sessionId, agentName, false);
      this.emit('active-session-changed', null);
      throw e;
    }
    this.emit('session-load-end', sessionId, agentName, true);
    return session;
  }

  /**
   * Open a session the agent has, the way the agent can: loaded where it can, resumed where it can only
   * do that. The decision is made here, once, from what the agent said it can do.
   */
  async open(agentName: string, sessionId: string): Promise<'loaded' | 'resumed'> {
    await this.supply.obtain(agentName);
    const can = this.supply.capabilitiesOf(agentName);
    if (can?.load) { await this.loadSession(agentName, sessionId); return 'loaded'; }
    if (can?.resume) { await this.resumeSession(agentName, sessionId); return 'resumed'; }
    throw new Error('the agent can neither load nor resume sessions');
  }

  /** Open a session the agent has without replaying it (`session/resume`). */
  private async resumeSession(agentName: string, sessionId: string): Promise<SessionInfo> {
    const live = await this.makeRoomFor(agentName, sessionId, 'resume');
    const cwd = this.host.settings.workspaceCwd();
    const answer = (await live.connection.connection.resumeSession({ sessionId, cwd, mcpServers: [] })) as SessionAnswer;

    const session = this.describe(live, sessionId, cwd, answer);
    this.table.add(session);
    this.table.activate(sessionId);
    this.emit('agent-connected', agentName);
    this.emit('active-session-changed', sessionId);
    return session;
  }

  // --- a conversation ---

  async sendPrompt(sessionId: string, text: string, files: string[] = []): Promise<PromptResponse> {
    const session = this.table.get(sessionId);
    if (!session) { throw new Error(`Session not found: ${sessionId}`); }
    const link = this.supply.linkOf(session.agentId);
    if (!link) { throw new Error(`No connection for agent: ${session.agentId}`); }

    this.host.log.log(`sendPrompt: session=${sessionId}, ${text.length} characters, ${files.length} file(s)`);
    const prompt: ContentBlock[] = [{ type: 'text', text }, ...files.map(fileLink)];
    const answer = await link.prompt({ sessionId, prompt });
    this.host.log.log(`Prompt response: stopReason=${answer.stopReason}`);
    return answer;
  }

  async cancelTurn(sessionId: string): Promise<void> {
    const link = this.linkOf(sessionId);
    if (!link) { return; }
    this.host.log.log(`Cancelling turn for session ${sessionId}`);
    await link.cancel({ sessionId });
  }

  async setMode(sessionId: string, modeId: string): Promise<void> {
    await this.choose(sessionId, 'mode', modeId);
  }

  async setModel(sessionId: string, modelId: string): Promise<void> {
    await this.choose(sessionId, 'model', modelId);
  }

  /**
   * Choose the session's mode or model. An agent that has an option for it (`configOptions`) is asked
   * through the option; one that has the older mode or model list is asked through its own request, and
   * the choice is then recorded in the session and announced.
   */
  private async choose(sessionId: string, what: 'mode' | 'model', value: string): Promise<void> {
    const session = this.table.get(sessionId);
    const option = session?.configOptions?.find(o => o.category === what);
    if (option) { await this.setConfigOption(sessionId, option.id, value); return; }
    const link = this.linkOf(sessionId);
    if (!session || !link) { return; }

    if (what === 'mode') {
      await link.setSessionMode({ sessionId, modeId: value });
      if (session.modes) { session.modes = { ...session.modes, currentModeId: value }; }
      this.emit('mode-changed', sessionId, value);
    } else {
      await (link as unknown as { unstable_setSessionModel(p: { sessionId: string; modelId: string }): Promise<unknown> }).unstable_setSessionModel({ sessionId, modelId: value });
      if (session.models) { session.models = { ...session.models, currentModelId: value }; }
      this.emit('model-changed', sessionId, value);
    }
  }

  /** Change one of the session's options; the agent answers with all of them, which replace ours. */
  async setConfigOption(sessionId: string, configId: string, value: string): Promise<SessionConfigOption[] | null> {
    const link = this.linkOf(sessionId);
    if (!link) { return null; }
    const answer = await link.setSessionConfigOption({ sessionId, configId, value });
    const options = (answer as { configOptions?: SessionConfigOption[] } | undefined)?.configOptions ?? null;
    this.noteOptions(sessionId, options);
    return options;
  }

  /** End one hired agent: the agent is asked, by the extension request the contract names (E4). */
  async stopHire(sessionId: string, planId: string): Promise<void> {
    const link = this.linkOf(sessionId);
    if (!link) { throw new Error(`No connection for session: ${sessionId}`); }
    this.host.log.log(`Stopping hire ${planId}`);
    await link.request('_jawata/hire/stop', { planId });
  }

  /** A hired agent's transcript, from the agent (E5): turns of a role and words. */
  async hireTranscript(sessionId: string, planId: string): Promise<TranscriptTurn[]> {
    const link = this.linkOf(sessionId);
    if (!link) { throw new Error(`No connection for session: ${sessionId}`); }
    const answer = await link.request<{ turns?: { role?: unknown; text?: unknown }[] }>('_jawata/hire/transcript', { planId });
    return (answer?.turns ?? []).map(t => ({ role: String(t.role ?? ''), text: String(t.text ?? '') }));
  }

  // --- reading ---

  getSession(sessionId: string): SessionInfo | undefined { return snapshotOf(this.table.get(sessionId)); }
  getActiveSession(): SessionInfo | undefined { return snapshotOf(this.table.active); }
  getActiveSessionId(): string | null { return this.table.activeSessionId; }
  getActiveAgentName(): string | null { return this.table.active?.agentName ?? null; }

  dispose(): void {
    this.hearing.forEach(h => h.dispose());
    this.supply.dispose();
    this.table.clear();
  }

  // --- what the agent says about a session: the only place it is written down ---

  private readonly hear = (notification: SessionNotification): void => {
    const id = notification.sessionId;
    const noted = this.table.note(notification);
    switch (noted?.kind) {
      case 'commands': this.emit('available-commands-changed', id, noted.commands); break;
      case 'options': this.emit('config-options-changed', id, noted.options); break;
      case 'title': this.emit('session-info-changed', id, { title: noted.title, updatedAt: noted.updatedAt }); break;
      case 'mode': this.emit('mode-changed', id, noted.modeId); break;
    }
  };

  private noteOptions(sessionId: string, options: SessionConfigOption[] | null): void {
    const session = this.table.setOptions(sessionId, options);
    if (session) { this.emit('config-options-changed', sessionId, session.configOptions); }
  }

  // --- the agent's process ---

  private readonly processEnded = (event: { agentId: string; code: number | null }): void => {
    const session = this.table.ofProcess(event.agentId);
    if (session) {
      this.table.drop(session.sessionId);
      this.emit('agent-disconnected', session.agentName);
      this.emit('active-session-changed', null);
    }
    this.emit('agent-closed', event.agentId, event.code);
  };

  private readonly processFailed = (event: { agentId: string; error: Error }): void => {
    this.emit('agent-error', event.agentId, event.error);
  };

  // --- shared steps ---

  private linkOf(sessionId: string) {
    const session = this.table.get(sessionId);
    return session ? this.supply.linkOf(session.agentId) : undefined;
  }

  private describe(live: LiveAgent, sessionId: string, cwd: string, answer: SessionAnswer = {}): SessionInfo {
    const who = live.connection.initResponse.agentInfo;
    return {
      sessionId,
      agentId: live.agentId,
      agentName: live.name,
      agentDisplayName: who?.title || who?.name || live.name,
      cwd,
      createdAt: new Date().toISOString(),
      initResponse: live.connection.initResponse,
      modes: answer.modes ?? null,
      models: answer.models ?? null,
      configOptions: answer.configOptions ?? null,
      availableCommands: [],
    };
  }

  /**
   * Run a request; if the agent answers that the person must sign in, sign in and run it once more.
   * A sign-in that fails or is declined ends the agent.
   */
  private async signedInFor<T>(live: LiveAgent, request: () => Promise<T>): Promise<T> {
    try {
      return await request();
    } catch (e) {
      if (!needsLogin(e)) { throw e; }
    }
    try {
      await logIn(live.connection.connection, { name: live.name, init: live.connection.initResponse }, this.host.chooser, this.host.log);
    } catch (e) {
      this.supply.stop(live.agentId);
      throw e;
    }
    return request();
  }

  /**
   * Get ready to open an existing session with an agent: end an active session with another agent,
   * start the agent, check it can do what is asked, and let go of this agent's previous session.
   */
  private async makeRoomFor(agentName: string, sessionId: string, how: 'load' | 'resume'): Promise<LiveAgent> {
    const active = this.table.active;
    if (active && active.agentName !== agentName) { await this.disconnectAgent(active.agentName); }

    const live = await this.supply.obtain(agentName);
    if (!this.supply.capabilitiesOf(agentName)?.[how]) {
      throw new Error(`Agent "${agentName}" does not support session/${how}.`);
    }
    const previous = this.table.active;
    if (previous && previous.sessionId !== sessionId) { this.table.drop(previous.sessionId); }
    return live;
  }
}

/**
 * A copy of a session that is the reader's own: changing it, at any depth, changes nothing here. The
 * facts a session holds are plain data, so a round trip through JSON copies them whole.
 */
function snapshotOf(session: SessionInfo | undefined): SessionInfo | undefined {
  return session && (JSON.parse(JSON.stringify(session)) as SessionInfo);
}

/** A file as the prompt carries it: a link the agent can read, which every agent accepts. */
function fileLink(path: string): ContentBlock {
  const slashed = path.replace(/\\/g, '/');
  const uri = 'file://' + encodeURI(slashed.startsWith('/') ? slashed : '/' + slashed);
  return { type: 'resource_link', uri, name: slashed.split('/').pop() || path };
}

