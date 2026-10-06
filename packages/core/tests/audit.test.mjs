import test from 'node:test';
import assert from 'node:assert/strict';
import { createGridEngine, LocalDataSource, createAsyncDataSource } from '../dist/index.js';

test('editing supports atomic batch-only sources and preserves permission/history checks', () => {
  const local = new LocalDataSource([{ name: 'Ada' }], (_, i) => i);
  const engine = createGridEngine({
    columns: [{ key: 'name', title: 'Name', editable: true }],
    dataSource: {
      getRowCount: () => local.getRowCount(),
      getRowId: (i) => local.getRowId(i),
      getValue: (i, key) => local.getValue(i, key),
      setValues: (updates) => local.setValues(updates),
    },
  });
  assert.equal(engine.canEdit(0, 0), true);
  engine.editCell(0, 0, 'Grace');
  assert.equal(engine.getValue(0, 'name'), 'Grace');
  engine.setLocked({ scope: 'cell', rowIndex: 0, columnIndex: 0 }, true);
  assert.equal(engine.canEdit(0, 0), false);
  assert.throws(() => engine.undo(), /permission denied/);
  engine.setLocked({ scope: 'cell', rowIndex: 0, columnIndex: 0 }, false);
  assert.equal(engine.undo(), true);
  assert.equal(engine.getValue(0, 'name'), 'Ada');
  assert.equal(engine.redo(), true);
  engine.destroy();
});

test('identity refresh drops collapsed groups that move across the frozen boundary', () => {
  const source = new LocalDataSource(
    Array.from({ length: 6 }, (_, id) => ({ id, name: String(id) })),
    (row) => row.id,
  );
  const engine = createGridEngine({ columns: [{ key: 'name', title: 'Name' }], dataSource: source, frozenRows: 2 });
  const group = engine.groupRows(2, 4);
  engine.setGroupCollapsed(group, true);
  const ids = engine.captureRowIdentity();
  const moved = [2, 3, 4, 0, 1, 5].map((i) => source.getRow(i));
  source.spliceRows([{ index: 0, deleteCount: 6, rows: moved }]);
  engine.refreshData(ids);
  assert.deepEqual(engine.getRowGroups(), []);
  assert.equal(engine.rowCount, 6);
  assert.equal(engine.frozenRows, 2);
  engine.restoreState(engine.exportState());
  engine.destroy();
});

test('async totals invalidate old positional pages and accept empty pages beyond a shrinking total', async () => {
  let total = 4,
    revision = 'old';
  const source = createAsyncDataSource({
    pageSize: 2,
    maxPages: 3,
    maxPendingLoads: 1,
    createAbortController: () => new AbortController(),
    load: async ({ offset, limit }) => ({
      total,
      rows: Array.from({ length: Math.max(0, Math.min(limit, total - offset)) }, () => ({ value: revision })),
    }),
  });
  await source.loadPage(0);
  total = 1;
  revision = 'new';
  await source.loadPage(2);
  assert.equal(source.getRowCount(), 1);
  assert.equal(source.getValue(0, 'value'), undefined);
  assert.equal(source.getPageState(0), null);
  assert.throws(() => source.loadRange(2, 5), /pending load limit/);
  assert.equal(source.getPageState(2).status, 'ready');
  assert.equal(source.getPageState(4), null);
  await source.loadPage(0);
  assert.equal(source.getValue(0, 'value'), 'new');
  total = 4;
  revision = 'grown';
  await source.loadPage(2);
  assert.equal(source.getValue(0, 'value'), undefined);
  await source.loadPage(0);
  assert.equal(source.getValue(1, 'value'), 'grown');
  source.destroy();
});

test('collapsed frozen counts stay correct through cached viewports, freeze history and view changes', () => {
  const source = new LocalDataSource(
    Array.from({ length: 8 }, (_, id) => ({ name: String(id) })),
    (_, i) => i,
  );
  const engine = createGridEngine({ columns: [{ key: 'name', title: 'Name' }], dataSource: source, frozenRows: 4 });
  const group = engine.groupRows(0, 2);
  engine.setGroupCollapsed(group, true);
  for (let i = 0; i < 3; i++) {
    assert.equal(engine.frozenRows, 2);
    assert.equal(engine.getViewport({ width: 300, height: 200, scrollLeft: 0, scrollTop: i * 10 }).frozenHeight, 64);
  }
  engine.setFrozen(3, 0);
  assert.equal(engine.frozenRows, 3);
  engine.undo();
  assert.equal(engine.frozenRows, 2);
  engine.redo();
  assert.equal(engine.frozenRows, 3);
  engine.setGroupCollapsed(group, false);
  assert.equal(engine.frozenRows, 5);
  engine.setView({ filters: [{ columnKey: 'name', query: '7', operator: 'equals' }] });
  assert.equal(engine.frozenRows, 1);
  engine.destroy();
});

test('projected selection preflights source fragmentation and clipboard bounds visible fragments', () => {
  const source = new LocalDataSource(
    Array.from({ length: 260 }, (_, id) => ({ order: id % 2 })),
    (_, i) => i,
  );
  const engine = createGridEngine({ columns: [{ key: 'order', title: 'Order' }], dataSource: source });
  engine.setView({ sort: { columnKey: 'order', direction: 'asc' } });
  engine.select(0, 0);
  const saved = engine.exportState();
  assert.throws(
    () => engine.selectRange({ startRow: 0, endRow: 129, startColumn: 0, endColumn: 0 }),
    /128 source ranges/,
  );
  assert.deepEqual(engine.exportState(), saved);
  engine.selectRange({ startRow: 0, endRow: 127, startColumn: 0, endColumn: 0 });
  engine.restoreState(engine.exportState());
  engine.setView({});
  assert.equal(engine.getSelectionRanges().length, 128);
  source.setValues(
    Array.from({ length: 260 }, (_, rowIndex) => ({
      rowIndex,
      columnKey: 'order',
      value: rowIndex < 130 ? rowIndex * 2 : (rowIndex - 130) * 2 + 1,
    })),
  );
  engine.refreshData('values');
  engine.selectRange({ startRow: 0, endRow: 129, startColumn: 0, endColumn: 0 });
  engine.setView({ sort: { columnKey: 'order', direction: 'asc' } });
  assert.throws(() => engine.copySelectionBlocks(), /128 visible ranges/);
  engine.setView({});
  const order = new Map([1, 0, 2, ...Array.from({ length: 127 }, (_, i) => 4 + i * 2)].map((id, rank) => [id, rank]));
  source.setValues(
    Array.from({ length: 260 }, (_, rowIndex) => ({
      rowIndex,
      columnKey: 'order',
      value: order.get(rowIndex) ?? 130 + rowIndex,
    })),
  );
  engine.refreshData('values');
  engine.setView({ sort: { columnKey: 'order', direction: 'asc' } });
  engine.select(0, 0);
  const beforeSplit = engine.exportState();
  assert.throws(
    () => engine.selectRange({ startRow: 0, endRow: 129, startColumn: 0, endColumn: 0 }),
    /128 source ranges/,
  );
  assert.deepEqual(engine.exportState(), beforeSplit);
  engine.destroy();
});
