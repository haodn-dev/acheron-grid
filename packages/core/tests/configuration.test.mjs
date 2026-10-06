import test from 'node:test';
import assert from 'node:assert/strict';
import { createGridEngine, restoreGridConfiguration, LocalDataSource } from '@acheron-grid/core';

test('configuration round trip keeps layout and view without serializing data or policies', () => {
  const columns = [
    { key: 'name', title: 'Name', parse: (text) => text },
    { key: 'score', title: 'Score' },
  ];
  const dataSource = new LocalDataSource(
    [
      { id: 1, name: 'Ada', score: 2 },
      { id: 2, name: 'Grace', score: 1 },
    ],
    (row) => row.id,
  );
  const engine = createGridEngine({ columns, dataSource });
  engine.moveColumns([1], 0);
  engine.setColumnWidth(0, 220);
  engine.setFrozen(2, 1);
  engine.setView({
    sort: { columnKey: 'score', direction: 'asc' },
    filters: [{ columnKey: 'name', query: 'Ada', operator: 'equals' }],
  });
  const snapshot = JSON.parse(JSON.stringify(engine.exportConfiguration()));
  assert.equal(snapshot.frozenRows, 2); // Source count, even when the filtered view has one row.
  assert.deepEqual(Object.keys(snapshot).sort(), ['columns', 'frozenColumns', 'frozenRows', 'version', 'view']);
  const options = restoreGridConfiguration(snapshot, columns, 2);
  assert.equal(options.columns[1], columns[0]);
  const restored = createGridEngine({ ...options, dataSource });
  assert.deepEqual(restored.exportConfiguration(), snapshot);
  assert.equal(restored.getValue(0, 'name'), 'Ada');
  snapshot.view.filters[0].query = 'Grace';
  assert.equal(restored.view.filters[0].query, 'Ada');
  for (const bad of [
    null,
    { ...snapshot, version: 2 },
    { ...snapshot, columns: [snapshot.columns[0], snapshot.columns[0]] },
    { ...snapshot, frozenRows: 3 },
    { ...snapshot, columns: [{ key: 'score', width: Infinity }, snapshot.columns[1]] },
    { ...snapshot, view: { sort: { columnKey: 'missing', direction: 'asc' } } },
    { ...snapshot, view: { filters: [{ columnKey: 'name', query: '', operator: 'bad' }] } },
  ]) {
    assert.throws(() => restoreGridConfiguration(bad, columns, 2));
  }
  assert.throws(() => restoreGridConfiguration(snapshot, columns.slice(0, 1), 2));
  engine.destroy();
  assert.throws(() => engine.exportConfiguration());
});
