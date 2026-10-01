import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalDataSource } from '../dist/index.js';
import { visibleRange } from '../dist/viewport.js';

test('local rows preserve identity and snapshot top-level values', () => {
  const rows = [{ id: 'a', amount: 12 }, { id: 'b', amount: 24 }];
  const source = new LocalDataSource(rows, row => row.id);
  rows[0].amount = 99;
  rows.push({ id: 'c', amount: 36 });
  assert.equal(source.getRowCount(), 2);
  assert.equal(source.getRowId(1), 'b');
  assert.equal(source.getValue(0, 'amount'), 12);
  assert.equal(source.getValue(0, 'toString'), undefined);
});

test('rejects duplicate and invalid row identities', () => {
  assert.throws(() => new LocalDataSource([{ id: 1 }, { id: 1 }], row => row.id), /Duplicate/);
  assert.throws(() => new LocalDataSource([{}], () => NaN), TypeError);
});

test('rejects missing and non-integer row indices, including empty sources', () => {
  const source = new LocalDataSource([{ id: 1 }], row => row.id);
  for (const index of [-1, 1, 0.5, NaN]) assert.throws(() => source.getValue(index, 'id'), RangeError);
  assert.throws(() => new LocalDataSource([], () => 0).getRowId(0), RangeError);
});

test('viewport includes partially visible cells and excludes exact end boundaries', () => {
  assert.deepEqual(visibleRange(100, 32, 0, 64), { start: 0, end: 2 });
  assert.deepEqual(visibleRange(100, 32, 31, 64), { start: 0, end: 3 });
  assert.deepEqual(visibleRange(100, 32, 32, 64), { start: 1, end: 3 });
});

test('viewport clamps empty, hidden and exhausted data', () => {
  assert.deepEqual(visibleRange(0, 32, 0, 600), { start: 0, end: 0 });
  assert.deepEqual(visibleRange(3, 32, 900, 600), { start: 3, end: 3 });
  assert.deepEqual(visibleRange(3, 32, 5, 0), { start: 0, end: 0 });
  assert.deepEqual(visibleRange(3, 32, -10, 32), { start: 0, end: 1 });
  assert.throws(() => visibleRange(3, 0, 0, 32), RangeError);
});

test('viewport work stays bounded for a million rows', () => {
  const { start, end } = visibleRange(1_000_000, 32, 15_123_456, 720);
  assert.ok(end - start <= 24);
  assert.ok(start > 400_000);
});
