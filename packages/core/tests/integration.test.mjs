import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGridEngine, LocalDataSource, createAsyncDataSource } from '../dist/index.js';
const columns = [
  { key: 'a', title: 'A', editable: true },
  { key: 'b', title: 'B', editable: true },
];
function fixture() {
  const source = new LocalDataSource(
    Array.from({ length: 8 }, (_, id) => ({ id, a: 'A' + id, b: 'B' + id })),
    (row) => row.id,
  );
  return { source, engine: createGridEngine({ columns, dataSource: source }) };
}
test('multiple observers can unsubscribe, failures never turn committed writes into failed mutations', () => {
  const { engine, source } = fixture();
  let a = 0,
    b = 0;
  const errors = [];
  const off = engine.subscribe({ onEvent: () => a++ });
  engine.subscribe({
    onInvalidate: () => {
      throw new Error('Observer');
    },
    onEvent: () => b++,
  });
  engine.updateCells([{ rowIndex: 0, columnKey: 'a', value: 'New' }]);
  assert.equal(source.getValue(0, 'a'), 'New');
  assert.equal(a, 1);
  assert.equal(b, 1);
  assert.equal(engine.takeObserverErrors().length, 1);
  off();
  engine.undo();
  assert.equal(a, 1);
  assert.equal(b, 2);
  engine.destroy();
  assert.throws(() => engine.subscribe({}), /destroyed/);
});
test('external refresh remaps sparse state by stable IDs and drops unsafe history', () => {
  const { engine, source } = fixture();
  engine.select(2, 0);
  engine.setLocked({ scope: 'row', rowIndex: 2 }, true);
  engine.format([{ scope: 'cell', rowIndex: 2, columnIndex: 1 }], { background: '#123456' });
  engine.setRowHeight(2, 55);
  const ids = engine.captureRowIdentity();
  const moved = source.getRow(2);
  source.spliceRows([
    { index: 2, deleteCount: 1, rows: [] },
    { index: 0, deleteCount: 0, rows: [moved] },
  ]);
  engine.refreshData(ids);
  assert.equal(engine.getSelection().rowId, 2);
  assert.equal(engine.getSelection().rowIndex, 0);
  assert.equal(engine.isLocked({ scope: 'row', rowIndex: 0 }), true);
  assert.equal(engine.getFormat(0, 1).background, '#123456');
  assert.equal(engine.rows.size(0), 55);
  assert.equal(engine.canUndo(), false);
  source.spliceRows([{ index: 0, deleteCount: 1, rows: [] }]);
  engine.refreshData();
  assert.equal(engine.rowCount, 7);
  assert.equal(engine.getSelection(), null);
  assert.equal(engine.isLocked({ scope: 'row', rowIndex: 0 }), false);
});
test('state restores outlines, sparse formatting priority, selection, locks, sizes and view atomically', () => {
  const { engine } = fixture();
  engine.format([{ scope: 'row', rowIndex: 1 }], { background: '#123456' });
  engine.format([{ scope: 'cell', rowIndex: 1, columnIndex: 0 }], { background: '#abcdef' });
  engine.format([{ scope: 'row', rowIndex: 1 }], { fontWeight: 'bold' });
  engine.mergeCells({ startRow: 3, endRow: 4, startColumn: 0, endColumn: 1 });
  const group = engine.groupRows(0, 2);
  engine.selectRange({ startRow: 5, endRow: 6, startColumn: 0, endColumn: 1 });
  engine.setLocked({ scope: 'row', rowIndex: 6 }, true);
  engine.setRowHeight(1, 61);
  engine.setGroupCollapsed(group, true);
  const saved = JSON.parse(JSON.stringify(engine.exportState()));
  engine.restoreState(saved);
  assert.equal(engine.getRowGroups()[0].id, group);
  assert.equal(engine.getRowGroups()[0].collapsed, true);
  assert.equal(engine.getMergedCells().length, 1);
  assert.deepEqual(engine.exportState(), saved);
  assert.equal(engine.canUndo(), false);
  const crossesFreeze = structuredClone(saved);
  crossesFreeze.configuration.frozenRows = 2;
  assert.throws(() => engine.restoreState(crossesFreeze), /frozen boundary/);
  assert.deepEqual(engine.exportState(), saved);
  const broken = structuredClone(saved);
  broken.formats.push({ target: { scope: 'cell', rowIndex: 999, columnIndex: 0 }, patch: { background: '#000' } });
  assert.throws(() => engine.restoreState(broken));
  assert.deepEqual(engine.exportState(), saved);
  engine.setGroupCollapsed(group, false);
  assert.equal(engine.getFormat(1, 0).background, '#abcdef');
  assert.equal(engine.getFormat(1, 0).fontWeight, 'bold');
});
test('sort and filter preserve outline blocks and collapsed children', () => {
  const { engine, source } = fixture();
  source.setValue(0, 'a', 'Z');
  source.setValue(3, 'a', 'A');
  engine.groupRows(0, 2);
  engine.mergeCells({ startRow: 3, endRow: 4, startColumn: 0, endColumn: 1 });
  engine.setView({ sort: { columnKey: 'a', direction: 'asc' } });
  assert.deepEqual(
    Array.from({ length: engine.rowCount }, (_, i) => engine.getRowId(i)),
    [3, 4, 5, 6, 7, 0, 1, 2],
  );
  engine.setView({ filters: [{ columnKey: 'b', query: 'B1', operator: 'equals' }] });
  assert.deepEqual(
    Array.from({ length: engine.rowCount }, (_, i) => engine.getRowId(i)),
    [0, 1, 2],
  );
  engine.setGroupCollapsed(engine.getRowGroups()[0].id, true);
  assert.equal(engine.rowCount, 1);
  assert.equal(engine.getRowId(0), 0);
});
test('async paging shares requests, exposes errors, rejects malformed responses and ignores canceled responses', async () => {
  let calls = 0,
    resolve;
  const pending = new Promise((r) => (resolve = r));
  const source = createAsyncDataSource({
    pageSize: 2,
    createAbortController: () => new AbortController(),
    load: async () => {
      calls++;
      return pending;
    },
  });
  const a = source.loadPage(0),
    b = source.loadPage(0);
  assert.equal(a, b);
  await Promise.resolve();
  assert.equal(calls, 1);
  source.cancel();
  resolve({ total: 2, rows: [{ a: 'stale' }, { a: 'stale' }] });
  await a;
  assert.equal(source.getRowCount(), 0);
  const invalid = createAsyncDataSource({
    pageSize: 2,
    createAbortController: () => new AbortController(),
    load: async () => ({ total: 3, rows: [{ a: 'missing' }] }),
  });
  await assert.rejects(invalid.loadPage(0), /Invalid page/);
  assert.equal(invalid.getPageState(0).status, 'error');
  assert.equal(invalid.getRowCount(), 0);
  const good = createAsyncDataSource({
    pageSize: 2,
    rowCount: 4,
    maxPages: 1,
    createAbortController: () => new AbortController(),
    load: async ({ offset }) => ({ total: 4, rows: [{ a: offset }, { a: offset + 1 }] }),
  });
  await good.loadPage(0);
  assert.equal(good.getValue(1, 'a'), 1);
  await good.loadPage(2);
  assert.equal(good.getValue(0, 'a'), undefined);
  assert.equal(good.getValue(2, 'a'), 2);
  good.reset();
  assert.equal(good.getRowCount(), 0);
  good.destroy();
  assert.throws(() => good.loadPage(0), /destroyed/);
});

