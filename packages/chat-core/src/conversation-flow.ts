import type { SessionConfigOption } from '@agentclientprotocol/sdk';

import { agentOf, isOn, LastConversationMemory, PRINCIPAL_BRAIN_OPTION } from './last-conversation.js';
import { AGENT_KEY, type HostPorts, type LastConversation } from './ports.js';
import type { SessionLifecycle } from './session-types.js';

/** The client name the engine's own conversations carry in a session list; the person is told nothing of other clients about these. */
const OWN_CLIENT = 'jawata-agent';


type Needs = Pick<HostPorts, 'settings' | 'chooser' | 'notifier' | 'log' | 'actions' | 'lastConversation'>;

/** What the flow tells the chat itself. */
interface ChatPage {
  /** Say one line in the chat. */
  say(line: string): void;
  /** Show the session's options as they now stand. */
  showOptions(options: SessionConfigOption[]): void;
}

/**
 * The operations the person starts on the conversation: connect, a new conversation, restart,
 * disconnect, open a session the agent has. This is the protocol policy and the asking that go with
 * them: one principal session (a second connect opens none), a question before messages are replaced,
 * a session loaded where the agent can and resumed where it can only do that, and what went wrong
 * told to the person. A host supplies only the means (`chooser`, `notifier`, `actions`).
 *
 * It also decides what the window comes back to after a restart (his ruling, 2026-11-25): the conversation it was showing, on the agent
 * it was held with. A conversation is remembered when the person types into it or opens it from History; New chat forgets; a new session
 * the chat opened by itself replaces nothing until the person types into it.
 */
export class ConversationFlow {
  private readonly memory: LastConversationMemory;
  /** Whether this run has had a conversation in the window: only before that is the remembered one reopened. */
  private shown = false;
  /** The reopen under way: another connect is the same one, and what the person chooses meanwhile comes after it. */
  private reopening?: Promise<void>;
  /** The person disconnected while the reopen was under way: nothing is started in its place. */
  private abandoned = false;

  /**
   * @param hasContent whether the chat holds messages that opening or starting a conversation would replace
   * @param page what the flow tells the chat itself
   */
  constructor(
    private readonly sessions: SessionLifecycle,
    private readonly host: Needs,
    private readonly hasContent: () => boolean,
    private readonly page: ChatPage,
  ) {
    this.memory = new LastConversationMemory(host);
  }

  /**
   * Connect to the agent and open the principal session. The one open already is kept: no second `session/new` is sent. The first time
   * in a run, a window that remembers a conversation reopens that one instead of starting a new one.
   */
  async connect(): Promise<void> {
    if (!this.host.settings.agents()[AGENT_KEY]) {
      if (await this.host.chooser.confirm(`No agent is set. Name its program in ${this.host.settings.agentSetup}.`, 'Configure Agent')) {
        await this.host.actions.configureAgent();
      }
      return;
    }
    if (this.reopening) { return this.reopening; }
    const last = this.shown || this.sessions.getActiveSessionId() ? undefined : this.memory.recall();
    if (!last) {
      await this.connectWith(() => this.sessions.connectToAgent(AGENT_KEY));
      return;
    }
    this.abandoned = false;
    this.reopening = this.reopen(last).finally(() => { this.reopening = undefined; });
    return this.reopening;
  }

  /** The person typed into the active conversation: it is the one the window comes back to. */
  typedIn(): void {
    const session = this.sessions.getActiveSession();
    // while it is being reopened it is remembered already, with its own agent, which the session may not be on yet
    if (session && !this.reopening) { this.memory.keep(session); }
  }

  /** The person chose the agent of the active conversation. */
  agentPicked(sessionId: string, agent: string): void {
    const session = this.sessions.getActiveSession();
    if (session?.sessionId === sessionId && this.memory.holds(sessionId)) { this.memory.keep(session, agent); }
  }

  /** The options of a session changed: if it is the remembered one, so may its agent have. */
  optionsChanged(sessionId: string): void {
    const session = this.sessions.getActiveSession();
    if (!this.reopening && session?.sessionId === sessionId && this.memory.holds(sessionId)) { this.memory.keep(session); }
  }

  /** End the session and open a fresh one with the same agent, after asking if messages would be lost. Without a session it connects. */
  async newConversation(): Promise<void> {
    await this.restartWith('Starting a new conversation with', 'start a new conversation', 'Start a new conversation? The messages now shown are cleared.', 'New Conversation');
  }

  /** Restart the agent: the same as a new conversation, since a restarted agent has no session of the one before. */
  async restart(): Promise<void> {
    const name = this.sessions.getActiveSession()?.agentDisplayName;
    if (await this.restartWith('Restarting', 'restart the agent', 'Restart the agent? The messages now shown are cleared.', 'Restart')) {
      this.host.notifier.info(`Restarted ${name}.`);
    }
  }

