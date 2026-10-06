import assert from 'node:assert/strict';
import test from 'node:test';
import { createGridEngine, LocalDataSource } from '@acheron-grid/core';
import { createInteraction } from '../dist/internal/interaction.js';

test('visible indices combine frozen and scrolled panes once per axis without browser globals', () => {
  const columns = Array.from({ length: 8 }, (_, index) => ({ key: `c${index}`, title: `C${index}` }));
  const rows = Array.from({ length: 10 }, (_, index) => Object.fromEntries(columns.map(({ key }) => [key, index])));
  const engine = createGridEngine({
    columns,
    dataSource: new LocalDataSource(rows, (_, index) => index),
    rowHeight: 20,
    columnWidth: 30,
    frozenRows: 1,
    frozenColumns: 1,
  });
  let dimensions = { width: 90, height: 60, scrollTop: 80, scrollLeft: 120 };
  const interaction = createInteraction({ viewport: () => engine.getViewport(dimensions) });
  try {
    assert.deepEqual([...interaction.visibleIndices('row')], [0, 5, 6]);
    assert.deepEqual([...interaction.visibleIndices('column')], [0, 5, 6]);
    dimensions = { ...dimensions, width: 0, height: 0 };
    assert.equal(interaction.visibleIndices('row').size, 0);
    assert.equal(interaction.visibleIndices('column').size, 0);
  } finally {
    engine.destroy();
  }
});
