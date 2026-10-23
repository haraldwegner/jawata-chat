import { AgentSupply } from './agent-supply.js';
import { AgentUpdates } from './agent-updates.js';
import { ChatController } from './chat-controller.js';
import { ConnectionManager } from './connection-manager.js';
import { ConversationFlow } from './conversation-flow.js';
import type { HostPorts } from './ports.js';
import { SessionManager } from './session-manager.js';

/** The chat, built once from a host's ports: the one wiring every host and every test uses. */
export interface Chat {
  /** The agents and the sessions held with them. */
  readonly sessions: SessionManager;
  /** Connect, new conversation, restart, disconnect and open: the one route for the page's intents. */
  readonly flow: ConversationFlow;
  /** What a page is attached to. */
  readonly controller: ChatController;
  /** End the agents and let go of everything the chat holds. */
  dispose(): void;
}

/**
 * Build the chat on a host. The root owns what lives longest: the links to the agents, the supply that starts the agents and keeps
 * their register, and the updates; the sessions and the controller are built on them and let go of first. (The links keep no register of their own.)
 */
export function createChat(host: HostPorts): Chat {
  return assembleChat(host).chat;
}

/**
 * The one composition, with what only the test support reaches beside the chat: the updates the agents send, which a test drives
 * directly (ledger 28i-C20-4, folded at C12: production reads the chat, never the updates). Not exported from the package.
 * @internal read by the test support only
 */
export function assembleChat(host: HostPorts): { chat: Chat; updates: AgentUpdates } {
  const updates = new AgentUpdates(host.log);
  const links = new ConnectionManager(updates, host);
  const supply = new AgentSupply(host, links);
  const sessions = new SessionManager(host, supply, updates);
  const flow = new ConversationFlow(sessions, host, () => controller.hasChatContent);
  const controller: ChatController = new ChatController(sessions, updates, host, flow);
  const chat: Chat = {
    sessions, flow, controller,
    dispose() {
      controller.dispose();
      sessions.dispose();
      supply.dispose();
      updates.dispose();
    },
  };
  return { chat, updates };
}
