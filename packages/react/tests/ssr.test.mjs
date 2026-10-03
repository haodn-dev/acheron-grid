import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { createSSRApp } from 'vue';
import { renderToString as renderVue } from '@vue/server-renderer';
import { AcheronGrid as ReactGrid } from '../dist/index.js';
import { AcheronGrid as VueGrid } from '../../vue/dist/index.js';
import { LocalDataSource } from '@acheron-grid/core';

test('React and Vue SSR render containers without browser globals or creating grids', async () => {
  const options = { columns: [{ key: 'name', title: 'Name' }], dataSource: new LocalDataSource([{ id: 1, name: 'Alpha' }], row => row.id) };
  const ready = () => assert.fail('SSR must not mount a grid');
  assert.equal(renderToString(createElement(ReactGrid, { options, onReady: ready })), '<div></div>');
  assert.equal(await renderVue(createSSRApp(VueGrid, { options, onReady: ready })), '<div></div>');
});
