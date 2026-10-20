import type { AgentCapabilities } from '@agentclientprotocol/sdk';
import type { AgentLink } from './agent-link.js';
import type { ConnectionInfo, ConnectionManager } from './connection-manager.js';
import type { UpdateListener } from './agent-updates.js';
import type { AgentClosed, AgentFailed, HostPorts } from './ports.js';
import type { AgentCapabilitySummary } from './session-types.js';
import type { Disposable } from './view.js';

/** An agent that is running and initialized: its process, and the link to it. */
export interface LiveAgent {
  agentId: string;
  name: string;
  connection: ConnectionInfo;
}

type Needs = Pick<HostPorts, 'agents' | 'settings' | 'log'>;

function summarize(capabilities: AgentCapabilities | undefined | null): AgentCapabilitySummary {
  const c = capabilities as { loadSession?: boolean; sessionCapabilities?: { list?: unknown; resume?: unknown } } | null | undefined;
  return {
    list: Boolean(c?.sessionCapabilities?.list),
    load: Boolean(c?.loadSession),
    resume: Boolean(c?.sessionCapabilities?.resume),
  };
}

/**
 * Where the chat gets a running agent from, and the register of the agents it started. Asking for an
 * agent by name returns the one already running and initialized, or starts it, opens the link and
 * initializes it. It hears when a process ends and forgets the agent and its link; what an agent turned
 * out to be able to do is remembered by name.
 */
export class AgentSupply {
  private readonly live = new Map<string, LiveAgent>();
  private readonly learned = new Map<string, AgentCapabilitySummary>();
  private readonly endedListeners = new Set<(event: { agentId: string; code: number | null }) => void>();
  private readonly failedListeners = new Set<(event: { agentId: string; error: Error }) => void>();

  private readonly hearing: Disposable[];

  constructor(private readonly host: Needs, private readonly links: ConnectionManager) {
    this.hearing = [host.agents.onClosed(this.closed), host.agents.onError(this.failed)];
  }

  /** The agent by this name, running; started when it was not. */
  async obtain(name: string): Promise<LiveAgent> {
    const running = this.running(name);
    if (running) { return running; }

    const config = this.host.settings.agents()[name];
    if (!config) { throw new Error(`Unknown agent: ${name}.`); }

    const handle = this.host.agents.spawnAgent(name, config, this.host.settings.workspaceCwd());
    let connection: ConnectionInfo;
    try {
      connection = await this.links.connect(handle.id, handle.stream);
    } catch (e) {
      this.host.agents.killAgent(handle.id);
      throw e;
    }
    this.learned.set(name, summarize(connection.initResponse.agentCapabilities));
    const started: LiveAgent = { agentId: handle.id, name, connection };
    this.live.set(handle.id, started);
    return started;
  }

  /** The agent by this name if it is running with a link; nothing is started. */
  running(name: string): LiveAgent | undefined {
    return [...this.live.values()].find(a => a.name === name);
  }

  /** The link to the agent process of this id, if it is running. */
  linkOf(agentId: string): AgentLink | undefined {
    return this.live.get(agentId)?.connection.connection;
  }

  /** What the agent by this name can do with sessions, once it has been obtained. */
  capabilitiesOf(name: string): AgentCapabilitySummary | undefined {
    return this.learned.get(name);
  }

  /** What the agents send about their sessions. */
  onUpdate(listener: UpdateListener): Disposable {
    return this.links.updates.onUpdate(listener);
  }

  /** An agent process ended; the register has forgotten it by the time this is told. */
  onEnded(listener: (event: { agentId: string; code: number | null }) => void): Disposable {
    this.endedListeners.add(listener);
    return { dispose: () => { this.endedListeners.delete(listener); } };
  }

  /** An agent process reported an error. */
  onFailed(listener: (event: { agentId: string; error: Error }) => void): Disposable {
    this.failedListeners.add(listener);
    return { dispose: () => { this.failedListeners.delete(listener); } };
  }

  /** End the agent's process and let go of its link. */
  stop(agentId: string): void {
    this.forget(agentId);
    this.host.agents.killAgent(agentId);
  }

  /** End every agent this supply started. The links are the root's, which disposes them; each ended agent's link is let go of here. */
  private stopAll(): void {
    for (const id of [...this.live.keys()]) { this.stop(id); }
  }

  /** Let go of the host and the listeners, and end the agents. */
  dispose(): void {
    this.hearing.forEach(h => h.dispose());
    this.stopAll();
    this.endedListeners.clear();
    this.failedListeners.clear();
  }

  private forget(agentId: string): void {
    this.live.delete(agentId);
    this.links.removeConnection(agentId);
  }

  private readonly closed = (event: AgentClosed): void => {
    this.host.log.log(`Agent ${event.agentId} closed with code ${event.code}`);
    this.forget(event.agentId);
    for (const listener of [...this.endedListeners]) { listener(event); }
  };

  private readonly failed = (event: AgentFailed): void => {
    this.host.log.logError(`Agent ${event.agentId} error`, event.error);
    for (const listener of [...this.failedListeners]) { listener(event); }
  };
}
