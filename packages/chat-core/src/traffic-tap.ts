import type { Stream } from '@agentclientprotocol/sdk';
import type { TrafficSink } from './ports.js';

export type TrafficDirection = 'send' | 'recv';

/**
 * Wrap an ACP stream so every message, in both directions, passes each sink before it travels on.
 * This is the chat's one recorder: the traffic log and the session recording are two sinks on it.
 * A sink that throws is reported through onError and does not stop the conversation.
 */
export function tapStream(stream: Stream, sinks: TrafficSink[], onError: (what: string, error: unknown) => void): Stream {
  const tap = (direction: TrafficDirection) => new TransformStream({
    transform(chunk: unknown, controller: TransformStreamDefaultController) {
      for (const sink of sinks) {
        try {
          sink(direction, chunk);
        } catch (e) {
          onError(`Traffic sink failed (${direction})`, e);
        }
      }
      controller.enqueue(chunk);
    },
  });

  // Tap outgoing messages (client → agent) and incoming messages (agent → client)
  const sendTap = tap('send');
  const recvTap = tap('recv');

  // Pipe: sendTap.readable → original writable, original readable → recvTap.writable
  // These run in the background — no need to await
  void sendTap.readable.pipeTo(stream.writable).catch(e => onError('Traffic tap send pipe error', e));
  void stream.readable.pipeTo(recvTap.writable).catch(e => onError('Traffic tap recv pipe error', e));

  return {
    writable: sendTap.writable,
    readable: recvTap.readable,
  } as Stream;
}
