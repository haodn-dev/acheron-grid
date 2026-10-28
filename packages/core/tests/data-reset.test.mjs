import test from 'node:test';
import assert from 'node:assert/strict';
import { createGridEngine, createPagedRemoteDataSource } from '../dist/index.js';
import { createViewportLoader } from '../../../examples/paged/viewport-loader.js';

function fixture(count = 1000000, options = {}) {
  let epoch = 'a',
    writes = 0;
  const values = new Map(),
    reads = [],
    events = [],
    invalidations = [];
  const source = {
    getRowCount: () => count,
    getRowId: (row) => {
      reads.push(row);
      return `${epoch}:${row}`;
    },
    getValue: (row, key) =>
      key === 'parent' ? (row === 0 ? null : `${epoch}:0`) : (values.get(`${row}:${key}`) ?? `${epoch}:${row}`),
    setValues: (updates) => {
      writes++;
      for (const cell of updates) values.set(`${cell.rowIndex}:${cell.columnKey}`, cell.value);
    },
  };
  const engine = createGridEngine({
    dataSource: source,
    columns: [
      { key: 'value', title: 'Value', editable: true },
      { key: 'parent', title: 'Parent', editable: true },
    ],
    onEvent: (event) => events.push(event),
    onInvalidate: (change) => invalidations.push(change),
    ...options,
  });
  return {
    engine,
    source,
    reads,
    events,
    invalidations,
    writes: () => writes,
    change(total, nextEpoch = 'b') {
      count = total;
      epoch = nextEpoch;
      values.clear();
    },
  };
}

test('epoch reset discards undo/redo, selection and cut without reading IDs, writing data or creating a row map', () => {
  const f = fixture();
  try {
    f.engine.updateCells([{ rowIndex: 1, columnKey: 'value', value: 'first' }]);
    f.engine.updateCells([{ rowIndex: 2, columnKey: 'value', value: 'second' }]);
    f.engine.undo();
    f.engine.select(900000, 0);
    f.engine.cutSelectionBlocks();
    const writes = f.writes();
    f.change(100000);
    f.reads.length = f.events.length = f.invalidations.length = 0;
    const result = f.engine.resetData();
    assert.deepEqual(result, {
      previousRowCount: 1000000,
      rowCount: 100000,
      droppedHistoryEntries: 2,
      selectionCleared: true,
      cutCancelled: true,
    });
    assert(Object.isFrozen(result));
    assert.equal(f.reads.length, 0);
    assert.equal(f.writes(), writes);
    assert.deepEqual(
      f.events.map((event) => event.type),
      ['data:reset', 'selection:change'],
    );
    assert.deepEqual(f.invalidations, [{ type: 'reset' }, { type: 'selection', changed: true, rangeChanged: true }]);
    assert.equal(f.engine.rowCount, 100000);
    assert.equal(f.engine.rows.position(100000), 3200000);
    assert.equal(f.engine.getSelection(), null);
    assert.equal(f.engine.undo(), false);
    assert.equal(f.engine.redo(), false);
  } finally {
    f.engine.destroy();
  }
});

test('same-count epochs clear sparse row metadata while preserving column geometry, locks and application policy', () => {
  const f = fixture(20, { permissions: { copyable: false } });
  try {
    f.engine.setColumnWidth(0, 220);
    f.engine.setColumnsHidden([1], true);
    f.engine.setRowHeight(0, 60);
    f.engine.setRowsHidden([1], true);
    f.engine.groupRows(3, 5);
    f.engine.mergeCells({ startRow: 7, endRow: 8, startColumn: 0, endColumn: 0 });
    f.engine.format([{ scope: 'table' }], { background: '#ffffff' });
    f.engine.setLocked({ scope: 'row', rowIndex: 2 }, true);
    f.engine.setLocked({ scope: 'cell', rowIndex: 3, columnIndex: 0 }, true);
    f.engine.setLocked({ scope: 'column', columnIndex: 1 }, true);
    f.engine.setLocked({ scope: 'table' }, true);
    f.engine.setFrozen(2, 1);
    f.change(20);
    f.reads.length = 0;
    f.engine.resetData();
    assert.equal(f.reads.length, 0);
    assert.equal(f.engine.rows.size(0), 32);
    assert.equal(f.engine.isRowHeightManual(0), false);
    assert.deepEqual(f.engine.getHiddenRows(), []);
    assert.deepEqual(f.engine.getRowGroups(), []);
    assert.deepEqual(f.engine.getMergedCells(), []);
    assert.deepEqual(f.engine.getFormat(0, 0), {});
    assert.equal(f.engine.isLocked({ scope: 'row', rowIndex: 2 }), false);
    assert.equal(f.engine.isLocked({ scope: 'cell', rowIndex: 3, columnIndex: 0 }), false);
    assert.equal(f.engine.isLocked({ scope: 'table' }), true);
    assert.equal(f.engine.isLocked({ scope: 'column', columnIndex: 1 }), true);
    assert.equal(f.engine.columnsLayout.size(0), 220);
    assert.deepEqual(f.engine.getHiddenColumns(), [1]);
    assert.equal(f.engine.getCellPermission(0, 0).writable, false);
    assert.equal(f.engine.getCellPermission(0, 0).copyable, false);
    assert.equal(f.engine.frozenRows, 2);
    assert.equal(f.engine.frozenColumns, 1);
    f.change(0);
    f.engine.resetData();
    assert.equal(f.engine.frozenRows, 0);
    assert.equal(f.engine.frozenColumns, 1);
  } finally {
    f.engine.destroy();
  }
});