  /** End the agent and the session held with it. */
  async disconnect(): Promise<void> {
    const name = this.sessions.getActiveAgentName();
    if (!name) {
      this.host.notifier.info('No agent is connected.');
      return;
    }
    if (this.reopening) { this.abandoned = true; }
    if (await this.attempt('disconnect', () => this.sessions.disconnectAgent(name))) { this.host.notifier.info('Disconnected from the agent.'); }
  }

  /** Open a session the agent has. The sessions decide how (loaded, so the earlier conversation shows, or resumed, so it does not); the person is told which. */
  async open(sessionId: string, listed?: { client?: string | null; clientName?: string | null }): Promise<void> {
    if (this.reopening) { await this.reopening; }
    if (this.sessions.getActiveSessionId() === sessionId) { return; }
    // no question when another session is shown: sessions are stored, so opening one loses nothing (his words, 2026-11-17)
    const opened = await this.attempt('open the session', () => this.load(sessionId));
    const session = this.sessions.getActiveSession();
    if (opened && session) {
      this.shown = true;
      this.memory.keep(session);
    }
    // a session another client recorded is shown from what was recorded: that client's own memory of it is not resumed (his ruling 2026-11-18)
    const other = listed?.client === undefined || listed.client === null || listed.client === OWN_CLIENT ? undefined : listed.clientName ?? listed.client;
    if (opened && other !== undefined) {
      this.host.notifier.info(`This is a ${other} session. Its recorded messages are shown; a new message here starts with fresh context, because ${other} does not resume it.`);
    }
  }

  /** Open a session the agent has, behind a progress: the one way a past conversation is opened, from History and at the start. */
  private async load(sessionId: string): Promise<void> {
    const how = await this.host.notifier.progress('Opening the session…', () => this.sessions.open(AGENT_KEY, sessionId));
    if (how === 'resumed') { this.host.notifier.info('Resumed the session; its earlier messages are not shown.'); }
  }

  /** Reopen the remembered conversation; if that cannot be done, start a new one and say in the chat why. What is remembered stays. */
  private async reopen(last: LastConversation): Promise<void> {
    let why: string;
    try {
      await this.load(last.sessionId);
      if (this.abandoned) { return; }
      if (last.agent) { await this.putOn(last.agent); }
      this.shown = true;
      return;
    } catch (e) {
      if (this.abandoned) { return; }
      this.host.log.logError('Failed to reopen the last conversation', e);
      why = oneLine((e as Error).message);
    }
    // a conversation that was loaded but cannot be put on its agent is ended; one that was not loaded left no session
    const started = await this.connectWith(() => (this.sessions.getActiveSessionId() ? this.sessions.newConversation() : this.sessions.connectToAgent(AGENT_KEY)));
    this.page.say(`The last conversation could not be reopened: ${why}.${started ? ' This is a new one.' : ''}`);
  }

  /** Put the active session on the agent its conversation was held with, if it is not on it. */
  private async putOn(agent: string): Promise<void> {
    const session = this.sessions.getActiveSession();
    if (!session) { throw new Error('the agent ended'); }
    if (isOn(agentOf(session), agent)) { return; }
    let options: SessionConfigOption[] | null;
    try {
      options = await this.sessions.setConfigOption(session.sessionId, PRINCIPAL_BRAIN_OPTION, agent, true);
    } catch (e) {
      throw new Error(`its agent ${agent} is not available (${(e as Error).message})`);
    }
    if (options) { this.page.showOptions(options); }
  }

  /** Open a session with the agent, behind a progress; a failure is told to the person. True when it was done. */
  private async connectWith(open: () => Promise<unknown>): Promise<boolean> {
    const done = await this.attempt('connect', () => this.host.notifier.progress('Connecting to the agent…', open));
    if (done) { this.shown = true; }
    return done;
  }

  /** Run a job; if it throws, log it and tell the person what could not be done. */
  private async attempt(what: string, job: () => PromiseLike<unknown>): Promise<boolean> {
    try {
      await job();
      return true;
    } catch (e) {
      this.host.log.logError(`Failed to ${what}`, e);
      this.host.notifier.error(`Failed to ${what}: ${(e as Error).message}`);
      return false;
    }
  }

  /** Ask, if messages would be lost, then end the session and open a new one; true when it was done. */
  private async restartWith(doing: string, what: string, question: string, yes: string): Promise<boolean> {
    if (this.reopening) { await this.reopening; }
    const session = this.sessions.getActiveSession();
    // a new conversation is the person's choice: from here nothing older comes back
    if (!session) { this.memory.forget(); await this.connect(); return false; }
    if (this.hasContent() && !await this.host.chooser.confirm(question, yes)) { return false; }
    this.memory.forget();
    return this.attempt(what, () => this.host.notifier.progress(`${doing} ${session.agentDisplayName}…`, () => this.sessions.newConversation()));
  }
}

/** A reason as part of one line of the chat: no line breaks, no full stop of its own at the end. */
const oneLine = (reason: string): string => reason.replace(/\s+/g, ' ').trim().replace(/\.+$/, '');
