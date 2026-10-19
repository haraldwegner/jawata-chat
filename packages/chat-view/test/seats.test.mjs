// A model per seat (R5: a model change with one `seat-model:<seat>` option per seat, two seats; derived, shape only).
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { closeDom, viewOn, sessionFile } from './dom.mjs';

after(closeDom);

const recorded = readFileSync(sessionFile('R5'), 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
const sentOptions = recorded.find(l => l.dir === 'recv' && l.msg.result?.configOptions).msg.result.configOptions;
const seatOptions = sentOptions.filter(o => o.id.startsWith('seat-model:'));
const valuesOf = (o) => o.options.flatMap(x => x.options ?? [x]).map(x => x.value);

test('R5: one selector per seat, labelled with the seat, offering exactly the choices the agent sent for it', async () => {
  const v = await viewOn('R5');
  try {
    await v.connect();
    await v.settle();
    const pickers = v.$$('.picker-wrap[data-config-id^="seat-model:"]');
    assert.equal(pickers.length, seatOptions.length, 'one per seat the agent sent');
    assert.ok(seatOptions.length >= 2);
    for (const option of seatOptions) {
      const picker = v.$(`.picker-wrap[data-config-id="${option.id}"]`);
      const seat = option.id.slice('seat-model:'.length);
      assert.match(picker.querySelector('.picker-label').textContent, new RegExp(`^${seat} · `), 'the seat is in the label');
      assert.deepEqual([...picker.querySelectorAll('.picker-dropdown-item')].map(e => e.dataset.value), valuesOf(option), 'the list is the agent\'s, whole');
    }
  } finally { v.dispose(); }
});

test('R5: choosing a model for one seat is session/set_config_option for that seat\'s option, and shows the agent\'s answer', async () => {
  const v = await viewOn('R5');
  try {
    await v.connect();
    await v.settle();
    const picker = v.$('.picker-wrap[data-config-id="seat-model:test-writer"]');
    const other = [...picker.querySelectorAll('.picker-dropdown-item')].find(e => !e.classList.contains('selected'));
    await v.click(picker.querySelector('.picker-btn'));
    await v.click(other);
    await v.settle(() => v.host.traffic.some(t => t.direction === 'send' && t.message.method === 'session/set_config_option'));
    const asked = v.host.traffic.filter(t => t.direction === 'send' && t.message.method === 'session/set_config_option').map(t => [t.message.params.configId, t.message.params.value]);
    assert.deepEqual(asked, [['seat-model:test-writer', other.dataset.value]]);
    await v.settle();
    const answered = recorded.filter(l => l.dir === 'recv' && l.msg.result?.configOptions).at(-1).msg.result.configOptions;
    for (const o of answered.filter(x => x.id.startsWith('seat-model:'))) {
      const current = v.$(`.picker-wrap[data-config-id="${o.id}"] .picker-dropdown-item.selected`).dataset.value;
      assert.equal(current, o.currentValue, `${o.id} shows what the agent answered`);
    }
  } finally { v.dispose(); }
});