test('restore column order respects structural veto and table locks without changing state or history', () => {
  const source = new LocalDataSource([{ a: 'A', b: 'B' }], (_, i) => i);
  let allowed = true;
  let request;
  const engine = createGridEngine({
    columns,
    dataSource: source,
    canChangeStructure: (value) => {
      request = value;
      return allowed;
    },
  });
  engine.editCell(0, 0, 'Changed');
  const saved = engine.exportState();
  const reordered = structuredClone(saved);
  reordered.configuration.columns.reverse();
  allowed = false;
  assert.throws(() => engine.restoreState(reordered), /Structural change/);
  assert.deepEqual(engine.exportState(), saved);
  assert.equal(engine.canUndo(), true);
  assert.deepEqual(request.order, [1, 0]);
  allowed = true;
  engine.setLocked({ scope: 'table' }, true);
  const locked = engine.exportState();
  assert.throws(() => engine.restoreState(reordered), /Unlock the table/);
  assert.deepEqual(engine.exportState(), locked);
  engine.setLocked({ scope: 'table' }, false);
  engine.restoreState(reordered);
  assert.deepEqual(
    engine.columns.map((column) => column.key),
    ['b', 'a'],
  );
  assert.equal(engine.canUndo(), false);
  engine.destroy();
});

test('remote values use own properties and failed-page metadata is bounded without losing pending loads', async () => {
  let fail = true,
    release;
  const source = createAsyncDataSource({
    pageSize: 1,
    maxPages: 1,
    rowCount: 5,
    createAbortController: () => new AbortController(),
    load: async ({ offset }) => {
      if (offset === 4) return new Promise((resolve) => (release = resolve));
      if (fail) throw Error('offline');
      return { total: 5, rows: [{ a: null, toString: 'own' }] };
    },
  });
  const loading = source.loadPage(4);
  await Promise.resolve();
  for (let offset = 0; offset < 3; offset++) await assert.rejects(source.loadPage(offset), /offline/);
  assert.equal(source.getPageState(0), null);
  assert.equal(source.getPageState(1), null);
  assert.equal(source.getPageState(2).status, 'error');
  assert.equal(source.getPageState(4).status, 'loading');
  fail = false;
  await source.loadPage(2);
  assert.equal(source.getPageState(2).status, 'ready');
  assert.equal(source.getValue(2, 'a'), null);
  assert.equal(source.getValue(2, 'toString'), 'own');
  assert.equal(source.getValue(2, 'constructor'), undefined);
  assert.equal(source.getValue(0, 'a'), undefined);
  release({ total: 5, rows: [{ a: 1 }] });
  await loading;
  assert.equal(source.getValue(4, 'toString'), undefined);
  source.destroy();
});

