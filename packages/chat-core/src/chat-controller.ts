import type { RequestPermissionRequest, RequestPermissionResponse, SessionNotification } from '@agentclientprotocol/sdk';

import type { ConversationFlow } from './conversation-flow.js';
import { AGENT_KEY, type HostPorts } from './ports.js';
import type { ChatSessions, SessionEvents, SessionInfo } from './session-types.js';
import type { AgentUpdates, UpdateListener } from './agent-updates.js';
import { VIEW_CONTRACT_VERSION, isViewIntent, type Disposable, type ViewIntent, type ViewMessage, type ViewPort } from './view.js';
import { initialViewState, reduce, reduceAll, type ViewState } from './view-state.js';

/**
 * The chat as the core runs it (architecture S4: a reducer from ACP updates and the page's intents to
 * the stream of messages the page is told). It owns the conversation (the transcript), the turn, the
 * permission round trip through the session manager; it reaches a page only through a {@link ViewPort}
 * and the host only through its ports. The operations the person starts on the conversation are the
 * {@link ConversationFlow} it is given.
 */
export class ChatController {
  private port?: ViewPort;
  private portSubscriptions: Disposable[] = [];
  /** What the page shows, folded as the core posts: a page that comes later is given it. */
  private view: ViewState = initialViewState();
  /** Prompts typed during a turn, with the paths of their files, in the order they were typed; the page is shown them as `queued`. */
  private pending: { text: string; paths: string[] }[] = [];
  /** While a session is loaded, the updates of its replay wait here and are folded in one pass when the load ends. */
  private replay: ViewMessage[] | null = null;
  /** The session the waiting prompts were typed in: they are not sent to another. */
  private pendingIn: string | null = null;
  private readonly updateListener: UpdateListener;
  private readonly hearing: Disposable;
  private readonly asking: Disposable;
  /** Proposals shown to the person and not yet answered, by request. */
  private readonly unanswered = new Map<string, { resolve: (answer: RequestPermissionResponse) => void; optionIds: string[] }>();
  private proposals = 0;
  private readonly unsubscribe: (() => void)[] = [];

  /**
   * @param flow connect, new conversation, restart, disconnect and open: the one route for the page's intents
   *   and the host's commands. It asks the controller whether messages would be lost, so it is built with a
   *   closure over the controller (`() => chat.hasChatContent`) and given here.
   */
  constructor(
    private readonly sessions: ChatSessions,
    private readonly updates: AgentUpdates,
    private readonly host: Pick<HostPorts, 'log' | 'actions'>,
    readonly flow: ConversationFlow,
  ) {
    this.updateListener = (update) => this.handleSessionUpdate(update);
    this.hearing = this.updates.onUpdate(this.updateListener);
    this.asking = this.updates.onPermissionRequest(request => this.askPermission(request));

    this.listen('active-session-changed', (sessionId) => {
      if (sessionId !== this.pendingIn) { this.pending = []; this.pendingIn = sessionId; this.withdrawProposals(); }
      this.sendCurrentState();
    });
    this.listen('clear-chat', () => this.clearChat());
    this.listen('mode-changed', () => {
      const modes = this.sessions.getActiveSession()?.modes;
      if (modes) { this.post({ type: 'modesUpdate', modes }); }
    });
    this.listen('model-changed', () => {
      const models = this.sessions.getActiveSession()?.models;
      if (models) { this.post({ type: 'modelsUpdate', models }); }
    });
    this.listen('session-load-start', () => { this.pending = []; this.post({ type: 'loadSessionStart' }); this.replay = []; });
    this.listen('session-load-end', (_sessionId, _agentName, ok) => {
      this.endReplay();
      this.post({ type: 'loadSessionEnd', ok });
      // the answer to a load carries modes, models and options of the restored session: tell the page
      // again, because the `active-session-changed` before it came while those were still unknown
      if (ok) { this.sendCurrentState(); }
    });
    this.listen('session-info-changed', (sessionId, update) => {
      if (sessionId !== this.sessions.getActiveSessionId()) { return; }
      this.post({ type: 'sessionInfoUpdate', title: update.title ?? null });
    });
  }

  /** Listen to one of the sessions' events; {@link dispose} lets go of it. */
  private listen<K extends keyof SessionEvents>(event: K, listener: (...args: SessionEvents[K]) => void): void {
    this.sessions.on(event, listener);
    this.unsubscribe.push(() => this.sessions.off(event, listener));
  }

  /** What the page shows now: the folded state a late page is given. */
  snapshot(): ViewState {
    return this.view;
  }

