import test from 'node:test';
import assert from 'node:assert/strict';
import { mappedIntervals, mappedRanges, inverseMap, rowBlocks } from '../dist/internal/structure-mapping.js';

test('structural mapping preserves holes and fragments without selecting inserted coordinates', () => {
  const rows = [3, -1, 0, 1, 5];
  const columns = [2, -1, 0];
  assert.deepEqual(mappedIntervals(0, 4, rows), [
    [0, 1],
    [3, 3],
    [5, 5],
  ]);
  assert.deepEqual(mappedRanges({ startRow: 0, endRow: 4, startColumn: 0, endColumn: 2 }, rows, columns), [
    { startRow: 0, endRow: 1, startColumn: 0, endColumn: 0 },
    { startRow: 0, endRow: 1, startColumn: 2, endColumn: 2 },
    { startRow: 3, endRow: 3, startColumn: 0, endColumn: 0 },
    { startRow: 3, endRow: 3, startColumn: 2, endColumn: 2 },
    { startRow: 5, endRow: 5, startColumn: 0, endColumn: 0 },
    { startRow: 5, endRow: 5, startColumn: 2, endColumn: 2 },
  ]);
  assert.deepEqual(inverseMap(rows, 6), [2, 3, -1, 0, -1, 4]);
  assert.deepEqual(mappedIntervals(1, 1, rows), []);
  assert.deepEqual(rows, [3, -1, 0, 1, 5]);
});

test('structural row blocks keep contiguous splice boundaries and source snapshots', () => {
  const rows = [0, 1, 2, 3].map((id) => ({ id, values: { name: String(id) } }));
  assert.deepEqual(rowBlocks([1, 2, 5, 7], rows), [
    { index: 1, deleteCount: 2, rows: rows.slice(0, 2) },
    { index: 5, deleteCount: 1, rows: rows.slice(2, 3) },
    { index: 7, deleteCount: 1, rows: rows.slice(3) },
  ]);
  assert.deepEqual(rowBlocks([], []), []);
  assert.equal(rowBlocks([1], rows)[0].rows[0], rows[0]);
});
