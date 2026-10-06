import test from 'node:test';
import assert from 'node:assert/strict';
import { createOutline } from '../dist/internal/outline.js';

test('merged range expansion follows transitive intersections without mutating its inputs', () => {
  const merges = Object.freeze([
    Object.freeze({ startRow: 2, endRow: 2, startColumn: 1, endColumn: 3 }),
    Object.freeze({ startRow: 0, endRow: 2, startColumn: 0, endColumn: 0 }),
  ]);
  const range = Object.freeze({ startRow: 0, endRow: 0, startColumn: 0, endColumn: 1 });
  const outline = createOutline({ merges }, {});
  assert.deepEqual(outline.expandMergedRange(range), {
    startRow: 0,
    endRow: 2,
    startColumn: 0,
    endColumn: 3,
  });
  assert.deepEqual(range, { startRow: 0, endRow: 0, startColumn: 0, endColumn: 1 });
  assert.equal(outline.intersects(merges[0], merges[1]), false);
  assert.equal(outline.intersects(range, merges[1]), true);
  const untouched = { startRow: 4, endRow: 4, startColumn: 0, endColumn: 1 };
  const copy = outline.expandMergedRange(untouched);
  assert.deepEqual(copy, untouched);
  assert.notEqual(copy, untouched);
});