  /**
   * Use this port to reach the page, in place of any port attached before. Dispose the result to let
   * go of it. A host with a page, or a test, attaches its own. The core serves ONE page at a time: a
   * port that is replaced is no longer told anything and does not hear it was replaced (the log says
   * so); a host that shows more than one page needs a fan-out of its own (28k, 32).
   */
  attach(port: ViewPort): Disposable {
    if (this.port && this.port !== port) {
      this.host.log.log('ChatController: a port was replaced by another; the earlier page is no longer told anything');
    }
    this.portSubscriptions.forEach(s => s.dispose());
    this.port = port;
    const subscriptions = [
      port.onMessage((message) => this.hear(message)),
      port.onDispose(() => { if (this.port === port) { this.port = undefined; } }),
    ];
    this.portSubscriptions = subscriptions;
    return {
      dispose: () => {
        subscriptions.forEach(s => s.dispose());
        if (this.port === port) { this.port = undefined; this.portSubscriptions = []; }
      },
    };
  }

  /** Attach this port only if no port is attached: a page that resolves late must not take over from one already in use. */
  attachIfFree(port: ViewPort): Disposable | undefined {
    return this.port ? undefined : this.attach(port);
  }

  /** What the page asked of the core. One entry for every route a prompt or a request can take. */
  async handle(intent: ViewIntent): Promise<void> {
    switch (intent.type) {
      case 'ready':
        this.sendCurrentState();
        this.port?.post({ type: 'snapshot', state: this.snapshot() });
        break;
      case 'sendPrompt':
        await this.sendOrQueue(intent.text, intent.files ?? []);
        break;
      case 'sendNow':
        if (this.view.processing) { await this.cancelTurn(); } else { await this.sendQueued(); }
        break;
      case 'cancelTurn':
        await this.cancelTurn();
        break;
      case 'setMode':
        await this.setMode(intent.modeId);
        break;
      case 'setModel':
        await this.setModel(intent.modelId);
        break;
      case 'setConfigOption':
        await this.setConfigOption(intent.configId, intent.value);
        break;
      case 'connectAgent':
        await this.flow.connect();
        break;
      case 'disconnectAgent':
        await this.flow.disconnect();
        break;
      case 'configureAgent':
        await this.host.actions.configureAgent();
        break;
      case 'detachFile':
        this.post({ type: 'file-detached', path: intent.path });
        break;
      case 'answerPermission':
        this.answerPermission(intent.requestId, intent.optionId);
        break;
      case 'keepDraft':
        this.post({ type: 'draft', text: intent.text });
        break;
      case 'listSessions':
        await this.listSessions(intent.cursor);
        break;
      case 'openSession':
        await this.flow.open(intent.sessionId);
        break;
      case 'stopHire':
        await this.changeActive('stop the hire', id => this.sessions.stopHire(id, intent.planId));
        break;
      case 'openTranscript':
        await this.openTranscript(intent.planId);
        break;
    }
  }

  /** Send a prompt as if it were typed into the chat: the same intent the page's own send is. Resolves when the turn, and any prompt queued behind it, ends. */
  sendPrompt(text: string): Promise<void> {
    return this.handle({ type: 'sendPrompt', text });
  }

  /** Whether the chat holds any messages: what the person would lose by clearing it. */
  get hasChatContent(): boolean {
    return this.view.entries.length > 0;
  }

  /** Clear the chat history and return the page to its welcome state. */
  clearChat(): void {
    this.pending = [];
    this.withdrawProposals();
    this.post({ type: 'clearChat' });
  }

  /** Tell the page to include this file in the next prompt, and bring the page into view. */
  attachFile(path: string): void {
    if (!this.port) { return; }
    this.post({ type: 'file-attached', path, name: path.split(/[\\/]/).pop() || path });
    this.port.reveal?.();
  }

  dispose(): void {
    this.hearing.dispose();
    this.asking.dispose();
    this.withdrawProposals();
    this.unsubscribe.splice(0).forEach(stop => stop());
    this.portSubscriptions.forEach(s => s.dispose());
    this.portSubscriptions = [];
    this.port = undefined;
  }

  private async hear(message: unknown): Promise<void> {
    if (!isViewIntent(message)) {
      this.host.log.log(`ChatController: ignoring a message that is not an intent: ${JSON.stringify(message)?.slice(0, 200)}`);
      return;
    }
    await this.handle(message);
  }

  /** Fold the message into what the page shows, and tell the page. */
  private post(message: ViewMessage): void {
    this.view = reduce(this.view, message);
    try {
      this.port?.post(message);
    } catch (e) {
      // a page that cannot be reached must not fail the conversation it is only watching
      this.host.log.logError(`ChatController: the page could not be told ${message.type}`, e);
    }
  }

