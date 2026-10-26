import test from 'node:test';
import assert from 'node:assert/strict';
import { createGridEngine, createPagedRemoteDataSource } from '../dist/index.js';
import { GridAxis } from '../dist/axis.js';

function fixture(count = 1_000_000, extra = {}) {
  const identities = new Map(),
    values = new Map(),
    reads = [];
  let total = count,
    writes = 0;
  const source = {
    getRowCount: () => total,
    getRowId: (row) => {
      reads.push(row);
      return identities.has(row) ? identities.get(row) : `row:${row}`;
    },
    getValue: (row) => values.get(row) ?? `value:${row}`,
    setValue: (row, _key, value) => {
      writes++;
      values.set(row, value);
    },
    setValues: (updates) => {
      writes++;
      for (const update of updates) values.set(update.rowIndex, update.value);
    },
  };
  const events = [],
    invalidations = [];
  const engine = createGridEngine({
    dataSource: source,
    columns: [{ key: 'value', title: 'Value', editable: true }],
    onEvent: (event) => events.push(event),
    onInvalidate: (change) => invalidations.push(change),
    ...extra,
  });
  return {
    engine,
    source,
    identities,
    reads,
    events,
    invalidations,
    setTotal: (value) => {
      total = value;
    },
    writes: () => writes,
  };
}

test('million-row refresh reads only its explicit window and emits no source-sized row map', () => {
  const { engine, reads, events, invalidations, writes } = fixture();
  engine.select(900000, 0);
  reads.length = 0;
  const result = engine.refreshRows(100, 199);
  assert.equal(reads.length, 100);
  assert.deepEqual(
    reads,
    Array.from({ length: 100 }, (_, i) => i + 100),
  );
  assert.deepEqual(result, {
    startRow: 100,
    endRow: 199,
    droppedHistoryEntries: 0,
    selectionCleared: false,
    cutCancelled: false,
  });
  assert.ok(Object.isFrozen(result));
  assert.deepEqual(invalidations.at(-1), { type: 'rows', startRow: 100, endRow: 199 });
  assert.deepEqual(events.at(-1), { type: 'data:rows', ...result });
  assert.equal(engine.getSelection().rowId, 'row:900000');
  assert.equal(writes(), 0);
});

test('row identity changes drop whole affected undo/redo batches and retain unrelated value history', () => {
  const { engine, identities, source, writes } = fixture();
  engine.updateCells([{ rowIndex: 900000, columnKey: 'value', value: 'outside' }]);
  engine.updateCells([
    { rowIndex: 10, columnKey: 'value', value: 'a' },
    { rowIndex: 900001, columnKey: 'value', value: 'b' },
  ]);
  engine.updateCells([{ rowIndex: 11, columnKey: 'value', value: 'redo' }]);
  engine.undo();
  engine.select(10, 0);
  identities.set(10, 'replacement');
  identities.set(11, 'replacement-two');
  const before = writes();
  const result = engine.refreshRows(10, 11);
  assert.equal(writes(), before);
  assert.equal(result.droppedHistoryEntries, 2);
  assert.equal(result.selectionCleared, true);
  assert.equal(engine.getSelection(), null);
  assert.equal(engine.redo(), false);
  assert.equal(engine.undo(), true);
  assert.equal(source.getValue(900000, 'value'), 'value:900000');
  assert.equal(source.getValue(900001, 'value'), 'b'); // affected batch was discarded, never partially replayed
  assert.equal(engine.undo(), false);
});

test('typed IDs preserve a matching single cell; intersecting ranges and pending cuts are cleared', () => {
  const { engine, identities, events } = fixture();
  identities.set(0, 0);
  identities.set(1, '');
  engine.select(0, 0);
  engine.cutSelectionBlocks();
  const result = engine.refreshRows(0, 1);
  assert.equal(engine.getSelection().rowId, 0);
  assert.equal(result.selectionCleared, false);
  assert.equal(result.cutCancelled, true);
  engine.select(1, 0);
  assert.equal(engine.refreshRows(1, 1).selectionCleared, false);
  assert.equal(engine.getSelection().rowId, '');
  engine.selectRange({ startRow: 0, endRow: 5, startColumn: 0, endColumn: 0 });
  assert.equal(engine.refreshRows(2, 2).selectionCleared, true);
  assert.deepEqual(engine.getSelectionRanges(), []);
  assert.ok(events.some((event) => event.type === 'selection:change' && event.selection === null));
});

