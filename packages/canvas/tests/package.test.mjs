import test from 'node:test';
import assert from 'node:assert/strict';
import * as core from '@acheron-grid/core';
import * as headless from '@acheron-grid/core/headless';
import { createGrid } from '@acheron-grid/canvas';
import { readFile, access } from 'node:fs/promises';

test('package entries keep core headless and canvas depends only on public core', async () => {
  assert.equal(typeof globalThis.document, 'undefined');
  assert.equal(core.createGrid, undefined);
  assert.equal(core.createGridEngine, headless.createGridEngine);
  assert.equal(core.LocalDataSource, headless.LocalDataSource);
  assert.equal(typeof createGrid, 'function');
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url)));
  assert.deepEqual(pkg.dependencies, { '@acheron-grid/core': '0.0.0' });
  const source = await readFile(new URL('../src/grid.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /from ['"]\.{1,2}\//);
  for (const file of ['grid.js', 'grid.js.map', 'grid.d.ts']) {
    await assert.rejects(access(new URL('../../core/dist/' + file, import.meta.url)), { code: 'ENOENT' });
  }
});
