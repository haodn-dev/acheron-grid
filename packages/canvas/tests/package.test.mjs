import test from 'node:test';
import assert from 'node:assert/strict';
import * as core from '@acheron-grid/core';
import * as headless from '@acheron-grid/core/headless';
import { createGrid, detectLinks } from '@acheron-grid/canvas';
import { readFile, access } from 'node:fs/promises';

test('package entries keep core headless and canvas depends only on public core', async () => {
  assert.equal(typeof globalThis.document, 'undefined');
  assert.equal(core.createGrid, undefined);
  assert.equal(core.createGridEngine, headless.createGridEngine);
  assert.equal(core.LocalDataSource, headless.LocalDataSource);
  assert.equal(typeof createGrid, 'function');
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url)));
  assert.deepEqual(pkg.dependencies, { '@acheron-grid/core': pkg.version });
  const source = await readFile(new URL('../src/grid.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /from ['"][^'"]*core\//);
  for (const file of ['grid.js', 'grid.js.map', 'grid.d.ts']) {
    await assert.rejects(access(new URL('../../core/dist/' + file, import.meta.url)), { code: 'ENOENT' });
  }
});

test('link detection preserves offsets, punctuation and balanced URLs, rejects unsafe schemes and credentials', () => {
  const text = 'See (https://example.com/a(b)), www.example.org/path. Then https://example.net/?a=1&b=2!';
  const links = detectLinks(text);
  assert.deepEqual(links.map(link => link.href), ['https://example.com/a(b)', 'https://www.example.org/path', 'https://example.net/?a=1&b=2']);
  for (const link of links) assert.equal(text.slice(link.start, link.end), link.text);
  for (const value of [null, 42, 'javascript:alert(1)', 'data:text/html,<script>', 'file:///x', 'https://user:secret@example.com', 'email@www.example.com', 'javascript:https://example.com', 'https://', 'https://example.com/\u0000x']) assert.deepEqual(detectLinks(value), []);
  assert.equal(detectLinks('HTTPS://EXAMPLE.COM/')[0].href, 'https://example.com/');
  assert.equal(detectLinks('https://example.com/a' + ')'.repeat(20000) + '].')[0].href, 'https://example.com/a');
});
