import assert from 'node:assert/strict';
import test from 'node:test';
import { reorderInsertionIndex } from '../dist/internal/reorder-geometry.js';

test('reorder insertion retains exact midpoint and grouped endpoint behavior on both axes', () => {
  const bounds = { top: 10, left: 20, height: 30, width: 40 };
  for (const axis of ['row', 'column']) {
    const midpoint = axis === 'row' ? 25 : 40;
    for (const [coordinate, expected] of [
      [midpoint - 1, 3],
      [midpoint, 3],
      [midpoint + 1, 8],
    ]) {
      const point = axis === 'row' ? { clientX: 999, clientY: coordinate } : { clientX: coordinate, clientY: 999 };
      assert.equal(reorderInsertionIndex(point, bounds, axis, 3, 7), expected);
    }
  }
  assert.equal(reorderInsertionIndex({ clientX: 0, clientY: 26 }, bounds, 'row', 3, 3), 4);
});
