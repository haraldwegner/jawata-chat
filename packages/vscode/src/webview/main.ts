import { mountChatView } from '@jawata/chat-view';
import type { ViewMessage } from '@jawata/chat-core/view';

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

const role = document.body.dataset.role === 'agents' || document.body.dataset.role === 'side' ? document.body.dataset.role : 'chat';

mountChatView(root, {
  onMessage(handler) {
    const listener = (event: MessageEvent) => handler(event.data as ViewMessage);
    window.addEventListener('message', listener);
    return { dispose: () => window.removeEventListener('message', listener) };
  },
  send(intent) {
    api.postMessage(intent);
  },
}, role);

/** The editor's colours, told to the extension so the studio can follow a dark theme. The Agent Control page is always there, so it reports. */
function reportTheme(): void {
  const css = getComputedStyle(document.documentElement);
  const read = (name: string) => css.getPropertyValue(name).trim();
  api.postMessage({
    type: 'editorTheme',
    dark: !document.body.classList.contains('vscode-light') && !document.body.classList.contains('vscode-high-contrast-light'),
    colors: {
      background: read('--jc-host-page'), panel: read('--jc-host-ground'), border: read('--jc-host-edge'),
      text: read('--jc-host-text'), muted: read('--jc-host-muted'), accent: read('--jc-host-accent'),
    },
  });
}
if (role === 'agents') {
  reportTheme();
  new MutationObserver(reportTheme).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  // Told again now and then, so that with two windows the studio goes on following one that is still open after the other closes.
  setInterval(reportTheme, 20_000);
}