test('restore retains projected selection extension and checks removal policies atomically', () => {
  const left = fixture().engine,
    right = fixture().engine;
  for (const engine of [left, right]) {
    engine.setView({ sort: { columnKey: 'a', direction: 'desc' } });
    engine.selectRange({ startRow: 1, endRow: 4, startColumn: 0, endColumn: 0 });
  }
  right.restoreState(JSON.parse(JSON.stringify(left.exportState())));
  left.select(2, 0, true);
  right.select(2, 0, true);
  assert.deepEqual(right.getSelectionRanges(), left.getSelectionRanges());
  let allow = true;
  const source = new LocalDataSource(
    [
      { a: 'a', b: 'b' },
      { a: 'c', b: 'd' },
    ],
    (_, i) => i,
  );
  const engine = createGridEngine({
    columns,
    dataSource: source,
    canChangeLayout: () => allow,
    resolveCellPermission: () => ({ formatting: allow }),
  });
  engine.mergeCells({ startRow: 0, endRow: 1, startColumn: 0, endColumn: 0 });
  const saved = engine.exportState();
  const without = structuredClone(saved);
  without.merges = [];
  allow = false;
  assert.throws(() => engine.restoreState(without), /Removing merged/);
  assert.deepEqual(engine.exportState(), saved);
  allow = true;
  engine.unmergeCells(saved.merges[0]);
  engine.format([{ scope: 'cell', rowIndex: 0, columnIndex: 0 }], { background: '#fff' });
  const formatted = engine.exportState();
  const cleared = structuredClone(formatted);
  cleared.formats = [];
  allow = false;
  assert.throws(() => engine.restoreState(cleared), /formatting/);
  assert.deepEqual(engine.exportState(), formatted);
});
