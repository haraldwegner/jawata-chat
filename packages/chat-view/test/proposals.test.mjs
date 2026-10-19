// A proposal on R7 (two proposals as permission requests with a diff, answered yes and then no; real Claude, hooks off): the page shows the
// diff with Accept and Reject, and each answer reaches the agent.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { closeDom, viewOn } from './dom.mjs';

after(closeDom);

const answersSent = (v) => v.host.traffic.filter(t => t.direction === 'send' && t.message.result?.outcome).map(t => t.message.result.outcome.optionId);

test('R7: a proposal shows as a diff with Accept and Reject; Accept and Reject each reach the agent, and the next proposal then shows', async () => {
  const v = await viewOn('R7', { answering: false });
  try {
    await v.connect();
    await v.settle();
    await v.type('go');
    await v.key('Enter');
    await v.settle(() => v.$('.proposal'));
    assert.equal(v.$$('.proposal').length, 1);
    assert.equal(v.$('.proposal-title').textContent, 'Write a.txt');
    assert.equal(v.$('.proposal .tc-diff-path').textContent, '/workspace/a.txt');
    assert.equal(v.$('.proposal .tc-diff .add').textContent.trim(), '+ one');
    assert.deepEqual(v.$$('.proposal-choice').map(e => e.textContent), ['Accept', 'Reject'], 'the two answers, and not the blanket one the agent also offered');
    for (const e of v.$$('.proposal-choice')) { assert.ok(e.getAttribute('title').length > 20, 'a mouseover says what it does'); }
    assert.deepEqual(answersSent(v), [], 'nothing is answered yet');

    await v.click(v.$('.proposal-choice.accept'));
    await v.settle(() => v.$('.proposal-title')?.textContent === 'Write b.txt');
    assert.deepEqual(answersSent(v), ['allow-once']);
    assert.equal(v.$('.proposal .tc-diff .add').textContent.trim(), '+ two');

    await v.click(v.$('.proposal-choice.reject'));
    await v.settle(() => !v.$('.proposal') && !v.$('.send-stop-btn.stop'));
    assert.deepEqual(answersSent(v), ['allow-once', 'reject']);
    assert.ok(!v.$('.proposal'));
  } finally { v.dispose(); }
});
