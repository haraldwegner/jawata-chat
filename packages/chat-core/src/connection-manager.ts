import { PROTOCOL_VERSION } from '@agentclientprotocol/sdk';
import type { InitializeResponse, Stream } from '@agentclientprotocol/sdk';

import { openAgentLink, type AgentLink } from './agent-link.js';
import { ClientEndpoint } from './client-endpoint.js';
import type { HostPorts } from './ports.js';
import type { AgentUpdates } from './agent-updates.js';
import { tapStream } from './traffic-tap.js';

/** An agent the chat has opened a link to and initialized. */
export interface ConnectionInfo {
  connection: AgentLink;
  initResponse: InitializeResponse;
}

type Needs = Pick<HostPorts, 'chooser' | 'fs' | 'terminal' | 'log' | 'sinks' | 'clientInfo'>;

/**
 * Opens the links to the agents the host has started: the traffic is tapped for the host's sinks,
 * the agent is answered by a {@link ClientEndpoint}, and `initialize` is exchanged. It keeps no
 * register: the supply holds the links it is given, for as long as it holds the agent.
 */
export class ConnectionManager {
  /** @param updates where the agents' `session/update` notifications go */
  constructor(readonly updates: AgentUpdates, private readonly host: Needs) {}

  async connect(agentId: string, agentStream: Stream): Promise<ConnectionInfo> {
    const { host } = this;
    host.log.log(`Opening the link to agent ${agentId}`);

    const tapped = tapStream(agentStream, host.sinks(agentId), (what, error) => host.log.logError(what, error));
    const connection = openAgentLink(new ClientEndpoint(host, this.updates), tapped);

    const initResponse = await connection.initialize({
      protocolVersion: PROTOCOL_VERSION,
      clientInfo: host.clientInfo,
      clientCapabilities: {
        fs: host.fs ? { readTextFile: true, writeTextFile: true } : undefined,
        terminal: Boolean(host.terminal),
      },
    });
    const who = initResponse.agentInfo;
    host.log.log(`Initialized: ${who?.name ?? 'unknown agent'} ${who?.version ? `v${who.version}` : ''}`.trim());

    return { connection, initResponse };
  }
}
