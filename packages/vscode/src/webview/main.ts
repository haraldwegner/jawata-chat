import { mountChatView } from '@jawata/chat-view';
import type { ViewMessage } from '@jawata/chat-core';

/**
 * The chat's page in a VS Code webview: the view from `chat-view`, talking to the core through the
 * webview's message passing. This is the only place that knows it is a VS Code webview.
 */
declare function acquireVsCodeApi(): { postMessage(message: unknown): void };

const api = acquireVsCodeApi();
const root = document.getElementById('root');
if (!root) { throw new Error('the page has no root element'); }

// the editor gives a webview page a margin of its own; the chat fills the page
const reset = document.createElement('style');
reset.textContent = 'html, body { margin: 0; padding: 0; height: 100%; overflow: hidden; }';
document.head.appendChild(reset);

mountChatView(root, {
  onMessage(handler) {
    const listener = (event: MessageEvent) => handler(event.data as ViewMessage);
    window.addEventListener('message', listener);
    return { dispose: () => window.removeEventListener('message', listener) };
  },
  send(intent) {
    api.postMessage(intent);
  },
});
