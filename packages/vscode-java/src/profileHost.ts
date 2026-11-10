import type { ProfileLocation, ProfileResult } from '@jawata/profile-view';

/** What the profile page says to the editor: record the running program, or open a place of the source. `id` pairs an answer with its question. */
export type PageMessage =
  | { type: 'sample'; id: number; seconds: number; dimension: string }
  | { type: 'open'; location: ProfileLocation };

/** What the editor says back to the page. */
export type HostMessage =
  | { type: 'sampled'; id: number; result: ProfileResult }
  | { type: 'failed'; id: number; why: string };

/** What the editor side of the profile page needs: the person's running program, the engine's profile, and a way to open a place. */
export interface ProfileHost {
  session(): string | undefined;
  profile(request: { sessionId: string; seconds: number; dimension: string }): Promise<ProfileResult>;
  open(location: ProfileLocation): Promise<void>;
}

/** What the person is told when the page is asked to record and no program of theirs is running under the debugger. */
const NO_SESSION = 'No program of yours is running under the jawata debugger. Start one with Run and Debug, then record again.';

/**
 * Answers one message of the page. A record request is answered, with the ranking or with why it could not be made; an open request is carried
 * out and has no answer. The page's own words never reach the engine unread: the session is the editor's, not the page's.
 */
export async function answerPage(message: PageMessage, host: ProfileHost): Promise<HostMessage | undefined> {
  if (message.type === 'open') {
    await host.open(message.location);
    return undefined;
  }
  const sessionId = host.session();
  if (sessionId === undefined) { return { type: 'failed', id: message.id, why: NO_SESSION }; }
  try {
    return { type: 'sampled', id: message.id, result: await host.profile({ sessionId, seconds: message.seconds, dimension: message.dimension }) };
  } catch (e) {
    return { type: 'failed', id: message.id, why: e instanceof Error ? e.message : String(e) };
  }
}
