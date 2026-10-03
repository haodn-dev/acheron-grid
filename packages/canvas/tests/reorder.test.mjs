import { test } from 'node:test';
import assert from 'node:assert/strict';
import { reorderedIndices } from '../dist/index.js';
test('reorder keeps stable relative order and validates boundaries', () => {
  assert.deepEqual(reorderedIndices(5, [3, 1], 5), [0, 2, 4, 1, 3]);
  assert.deepEqual(reorderedIndices(5, [1, 2], 2), [0, 1, 2, 3, 4]);
  assert.deepEqual(reorderedIndices(5, [4], 0), [4, 0, 1, 2, 3]);
  assert.throws(() => reorderedIndices(5, [1, 1], 2), RangeError);
  assert.throws(() => reorderedIndices(5, [5], 2), RangeError);
});
