// 28h D57 (b): a pasted picture is shown before it is sent and in the message that sent it, with no editor running. A file of its own:
// render.test.mjs is at its budget of time.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { act, closeDom, viewOn } from './dom.mjs';

after(closeDom);

const turnEnded = (v) => v.$('.turn .message.assistant') && !v.$('.send-stop-btn.stop');

test('28h D57 (b): a pasted picture shows small before it is sent, full size when clicked, and in the message that sent it', async () => {
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
  const v = await viewOn('R1');
  try {
    await v.connect();
    await v.settle();
    await act(async () => { await v.chat.handle({ type: 'attachPasted', name: 'shot.png', mimeType: 'image/png', data: png }); });
    const thumb = v.$('.attachment-chip .picture-thumb img');
    assert.ok(thumb, 'the chip shows the picture');
    assert.equal(thumb.getAttribute('src'), `data:image/png;base64,${png}`);
    assert.ok(v.$('.attachment-chip .chip-remove'), 'with the way to remove it');
    await v.click(v.$('.attachment-chip .picture-thumb'));
    assert.equal(v.$('.picture-full img')?.getAttribute('src'), `data:image/png;base64,${png}`, 'a click shows it full size');
    await v.click(v.$('.picture-full'));
    assert.ok(!v.$('.picture-full'), 'and a click closes it');
    await v.type('look');
    await v.key('Enter');
    await v.settle(() => turnEnded(v));
    assert.equal(v.$$('.message.user .user-images img').length, 1, 'the sent message shows the picture');
    const sent = v.host.traffic.filter(x => x.direction === 'send' && x.message.method === 'session/prompt').map(x => x.message.params.prompt)[0];
    assert.ok(sent.some(block => block.type === 'image' && block.data === png), 'and the agent is sent it');
  } finally { v.dispose(); }
});
