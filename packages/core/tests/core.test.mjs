import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalDataSource } from '../dist/index.js';
import { visibleRange } from '../dist/viewport.js';
import { GridAxis } from '../dist/axis.js';
import { decodeTsv, encodeTsv, clipboardCellLimit, clipboardTextLimit } from '../dist/tsv.js';

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

test('cell mutation preserves snapshots and stable row identity, validates boundaries', () => {
  const rows = [{ id: 'a', name: 'Ada', amount: 12 }];
  const source = new LocalDataSource(rows, row => row.id);
  source.setValue(0, 'name', 'Grace');
  source.setValue(0, 'amount', 24);
  source.setValue(0, 'id', 'changed');
  assert.equal(source.getRowId(0), 'a');
  assert.equal(source.getValue(0, 'name'), 'Grace');
  assert.equal(source.getValue(0, 'amount'), 24);
  assert.equal(rows[0].name, 'Ada');
  for (const index of [-1, 1, 0.5, NaN]) assert.throws(() => source.setValue(index, 'name', ''), RangeError);
  assert.throws(() => source.setValue(0, 'missing', ''), /Unknown column/);
  assert.throws(() => source.setValue(0, '__proto__', {}), /Unknown column/);
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

test('local batch writes validate all cells before committing, last duplicate wins', () => {
  const rows = [{ id: 1, name: 'Ada', amount: 12 }, { id: 2, name: 'Grace', amount: 24 }];
  const source = new LocalDataSource(rows, row => row.id);
  assert.throws(() => source.setValues([{ rowIndex: 0, columnKey: 'name', value: 'Lost' },
    { rowIndex: 1, columnKey: 'missing', value: 0 }]), /Unknown column/);
  assert.equal(source.getValue(0, 'name'), 'Ada');
  source.setValues([{ rowIndex: 0, columnKey: 'name', value: 'First' },
    { rowIndex: 0, columnKey: 'amount', value: 99 }, { rowIndex: 0, columnKey: 'name', value: 'Final' }]);
  assert.equal(source.getValue(0, 'name'), 'Final');
  assert.equal(source.getValue(0, 'amount'), 99);
  assert.equal(rows[0].name, 'Ada');
});

test('TSV round-trips quoted tabs, multiline values, quotes and empty fields', () => {
  const rows = [['Ada\tLovelace', 'a\r\nb', '"quote"', ''], ['雪', '', 'plain', '\n']];
  assert.deepEqual(decodeTsv(encodeTsv(rows)), rows);
  assert.deepEqual(decodeTsv('a\tb\r\nc\td\r\n'), [['a', 'b'], ['c', 'd']]);
  assert.deepEqual(decodeTsv('a\tb\nc\td'), [['a', 'b'], ['c', 'd']]);
  assert.deepEqual(decodeTsv(''), [['']]);
  assert.deepEqual(decodeTsv('a\t'), [['a', '']]);
  assert.deepEqual(decodeTsv('""'), [['']]);
  assert.throws(() => decodeTsv('"unfinished'), /Unterminated/);
  assert.throws(() => decodeTsv('"closed"tail'), /Unexpected/);
  assert.throws(() => decodeTsv('a\tb\nc'), /equal widths/);
  assert.throws(() => decodeTsv('x'.repeat(clipboardTextLimit + 1)), RangeError);
  assert.throws(() => decodeTsv('\t'.repeat(clipboardCellLimit)), RangeError);
});

test('sparse axis geometry matches variable-size boundaries and a million rows', () => {
  const axis = new GridAxis(6, 32);
  axis.setSize(0, 64);
  axis.setSize(3, 16);
  assert.deepEqual(Array.from({ length: 7 }, (_, i) => axis.position(i)), [0, 64, 96, 128, 144, 176, 208]);
  assert.equal(axis.indexAt(63), 0);
  assert.equal(axis.indexAt(64), 1);
  assert.deepEqual(axis.range(64, 64), { start: 1, end: 3 });
  assert.deepEqual(axis.range(127, 18), { start: 2, end: 5 });
  assert.deepEqual(axis.range(500, 100), { start: 6, end: 6 });
  axis.setSize(0, 32);
  assert.equal(axis.position(6), 176);
  for (const [index, size] of [[-1, 32], [6, 32], [0.5, 32], [0, 0], [0, NaN], [0, Infinity]]) assert.throws(() => axis.setSize(index, size), RangeError);
  assert.equal(axis.position(6), 176);
  const large = new GridAxis(1_000_000, 32);
  large.setSize(500_000, 64);
  assert.equal(large.position(1_000_000), 32_000_032);
  assert.equal(large.indexAt(16_000_063), 500_000);
  assert.equal(large.indexAt(16_000_064), 500_001);
  assert.deepEqual(new GridAxis(0, 32).range(0, 100), { start: 0, end: 0 });
});