test('empty and million-row epochs stay bounded; invalid counts and overflowing dimensions preserve old state', () => {
  const f = fixture(0);
  try {
    for (const count of [1000000, 0, 100000]) {
      f.change(count);
      f.engine.resetData();
      assert.equal(f.engine.rowCount, count);
    }
    assert.equal(f.reads.length, 0);
    f.engine.select(1, 0);
    f.engine.updateCells([{ rowIndex: 1, columnKey: 'value', value: 'draft' }]);
    const selection = f.engine.getSelection();
    for (const count of [-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      f.change(count);
      f.events.length = 0;
      assert.throws(() => f.engine.resetData(), /Invalid source row count/);
      assert.equal(f.engine.rowCount, 100000);
      assert.equal(f.engine.canUndo(), true);
      assert.deepEqual(f.engine.getSelection(), selection);
      assert.deepEqual(f.events, []);
    }
  } finally {
    f.engine.destroy();
  }
  const overflow = fixture(0, { rowHeight: 1e308 });
  try {
    overflow.change(2);
    assert.throws(() => overflow.engine.resetData(), /Invalid axis dimensions/);
    assert.equal(overflow.engine.rowCount, 0);
  } finally {
    overflow.engine.destroy();
  }
});

test('local projections, trees and data grouping reject reset before discarding state', () => {
  for (const configure of [
    (engine) => engine.setView({ sort: { columnKey: 'value', direction: 'desc' } }),
    (engine) => engine.setTree({ parentColumnKey: 'parent' }),
    (engine) => engine.setGrouping({ columnKey: 'value' }),
  ]) {
    const f = fixture(8);
    try {
      configure(f.engine);
      const count = f.engine.rowCount;
      f.reads.length = f.events.length = 0;
      assert.throws(() => f.engine.resetData(), /Clear the local view/);
      assert.equal(f.engine.rowCount, count);
      assert.equal(f.reads.length, 0);
      assert.deepEqual(f.events, []);
    } finally {
      f.engine.destroy();
    }
  }
});

test('same source and engine switch epochs while canceled late page completion cannot replace new query data', async () => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const source = createPagedRemoteDataSource({
    datasetId: 'epoch',
    columnKeys: ['title'],
    rowCount: 1000000,
    pageSize: 10,
    maxPages: 2,
    createAbortController: () => new AbortController(),
    createMutationId: () => 'unused',
    load: async ({ offset, limit, query }) => {
      const descending = query.sort?.direction === 'desc';
      if (!descending) await gate;
      const total = descending ? 100000 : 1000000;
      return {
        datasetId: 'epoch',
        revision: descending ? 'new' : 'old',
        total,
        rows: Array.from({ length: limit }, (_, i) => {
          const id = descending ? total - offset - i - 1 : offset + i;
          return { id, values: { title: `Task ${id}` } };
        }),
      };
    },
    write: async () => {
      throw Error('Unexpected write');
    },
  });
  const engine = createGridEngine({ dataSource: source, columns: [{ key: 'title', title: 'Task' }] });
  const oldLoader = createViewportLoader({ source, grid: engine, maxPages: 2 });
  let nextLoader;
  try {
    oldLoader.setViewport({ regions: [{ rows: { start: 0, end: 1 } }] });
    await new Promise((resolve) => setTimeout(resolve, 0));
    oldLoader.dispose();
    source.setQuery({ sort: { columnKey: 'title', direction: 'desc' } }, 100000);
    engine.resetData();
    nextLoader = createViewportLoader({ source, grid: engine, maxPages: 2 });
    nextLoader.setViewport({ regions: [{ rows: { start: 0, end: 1 } }] });
    for (let i = 0; i < 100 && nextLoader.getState().loading; i++)
      await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(nextLoader.getState().loading, false);
    assert.equal(engine.getValue(0, 'title'), 'Task 99999');
    release();
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(source.getRowCount(), 100000);
    assert.equal(engine.rowCount, 100000);
    assert.equal(source.revision, 'new');
    assert.equal(engine.getValue(0, 'title'), 'Task 99999');
    assert.equal(source.pendingCellCount, 0);
  } finally {
    release();
    oldLoader.dispose();
    nextLoader?.dispose();
    engine.destroy();
    source.destroy();
  }
});