test('invalid counts/windows/IDs and unsupported metadata fail before changing selection or history', () => {
  const { engine, identities, setTotal } = fixture();
  engine.updateCells([{ rowIndex: 3, columnKey: 'value', value: 'edited' }]);
  engine.select(3, 0);
  for (const range of [
    [-1, 0],
    [0, -1],
    [0.5, 1],
    [0, 1000000],
  ])
    assert.throws(() => engine.refreshRows(...range), RangeError);
  setTotal(2);
  assert.throws(() => engine.refreshRows(0, 1), /unchanged count/);
  setTotal(1000000);
  for (const id of [NaN, Infinity, null, {}, false]) {
    identities.set(3, id);
    assert.throws(() => engine.refreshRows(3, 3), TypeError);
  }
  identities.set(3, 'row:3');
  identities.set(4, 'row:3');
  assert.throws(() => engine.refreshRows(3, 4), /duplicate/);
  identities.delete(4);
  assert.equal(engine.getSelection().rowId, 'row:3');
  assert.equal(engine.undo(), true);
  assert.equal(engine.redo(), true);
  engine.setRowHeight(0, 48);
  assert.throws(() => engine.refreshRows(0, 1), /flat uniform/);
  engine.undo(); // dimension restored, but identity-dependent redo entry still blocks
  assert.throws(() => engine.refreshRows(0, 1), /history/);
  const axis = new GridAxis(10, 32);
  assert.equal(axis.hasOverrides, false);
  axis.replaceHidden([1]);
  assert.equal(axis.hasOverrides, true);
});

test('matching IDs keep value history under normal preflight conflicts and column geometry history', () => {
  const { engine, source } = fixture();
  engine.updateCells([{ rowIndex: 3, columnKey: 'value', value: 'edited' }]);
  engine.setColumnWidth(0, 200);
  assert.equal(engine.refreshRows(0, 9).droppedHistoryEntries, 0);
  assert.equal(engine.undo(), true); // column resize
  source.setValue(3, 'value', 'external');
  assert.equal(engine.refreshRows(0, 9).droppedHistoryEntries, 0);
  assert.throws(() => engine.undo(), /conflict/i);
  assert.equal(source.getValue(3, 'value'), 'external');
});

test('row refresh rejects projections, row visibility, locks and formatting before emitting changes', () => {
  for (const setup of [
    (engine) => engine.setView({ sort: { columnKey: 'value', direction: 'asc' } }),
    (engine) => engine.setGrouping({ columnKey: 'value' }),
    (engine) => engine.setRowsHidden([1], true),
    (engine) => engine.setLocked({ scope: 'row', rowIndex: 1 }, true),
    (engine) => engine.format([{ scope: 'row', rowIndex: 1 }], { background: '#ffffff' }),
  ]) {
    const { engine, events, writes } = fixture(8, { allowLockChanges: true });
    setup(engine);
    const count = events.length;
    assert.throws(() => engine.refreshRows(0, 1), /requires/);
    assert.equal(events.length, count);
    assert.equal(writes(), 0);
    engine.destroy();
  }
});

test('paged dirty drafts and verified value history survive cache eviction and reload without global refresh', async () => {
  const source = createPagedRemoteDataSource({
    datasetId: 'window-test',
    columnKeys: ['value'],
    rowCount: 1000000,
    pageSize: 10,
    maxPages: 1,
    createAbortController: () => new AbortController(),
    createMutationId: () => 'unused',
    load: async ({ offset, limit }) => ({
      datasetId: 'window-test',
      revision: 'r1',
      total: 1000000,
      rows: Array.from({ length: limit }, (_, i) => ({ id: offset + i, values: { value: `row:${offset + i}` } })),
    }),
    write: async () => {
      throw new Error('No write transport in refresh spike.');
    },
  });
  const engine = createGridEngine({ dataSource: source, columns: [{ key: 'value', title: 'Value', editable: true }] });
  engine.select(0, 0); // placeholder identity
  await source.loadPage(0);
  assert.equal(engine.refreshRows(0, 9).selectionCleared, true);
  engine.updateCells([{ rowIndex: 0, columnKey: 'value', value: 'draft' }]);
  await source.loadPage(10); // evicts page0; dirty row ID/value remain in source draft map
  assert.equal(source.getPageState(0), null);
  assert.equal(source.getValue(0, 'value'), 'draft');
  assert.equal(engine.refreshRows(0, 19).droppedHistoryEntries, 0);
  await source.loadPage(0);
  assert.equal(engine.refreshRows(0, 19).droppedHistoryEntries, 0);
  assert.equal(engine.undo(), true);
  assert.equal(source.getValue(0, 'value'), 'row:0');
  assert.equal(engine.redo(), true);
  assert.equal(source.getValue(0, 'value'), 'draft');
  assert.equal(source.pendingCellCount, 1);
  engine.destroy();
  source.destroy();
});