  private handleSessionUpdate(update: SessionNotification): void {
    // What the agent says about a session (commands, options, title) is written down by the sessions
    // themselves; this only passes the update on, and only for the one session the page shows.
    if (update.sessionId !== this.sessions.getActiveSessionId()) { return; }
    const message: ViewMessage = { type: 'sessionUpdate', update: update.update, sessionId: update.sessionId };
    if (this.replay) { this.replay.push(message); } else { this.post(message); }
  }

  /**
   * The replay of a loaded session is folded in one pass, and the page is given the result as one snapshot:
   * a long history costs what its length costs, not its square, and the page does not fold it again.
   */
  private endReplay(): void {
    const replay = this.replay;
    this.replay = null;
    if (!replay) { return; }
    this.view = reduceAll(this.view, replay);
    try {
      this.port?.post({ type: 'snapshot', state: this.view });
    } catch (e) {
      this.host.log.logError('ChatController: the page could not be told the replayed session', e);
    }
  }

  /** A prompt typed while a turn runs waits behind it; otherwise it is sent, and then whatever waited is. */
  private async sendOrQueue(text: string, paths: string[]): Promise<void> {
    if (this.view.processing) {
      this.pending.push({ text, paths });
      this.post({ type: 'promptQueued', text, files: paths.map(baseName) });
      return;
    }
    await this.runPrompt(text, paths);
    await this.sendQueued();
  }

  /** Send the prompts that waited, one turn after another, until none is left or a turn is running. */
  private async sendQueued(): Promise<void> {
    while (this.pending.length > 0 && !this.view.processing) {
      const next = this.pending[0];
      await this.runPrompt(next.text, next.paths);
      this.pending.shift();
    }
  }

  private async runPrompt(text: string, paths: string[] = []): Promise<void> {
    const sessionId = this.sessions.getActiveSessionId();
    if (!sessionId) {
      this.post({ type: 'error', message: 'No active session. Create a session first.' });
      return;
    }
    this.post({ type: 'userPrompt', text, files: paths.map(baseName) });
    this.post({ type: 'promptStart' });
    try {
      const answer = await this.sessions.sendPrompt(sessionId, text, paths);
      this.post({ type: 'promptEnd', stopReason: answer.stopReason, usage: (answer as { usage?: unknown }).usage as never });
    } catch (e) {
      const reason = (e as Error).message || 'Prompt failed';
      this.host.log.logError('Prompt failed', e);
      this.post({ type: 'error', message: reason });
      this.post({ type: 'promptEnd', stopReason: 'error' });
    }
  }

  private async cancelTurn(): Promise<void> {
    const sessionId = this.sessions.getActiveSessionId();
    if (!sessionId) { return; }
    this.withdrawProposals(); // the agent is owed the answer "cancelled" to what it still waits on
    await this.sessions.cancelTurn(sessionId).catch(e => this.host.log.logError('Cancel failed', e));
  }

  /** Run a change to the active session; if the agent refuses it, the person is told and the log has it. */
  private async changeActive(what: string, change: (sessionId: string) => Promise<void>): Promise<void> {
    const sessionId = this.sessions.getActiveSessionId();
    if (!sessionId) { return; }
    try {
      await change(sessionId);
    } catch (e) {
      this.host.log.logError(`Failed to ${what}`, e);
      this.post({ type: 'error', message: `Failed to ${what}: ${(e as Error).message}` });
    }
  }

  /**
   * The agent asks for a decision. A proposal (a request that carries a diff) is put to the person in
   * the chat, with the choices the agent offered, and waits for the answer. Nothing else asks: the
   * first choice that allows is taken, since no per-edit permission is the rule.
   */
  private askPermission(request: RequestPermissionRequest): Promise<RequestPermissionResponse> {
    const diffs = (request.toolCall?.content ?? []).flatMap(c => (c.type === 'diff' ? [{ path: c.path, oldText: c.oldText, newText: c.newText }] : []));
    if (diffs.length === 0) {
      // this once, never a standing grant: whatever order the agent lists its choices in
      const allowing = request.options.find(o => o.kind === 'allow_once');
      this.host.log.log(`permission: ${request.toolCall?.title ?? 'a request'} is not a proposal; ${allowing ? 'allowed this once' : 'it offers no choice that allows once, so it is cancelled'}`);
      return Promise.resolve(allowing ? { outcome: { outcome: 'selected', optionId: allowing.optionId } } : { outcome: { outcome: 'cancelled' } });
    }
    const requestId = `proposal-${++this.proposals}`;
    return new Promise(resolve => {
      this.unanswered.set(requestId, { resolve, optionIds: request.options.map(o => o.optionId) });
      this.post({
        type: 'permissionRequest', requestId, title: request.toolCall?.title ?? 'A proposed change', diffs,
        options: request.options.map(o => ({ optionId: o.optionId, name: o.name, kind: o.kind })),
      });
      this.port?.reveal?.();
    });
  }

