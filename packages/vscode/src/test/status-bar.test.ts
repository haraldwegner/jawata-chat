import * as assert from 'assert';
import { statusLine } from '../ui/StatusBar';

suite('the status bar item (D54 (j))', () => {
  test('says jawata in words and carries no built-in icon when it is not failed', () => {
    for (const line of [statusLine(false, undefined), statusLine(false, 'jawata')]) {
      assert.ok(line.text.startsWith('jawata chat: '), line.text);
      assert.ok(!line.text.includes('$('), `no icon in "${line.text}"`);
    }
  });

  test('names the agent it is connected to, and says when it is not connected', () => {
    assert.strictEqual(statusLine(false, 'jawata').text, 'jawata chat: jawata');
    assert.strictEqual(statusLine(false, undefined).text, 'jawata chat: not connected');
  });

  test('a failure keeps the error mark, because it is a warning', () => {
    assert.ok(statusLine(true, 'jawata').text.startsWith('$(error)'));
  });
});
