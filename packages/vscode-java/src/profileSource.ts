import type { ProfileLocation, ProfileResult, ProfileSource, SampleRequest } from '@jawata/profile-view';

import type { HostMessage, PageMessage } from './profileHost';

/** The page's end of the webview's message passing: send to the editor, and be told what the editor sends. */
export interface Wire {
  post(message: PageMessage): void;
  listen(handler: (message: HostMessage) => void): void;
}

/**
 * The profile page's source in a VS Code webview: a record request is posted to the editor and its answer, found by the id, settles the promise
 * the page waits on; opening a place is posted and not waited for. This is the only part of the page that knows it is in a webview.
 */
export function webviewSource(wire: Wire): ProfileSource {
  let next = 0;
  const waiting = new Map<number, { resolve: (result: ProfileResult) => void; reject: (why: Error) => void }>();
  wire.listen(message => {
    const pending = waiting.get(message.id);
    if (!pending) { return; }
    waiting.delete(message.id);
    if (message.type === 'sampled') { pending.resolve(message.result); } else { pending.reject(new Error(message.why)); }
  });
  return {
    sample(request: SampleRequest): Promise<ProfileResult> {
      const id = ++next;
      return new Promise((resolve, reject) => {
        waiting.set(id, { resolve, reject });
        wire.post({ type: 'sample', id, seconds: request.seconds, dimension: request.dimension });
      });
    },
    open(location: ProfileLocation): void {
      wire.post({ type: 'open', location });
    },
  };
}
