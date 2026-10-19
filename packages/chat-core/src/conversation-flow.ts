import { AGENT_KEY, type HostPorts } from './ports.js';
import type { SessionLifecycle } from './session-types.js';

type Needs = Pick<HostPorts, 'settings' | 'chooser' | 'notifier' | 'log' | 'actions'>;

/**
 * The operations the person starts on the conversation: connect, a new conversation, restart,
 * disconnect, open a session the agent has. This is the protocol policy and the asking that go with
 * them: one principal session (a second connect opens none), a question before messages are replaced,
 * a session loaded where the agent can and resumed where it can only do that, and what went wrong
 * told to the person. A host supplies only the means (`chooser`, `notifier`, `actions`).
 */
export class ConversationFlow {
  /**
   * @param hasContent whether the chat holds messages that opening or starting a conversation would replace
   */
  constructor(
    private readonly sessions: SessionLifecycle,
    private readonly host: Needs,
    private readonly hasContent: () => boolean,
  ) {}

  /** Connect to the agent and open the principal session. The one open already is kept: no second `session/new` is sent. */
  async connect(): Promise<void> {
    if (!this.host.settings.agents()[AGENT_KEY]) {
      if (await this.host.chooser.confirm('No agent is set. Name its program in the jawataChat.agent setting.', 'Configure Agent')) {
        await this.host.actions.configureAgent();
      }
      return;
    }
    await this.attempt('connect', () => this.host.notifier.progress('Connecting to the agent…', () => this.sessions.connectToAgent(AGENT_KEY)));
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
    if (await this.attempt('disconnect', () => this.sessions.disconnectAgent(name))) { this.host.notifier.info('Disconnected from the agent.'); }
  }

  /** Open a session the agent has. The sessions decide how (loaded, so the earlier conversation shows, or resumed, so it does not); the person is told which. */
  async open(sessionId: string): Promise<void> {
    if (this.sessions.getActiveSessionId() === sessionId) { return; }
    if (this.hasContent() && !await this.host.chooser.confirm('Open a different session? The chat now shown is replaced.', 'Open Session')) { return; }
    await this.attempt('open the session', async () => {
      const how = await this.host.notifier.progress('Opening the session…', () => this.sessions.open(AGENT_KEY, sessionId));
      if (how === 'resumed') { this.host.notifier.info('Resumed the session; its earlier messages are not shown.'); }
    });
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
    const session = this.sessions.getActiveSession();
    if (!session) { await this.connect(); return false; }
    if (this.hasContent() && !await this.host.chooser.confirm(question, yes)) { return false; }
    return this.attempt(what, () => this.host.notifier.progress(`${doing} ${session.agentDisplayName}…`, () => this.sessions.newConversation()));
  }
}
