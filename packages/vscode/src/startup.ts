/**
 * 28h D57 (e): the chat opens with the window and connects, with no click (*"I do not want to have an unconnected jawata at start"*). It opens in
 * the place the placement setting names and connects in a new session through the chat's own connect, which waits for the studio and the engine
 * as every agent start does and says what went wrong in one sentence. Nothing happens when no agent is set: connecting would only ask for one.
 *
 * Under the editor's tests the window is shared by many tests, so the chat connects at start there only in the window started to test this
 * (JAWATA_CHAT_CONNECT_AT_START=1).
 */
export function connectsAtStart(agentSet: boolean, testMode: boolean, env: Readonly<Record<string, string | undefined>>): boolean {
  return agentSet && (!testMode || env.JAWATA_CHAT_CONNECT_AT_START === '1');
}
