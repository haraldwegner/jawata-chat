import { ClientSideConnection } from '@agentclientprotocol/sdk';
import type { Client, Stream } from '@agentclientprotocol/sdk';

/**
 * The chat's side of the connection to an agent: the SDK's client-side connection, as a type. The
 * rest of the core depends on this type and never on the SDK's connection class (architecture F13(e)):
 * this file is the one place that class is used, so a change of its constructor (1.x deprecates it in
 * favour of `client({name}).connectWith(...)`) touches this file alone.
 */
export type AgentLink = ClientSideConnection;

/** Open a link to an agent over `stream`, answering its requests with `client`. */
export function openAgentLink(client: Client, stream: Stream): AgentLink {
  return new ClientSideConnection(() => client, stream);
}
