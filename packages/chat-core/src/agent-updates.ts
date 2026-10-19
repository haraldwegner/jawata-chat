import type { RequestPermissionRequest, RequestPermissionResponse, SessionNotification } from '@agentclientprotocol/sdk';
import { Emitter } from './emitter.js';
import type { Log } from './ports.js';
import type { Disposable } from './view.js';

/** What a listener of the agents' updates is. */
export type UpdateListener = (update: SessionNotification) => void;

/** What answers an agent's request for a decision. */
export type PermissionHandler = (request: RequestPermissionRequest) => Promise<RequestPermissionResponse>;

/**
 * Where the `session/update` notifications of every agent arrive, and from where they go on to whoever
 * listens. A listener that fails is logged; the others still hear the update.
 */
export class AgentUpdates {
  private readonly line = new Emitter<{ update: [SessionNotification] }>();
  private asker?: PermissionHandler;

  /** @param log where updates and failed listeners are noted */
  constructor(private readonly log?: Log) {}

  /** Hear every update from now on; dispose the result to stop. */
  onUpdate(listener: UpdateListener): Disposable {
    const guarded = (update: SessionNotification) => {
      try { listener(update); } catch (e) { this.log?.log(`a listener of agent updates failed: ${e}`); }
    };
    this.line.on('update', guarded);
    return { dispose: () => { this.line.off('update', guarded); } };
  }

  /** An agent sent this. */
  publish(update: SessionNotification): void {
    const kind = (update.update as { sessionUpdate?: string }).sessionUpdate ?? 'unknown';
    this.log?.log(`heard a ${kind} update for session ${update.sessionId}`);
    this.line.emit('update', update);
  }

  /** Answer the agents' requests for a decision from now on, in place of any earlier answerer; dispose the result to stop. */
  onPermissionRequest(handler: PermissionHandler): Disposable {
    this.asker = handler;
    return { dispose: () => { if (this.asker === handler) { this.asker = undefined; } } };
  }

  /** An agent asks for a decision. With no one to answer, the answer is that it was cancelled: nothing is allowed unasked. */
  askPermission(request: RequestPermissionRequest): Promise<RequestPermissionResponse> {
    return this.asker ? this.asker(request) : Promise.resolve({ outcome: { outcome: 'cancelled' } });
  }

  dispose(): void {
    this.asker = undefined;
    this.line.removeAllListeners();
  }
}
