// The markdown the view shows is rendered by a pure function of the view: the round trip through the host is gone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderMarkdown } from '../dist/markdown.js';

test('bold, code and line breaks render', () => {
  assert.match(renderMarkdown('**bold** and `code`'), /<strong>bold<\/strong> and <code>code<\/code>/);
  assert.match(renderMarkdown('a\nb'), /a<br>b/);
});

test('tables and lists render (GitHub-flavoured)', () => {
  assert.match(renderMarkdown('| a | b |\n|---|---|\n| 1 | 2 |'), /<table>/);
  assert.match(renderMarkdown('- one\n- two'), /<ul>/);
});

test('it does not make the html safe: the view sanitises it before it is inserted', () => {
  assert.match(renderMarkdown('<script>x()</script>'), /<script>/);
});
