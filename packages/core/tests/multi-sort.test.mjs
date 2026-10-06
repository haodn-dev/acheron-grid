import test from 'node:test';
import assert from 'node:assert/strict';
import { createGridEngine, LocalDataSource, LocalDataView } from '@acheron-grid/core';

const rows = [{ id: 0, team: 'B', score: 2 }, { id: 1, team: 'A', score: 1 }, { id: 2, team: 'A', score: 3 }, { id: 3, team: 'A', score: 3 }, { id: 4, team: null, score: 9 }, { id: 5, team: null, score: null }];
const sorts = [{ columnKey: 'team', direction: 'asc' }, { columnKey: 'score', direction: 'desc' }];
const ids = view => Array.from({ length: view.getRowCount?.() ?? view.rowCount }, (_, i) => view.getRowId(i));

test('multi-sort compares keys in priority order, keeps nullish last and preserves ties', () => {
  const source = new LocalDataSource(rows, row => row.id);
  const view = new LocalDataView(source, { sorts });
  assert.deepEqual(ids(view), [2, 3, 1, 0, 4, 5]);
  assert.deepEqual(ids(new LocalDataView(source, { sorts: [{ columnKey: 'team', direction: 'desc' }, sorts[1]] })), [0, 2, 3, 1, 4, 5]);
  assert.deepEqual(ids(new LocalDataView(source, { sorts: [] })), [0, 1, 2, 3, 4, 5]);
  view.setValue(0, 'score', 10); assert.equal(source.getValue(2, 'score'), 10);
  for (const options of [{ sort: sorts[0], sorts }, { sorts: [sorts[0], sorts[0]] }, { sorts: [{ columnKey: 'team', direction: 'bad' }] }]) assert.throws(() => new LocalDataView(source, options), /Invalid local sort/);
});

test('engine multi-sort preserves identity/history, isolates criteria and round-trips state', () => {
  const source = new LocalDataSource(rows, row => row.id);
  const engine = createGridEngine({ dataSource: source, columns: [{ key: 'team', title: 'Team', editable: true }, { key: 'score', title: 'Score', editable: true }] });
  engine.select(1, 1);
  const criteria = structuredClone(sorts);
  engine.setView({ sorts: criteria });
  criteria[0].direction = 'desc';
  assert.deepEqual(ids(engine), [2, 3, 1, 0, 4, 5]);
  assert.equal(engine.getSelection().rowId, 1);
  engine.updateCells([{ rowIndex: 2, columnKey: 'score', value: 20 }]);
  assert.deepEqual(ids(engine), [1, 2, 3, 0, 4, 5]);
  engine.undo(); assert.deepEqual(ids(engine), [2, 3, 1, 0, 4, 5]);
  engine.redo(); assert.equal(source.getValue(1, 'score'), 20);
  const saved = engine.exportState(); engine.setView({}); engine.restoreState(saved);
  assert.deepEqual(engine.exportState(), saved);
  assert.throws(() => { engine.view.sorts[0].direction = 'desc'; }, TypeError);
  const bad = structuredClone(saved); bad.configuration.view.sorts.push({ columnKey: 'team', direction: 'desc' });
  assert.throws(() => engine.restoreState(bad), /Duplicate/); assert.deepEqual(engine.exportState(), saved);
  assert.throws(() => engine.setView({ sorts: [{ columnKey: 'missing', direction: 'asc' }] }), /Unknown view column/);
  assert.deepEqual(engine.exportState(), saved);
  engine.destroy();
});

test('multi-sort moves outline blocks together and filtering retains whole blocks', () => {
  const source = new LocalDataSource(rows.slice(0, 4), row => row.id);
  const engine = createGridEngine({ dataSource: source, columns: [{ key: 'team', title: 'Team' }, { key: 'score', title: 'Score' }] });
  engine.groupRows(0, 1);
  engine.setView({ sorts });
  assert.deepEqual(ids(engine), [2, 3, 0, 1]);
  assert.throws(() => engine.groupRows(0, 1), /unsorted/);
  engine.setView({ sorts, filters: [{ columnKey: 'score', operator: 'equals', query: '1' }] });
  assert.deepEqual(ids(engine), [0, 1]);
  engine.destroy();
});
