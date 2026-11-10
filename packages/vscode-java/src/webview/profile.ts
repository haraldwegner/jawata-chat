import { mountProfileView } from '@jawata/profile-view';

import type { PageMessage } from '../profileHost';
import { webviewSource } from '../profileSource';

/** The profile page in a VS Code webview: the host-neutral view, talking to the editor through the webview's message passing. */
declare function acquireVsCodeApi(): { postMessage(message: unknown): void };

const api = acquireVsCodeApi();
const root = document.getElementById('root');
if (!root) { throw new Error('the page has no root element'); }

mountProfileView(root, webviewSource({
  post: (message: PageMessage) => api.postMessage(message),
  listen: handler => window.addEventListener('message', event => handler(event.data)),
}));