  /** The person's answer to a proposal; one that names no proposal waiting, or a choice the agent did not offer, is ignored and logged. */
  private answerPermission(requestId: string, optionId: string): void {
    const waiting = this.unanswered.get(requestId);
    if (!waiting || !waiting.optionIds.includes(optionId)) {
      this.host.log.log(`ChatController: an answer to ${requestId} (${optionId}) names nothing that waits`);
      return;
    }
    this.unanswered.delete(requestId);
    waiting.resolve({ outcome: { outcome: 'selected', optionId } });
    this.post({ type: 'permissionResolved', requestId });
  }

  /** Answer every proposal still waiting as cancelled and take it off the page: the turn, the chat or the session it belonged to is over. */
  private withdrawProposals(): void {
    for (const [requestId, waiting] of [...this.unanswered]) {
      this.unanswered.delete(requestId);
      waiting.resolve({ outcome: { outcome: 'cancelled' } });
      this.post({ type: 'permissionResolved', requestId });
    }
  }

  /** Ask the agent which sessions it has and tell the page; the chat keeps no list of its own. */
  private async listSessions(cursor?: string): Promise<void> {
    try {
      const page = await this.sessions.listSessions(AGENT_KEY, cursor ? { cursor } : {});
      this.post({
        type: 'sessionList', append: cursor !== undefined, nextCursor: page.nextCursor ?? null,
        sessions: page.sessions.map(s => ({ sessionId: s.sessionId, title: s.title, updatedAt: s.updatedAt })),
      });
    } catch (e) {
      this.host.log.logError('Failed to list the sessions', e);
      this.post({ type: 'error', message: `Could not list the sessions: ${(e as Error).message}` });
    }
  }

  /** Ask the agent for a hired agent's transcript and tell the page; if it cannot be had, the person is told. */
  private async openTranscript(planId: string): Promise<void> {
    const sessionId = this.sessions.getActiveSessionId();
    if (!sessionId) { return; }
    try {
      this.post({ type: 'hireTranscript', planId, turns: await this.sessions.hireTranscript(sessionId, planId) });
    } catch (e) {
      this.host.log.logError('Failed to read a transcript', e);
      this.post({ type: 'error', message: `Failed to read the transcript: ${(e as Error).message}` });
    }
  }

  private async setMode(modeId: string): Promise<void> {
    if (modeId) { await this.changeActive('set the mode', id => this.sessions.setMode(id, modeId)); }
  }

  private async setModel(modelId: string): Promise<void> {
    if (modelId) { await this.changeActive('set the model', id => this.sessions.setModel(id, modelId)); }
  }

  /**
   * A change to one of the session's options (ACP "session config options"). The agent answers with all
   * of them, which are passed on so that a cascade shows (a model change may change the thought levels).
   * If it refuses, the person is told and the options as they are are passed on, so the page takes back
   * its optimistic change.
   */
  private async setConfigOption(configId: string, value: string): Promise<void> {
    const sessionId = this.sessions.getActiveSessionId();
    if (!sessionId || !configId) { return; }
    try {
      this.post({ type: 'configOptionsUpdate', configOptions: await this.sessions.setConfigOption(sessionId, configId, value) });
    } catch (e) {
      this.host.log.logError('Failed to set config option', e);
      this.post({ type: 'error', message: `Failed to set ${configId}: ${(e as Error).message}` });
      this.post({ type: 'configOptionsUpdate', configOptions: this.sessions.getSession(sessionId)?.configOptions ?? null });
    }
  }

  private sendCurrentState(): void {
    const activeId = this.sessions.getActiveSessionId();
    const held = activeId ? this.sessions.getSession(activeId) : undefined;
    const session = held && pickShown(held);
    this.post({ type: 'state', contractVersion: VIEW_CONTRACT_VERSION, activeSessionId: activeId, session: session ?? null });
  }
}

/** The facts about a session that the page is shown. */
function pickShown({ sessionId, agentDisplayName, title, cwd, modes, models, configOptions, availableCommands }: SessionInfo) {
  return { sessionId, agentName: agentDisplayName, title, cwd, modes, models, configOptions, availableCommands };
}

/** The last part of a path, whichever separator it uses. */
const baseName = (path: string): string => path.split(/[\\/]/).pop() || path;
