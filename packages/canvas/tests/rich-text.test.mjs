import test from 'node:test';
import assert from 'node:assert/strict';
import { richTextSource } from '../dist/rich-text.js';
import { markdownToHtml } from '@acheron-grid/markdown';

test('Markdown serialization preserves parentheses in link destinations', () => {
  for (const path of ['a)b', 'a(b', 'a(b)c']) {
    const href = 'https://example.com/' + path;
    const markdown = richTextSource({ text: 'link', runs: [{ text: 'link', href }] }, 'markdown');
    const encoded = href.replaceAll('(', '%28').replaceAll(')', '%29');
    assert.equal(markdownToHtml(markdown), `<p><a href="${encoded}">link</a></p>\n`);
  }
});
