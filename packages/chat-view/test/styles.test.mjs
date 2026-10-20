// The stylesheet is the view's own: scoped to the view, drawing on the host's theme, with no colour or font of its own outside its named tokens.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CHAT_CSS } from '../dist/styles.js';

/** [selectors, body] of each plain rule (not the keyframes or media blocks, which hold rules of their own). */
function rulesOf(css) {
  const rules = [];
  const stripped = css.replace(/@keyframes[^{]+\{(?:[^{}]*\{[^}]*\})*[^}]*\}/g, '');
  for (const match of stripped.matchAll(/([^{}@]+)\{([^{}]*)\}/g)) { rules.push([match[1].trim(), match[2]]); }
  return rules;
}

test('every selector of every rule begins with the view\'s scope: it can sit in any page without touching it', () => {
  const rules = rulesOf(CHAT_CSS);
  assert.ok(rules.length > 60, `found ${rules.length} rules`);
  for (const [selectors] of rules) {
    for (const selector of selectors.split(',').map(s => s.trim())) {
      assert.ok(selector.startsWith('.jc-chat'), `unscoped selector: ${selector}`);
    }
  }
});

test('the media block is scoped too', () => {
  const media = CHAT_CSS.slice(CHAT_CSS.indexOf('@media'));
  assert.match(media, /\.jc-chat \.spinner/);
});

test('a colour literal appears only in the definition of a named token, never in a rule', () => {
  const literal = /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/;
  for (const [selectors, body] of rulesOf(CHAT_CSS)) {
    if (selectors === '.jc-chat') { continue; } // the host rule holds the tokens
    assert.doesNotMatch(body, literal, `${selectors} names a colour`);
  }
  for (const line of CHAT_CSS.split('\n').filter(l => literal.test(l))) {
    assert.match(line.trim(), /^--jc-[a-z-]+: var\(--jc-host-[a-z-]+, [^)]*(#[0-9a-fA-F]{3,8})[^)]*\);$/, `a literal outside a token: ${line}`);
  }
});

test('there is no font of its own: the family is the host\'s or the system\'s', () => {
  assert.doesNotMatch(CHAT_CSS, /@font-face|url\(/);
  for (const family of CHAT_CSS.match(/font-family:[^;]+;/g) ?? []) {
    assert.match(family, /var\(--jc-(host-)?(font|mono)/, family);
  }
});

test('the things that can grow without bound are bounded and scroll: the plan, the queue, the agents and the proposals', () => {
  const body = (selector) => rulesOf(CHAT_CSS).find(([s]) => s === `.jc-chat ${selector}`)[1];
  for (const selector of ['.plan', '.queue', '.agents', '.proposals', '.history']) {
    assert.match(body(selector), /max-height/, `${selector} has no limit`);
    assert.match(body(selector), /overflow-y: auto/, `${selector} does not scroll`);
  }
});
