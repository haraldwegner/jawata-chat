import type { Client } from '@agentclientprotocol/sdk';
import type { FsPort, HostPorts, TerminalPort } from './ports.js';
import type { AgentUpdates } from './agent-updates.js';

type Offered = Pick<HostPorts, 'fs' | 'terminal' | 'log'>;

/**
 * What the chat answers an agent with. An agent may ask the client for a person's decision, to read
 * or write a file, to run a command, and it reports the progress of a turn. A decision is put to the
 * person in the chat itself (see the controller); every other request goes to the host port that serves it; a capability the host does not offer is refused with a message that says
 * which.
 */
export class ClientEndpoint implements Client {
  constructor(
    private readonly offered: Offered,
    private readonly updates: AgentUpdates,
  ) {}

  requestPermission: Client['requestPermission'] = request => this.updates.askPermission(request);

  sessionUpdate: Client['sessionUpdate'] = async notification => { this.updates.publish(notification); };

  readTextFile: Client['readTextFile'] = request => {
    this.offered.log.log(`Client.readTextFile: ${request.path}`);
    return this.files().readTextFile(request);
  };

  writeTextFile: Client['writeTextFile'] = request => {
    this.offered.log.log(`Client.writeTextFile: ${request.path}`);
    return this.files().writeTextFile(request);
  };

  createTerminal: NonNullable<Client['createTerminal']> = request => this.terminals().createTerminal(request);
  terminalOutput: NonNullable<Client['terminalOutput']> = request => this.terminals().terminalOutput(request);
  waitForTerminalExit: NonNullable<Client['waitForTerminalExit']> = request => this.terminals().waitForTerminalExit(request);
  killTerminal: NonNullable<Client['killTerminal']> = request => this.terminals().killTerminal(request);
  releaseTerminal: NonNullable<Client['releaseTerminal']> = request => this.terminals().releaseTerminal(request);

  private files(): FsPort {
    return this.offered.fs ?? refuse('file system');
  }

  private terminals(): TerminalPort {
    return this.offered.terminal ?? refuse('terminal');
  }
}

function refuse(what: string): never {
  throw new Error(`This host offers no ${what}`);
}
