// A crash while the page draws (ledger 28i-C13-10): the person is told the view stopped, the core is told so the host logs it, and
// Reload draws the chat again from the core's state, with nothing of the conversation lost.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { VIEW_CONTRACT_VERSION } from '@jawata/chat-core/view';
import { act, closeDom, viewOn } from './dom.mjs';

after(closeDom);

test('a crash after ready shows what stopped and a Reload, tells the core, and Reload draws the chat again', async () => {
  const v = await viewOn('R1');
  const quiet = console.error;
  console.error = () => { /* React reports the caught error; the test expects it */ };
  try {
    await v.connect();
    await v.settle(() => v.$('textarea'));
    await act(async () => { v.port.post({ type: 'snapshot', state: { contractVersion: VIEW_CONTRACT_VERSION } }); }); // a state of this contract the view cannot draw: it holds no entries
    const alert = v.$('.page-failed[role="alert"]');
    assert.ok(alert, 'the person is told the view stopped');
    assert.match(alert.textContent, /The chat view stopped working/);
    await v.settle(() => v.host.logged.some(l => /the page stopped drawing/.test(l)));
    assert.ok(v.host.logged.some(l => /the page stopped drawing/.test(l)), 'the core is told, and the host log has it');
    const snapshotsBefore = v.port.toView.filter(m => m.type === 'snapshot').length;
    await v.click(v.$('.page-failed button'));
    await v.settle(() => v.$('textarea'));
    assert.ok(!v.$('.page-failed'), 'the notice goes');
    assert.ok(v.$('textarea'), 'the chat is drawn again');
    assert.ok(v.port.toView.filter(m => m.type === 'snapshot').length > snapshotsBefore, 'the page said ready again and was given the state');
  } finally { console.error = quiet; v.dispose(); }
});
