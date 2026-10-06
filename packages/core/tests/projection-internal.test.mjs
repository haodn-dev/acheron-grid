import test from 'node:test';
import assert from 'node:assert/strict';
import { createProjection } from '../dist/internal/projection.js';

test('projection converts visible ranges and targets into fragmented source coordinates', () => {
  const context = {
    projection: [2, 0, 4],
    reverseProjection: new Map([
      [2, 0],
      [0, 1],
      [4, 2],
    ]),
    rowCount: 5,
    columns: [{ key: 'a' }, { key: 'b' }, { key: 'c' }],
  };
  const projection = createProjection(context, {});
  const range = Object.freeze({ startRow: 0, endRow: 2, startColumn: 1, endColumn: 2 });
  const parts = [0, 2, 4].map((row) => ({ ...range, startRow: row, endRow: row }));
  assert.deepEqual(projection.sourceRanges(range), parts);
  assert.deepEqual(
    projection.sourceFormats([{ scope: 'range', range }]),
    parts.map((range) => ({ scope: 'range', range })),
  );
  assert.equal(projection.sourceRow(1), 0);
  assert.equal(projection.displayRow(1), -1);
  assert.equal(projection.displayRow(4), 2);
  assert.deepEqual(projection.sourceTarget({ scope: 'cell', rowIndex: 2, columnIndex: 1 }), {
    scope: 'cell',
    rowIndex: 4,
    columnIndex: 1,
  });
  const table = { scope: 'table' };
  assert.equal(projection.sourceTarget(table), table);
  assert.throws(() => projection.sourceRow(3), RangeError);
  assert.throws(() => projection.sourceRanges({ ...range, endRow: 3 }), RangeError);
  context.projection = null;
  assert.equal(projection.sourceRow(3), 3);
  const copies = projection.sourceRanges(range);
  assert.deepEqual(copies, [range]);
  assert.notEqual(copies[0], range);
});
