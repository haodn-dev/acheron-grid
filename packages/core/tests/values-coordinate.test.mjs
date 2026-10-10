import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createValues } from '../dist/internal/values.js';

test('batch coordinate keys preserve dedup order, no-op identity reads and overflow separation', () => {
  const reads = [],
    writes = [],
    history = [];
  const context = {
    rowCount: Number.MAX_SAFE_INTEGER,
    columns: [{ key: 'a' }, { key: 'b' }],
    columnIndices: new Map([
      ['a', 0],
      ['b', 1],
    ]),
    past: history,
    future: [],
    destroyed: false,
    dataSource: {
      getValue: (row, key) => {
        reads.push(['value', row, key]);
        return 0;
      },
      getRowId: (row) => {
        reads.push(['id', row]);
        return String(row);
      },
      setValues: (changes) => writes.push(changes),
    },
  };
  const controller = createValues(context, {
    assertAlive: () => {},
    requirePermission: () => {},
    writeFormats: () => {},
    notifyFormats: () => {},
    notify: () => {},
  });
  const high = Number.MAX_SAFE_INTEGER - 1;
  controller.applyUpdates([
    { rowIndex: 7, columnKey: 'a', value: 1 },
    { rowIndex: 3, columnKey: 'b', value: 4 },
    { rowIndex: 7, columnKey: 'a', value: 2 },
    { rowIndex: 2, columnKey: 'a', value: 0 },
    { rowIndex: high, columnKey: 'a', value: 8 },
    { rowIndex: high, columnKey: 'b', value: 9 },
  ]);
  assert.deepEqual(reads, [
    ['value', 7, 'a'],
    ['id', 7],
    ['value', 3, 'b'],
    ['id', 3],
    ['value', 2, 'a'],
    ['id', 2],
    ['value', high, 'a'],
    ['id', high],
    ['value', high, 'b'],
    ['id', high],
  ]);
  assert.equal(writes.length, 1);
  assert.deepEqual(
    writes[0].map(({ rowIndex, columnKey, value }) => ({ rowIndex, columnKey, value })),
    [
      { rowIndex: 7, columnKey: 'a', value: 2 },
      { rowIndex: 3, columnKey: 'b', value: 4 },
      { rowIndex: high, columnKey: 'a', value: 8 },
      { rowIndex: high, columnKey: 'b', value: 9 },
    ],
  );
  assert.equal(history.length, 1);
  assert.equal(history[0].changes.length, 4);
});
