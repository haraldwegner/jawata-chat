// The per-seat brain selectors are gone from the chat (D53 (c)): a seat's default is set in the studio, and a working agent's brain on its row.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { closeDom, viewOn } from './dom.mjs';

after(closeDom);

test('R5: an agent that sends a selector per seat shows none of them above the input', async () => {
  const v = await viewOn('R5');
  try {
    await v.connect();
    await v.settle();
    assert.equal(v.$$('[data-config-id^="seat-model:"]').length, 0);
    assert.ok(!v.container.textContent.includes('As the seat file says'));
  } finally { v.dispose(); }
});
