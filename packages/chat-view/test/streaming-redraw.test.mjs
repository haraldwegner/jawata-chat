// 28h z66: while an answer streams in, the messages before it are not parsed, sanitised and drawn again. A real window with a 2000-message session
// measured typing during a stream at 66 ms to the next frame (median) before this, 15 ms after. Here a chunk of the live answer arrives after four
// finished answers (the recorded session R6, whose one exchange is repeated): the markdown of an answer that did not change is not sanitised again.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { act, closeDom, viewOn, sleep } from './dom.mjs';
import DOMPurify from 'dompurify';

after(closeDom);

const kind = (l) => l.dir === 'recv' && l.msg.method === 'session/update' ? l.msg.params.update.sessionUpdate : null;

/** R6 with its exchange (what the person sent and what the agent answered) repeated three more times, each with words of its own. */
function fourExchanges(lines) {
  const user = lines.findIndex(l => kind(l) === 'user_message_chunk');
  const agent = lines.findIndex((l, i) => i > user && kind(l) === 'agent_message_chunk');
  const block = lines.slice(user, agent + 1);
  const copies = [1, 2, 3].flatMap(n => block.map(l => {
    const copy = structuredClone(l);
    const content = copy.msg.params?.update?.content;
    if (content?.text) { content.text = `${content.text} (${n})`; }
    return copy;
  }));
  return [...lines.slice(0, agent + 1), ...copies, ...lines.slice(agent + 1)];
}

test('28h z66: a chunk of a streaming answer does not draw the finished answers before it again', async () => {
  const v = await viewOn('R6', { reshape: fourExchanges });
  const sanitize = DOMPurify.sanitize;
  try {
    await v.sessions.listSessions('agent');
    const sessionId = v.session.find(l => l.msg.method === 'session/load').msg.params.sessionId;
    await act(async () => { await v.sessions.loadSession('agent', sessionId); });
    await v.settle(() => !v.$('.load-overlay.visible'));
    const finished = v.$$('.turn .message.assistant').length;
    assert.ok(finished >= 4, `four answers are on the page before the stream (${finished})`);

    let sanitised = 0;
    DOMPurify.sanitize = (...args) => { sanitised++; return sanitize.apply(DOMPurify, args); };
    for (let i = 0; i < 5; i++) {
      await act(async () => {
        v.port.post({ type: 'sessionUpdate', sessionId, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: ' word' } } });
        await sleep(15);
      });
    }
    // the last answer is the one that grows, so at most one answer is sanitised per chunk; the finished ones before it are not
    assert.ok(sanitised <= 5, `five chunks sanitised ${sanitised} answers: the finished answers are drawn again for each chunk (${finished} are on the page)`);
  } finally { DOMPurify.sanitize = sanitize; v.dispose(); }
});
