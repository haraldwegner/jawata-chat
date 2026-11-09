import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import type { Disposable, PageTransport } from '@jawata/chat-core/view';

import { ChatView, type PageRole } from './ChatView.js';
import { PageFailed } from './PageFailed.js';
import { CHAT_CSS } from './styles.js';

export type { PageTransport } from '@jawata/chat-core/view';

/** Show the chat in `container`, talking to the core over `transport`. Dispose the result to take it down. */
export function mountChatView(container: HTMLElement, transport: PageTransport, role: PageRole = 'chat'): Disposable {
  const style = container.ownerDocument.createElement('style');
  style.textContent = CHAT_CSS;
  container.ownerDocument.head.appendChild(style);
  container.classList.add('jc-chat');
  const root = createRoot(container);
  root.render(createElement(PageFailed, { transport }, createElement(ChatView, { transport, role })));
  return { dispose: () => { root.unmount(); style.remove(); container.classList.remove('jc-chat'); } };
}
