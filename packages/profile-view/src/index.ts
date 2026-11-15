import { createRoot } from 'react-dom/client';
import { createElement } from 'react';

import { ProfileView } from './ProfileView.js';
import type { ProfileSource } from './types.js';

export type { ProfileLocation, ProfileResult, ProfileSource, SampleRequest } from './types.js';

/** Shows the profile page in `container`, working through `source`; returns what takes it down again. */
export function mountProfileView(container: HTMLElement, source: ProfileSource): { dispose(): void } {
  const root = createRoot(container);
  root.render(createElement(ProfileView, { source }));
  return { dispose: () => root.unmount() };
}
