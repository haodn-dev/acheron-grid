import test from 'node:test';
import assert from 'node:assert/strict';
import { createGridEngine, LocalDataSource } from '@acheron-grid/core';
test('literal replace follows visible ordering, preserves types and is one atomic history command', () => {
  const engine = createGridEngine({
    columns: [
      { key: 'a', title: 'A', editable: true },
      { key: 'b', title: 'B', editable: true },
    ],
    dataSource: new LocalDataSource(
      [
        { a: 'A.a A.a', b: 2 },
        { a: 'a.a', b: 'A.a' },
      ],
      (_, i) => i,
    ),
  });
  engine.setView({ sort: { columnKey: 'a', direction: 'desc' } });
  const result = engine.replaceText('a.a', '$&', { caseSensitive: false });
  assert.deepEqual(result, { changedCells: 3, matches: 4 });
  const visible = () =>
    new Map(
      Array.from({ length: engine.rowCount }, (_, row) => [
        engine.getRowId(row),
        { a: engine.getValue(row, 'a'), b: engine.getValue(row, 'b') },
      ]),
    );
  assert.equal(visible().get(0).a, '$& $&');
  assert.equal(visible().get(0).b, 2);
  engine.undo();
  assert.equal(visible().get(1).a, 'a.a');
  engine.redo();
  assert.equal(visible().get(1).a, '$&');
  engine.destroy();
});
test('replace validation and permission veto preserve every value and history', () => {
  const source = new LocalDataSource([{ a: 'old', b: 'old' }], (_, i) => i);
  const engine = createGridEngine({
    columns: [
      { key: 'a', title: 'A', editable: true },
      { key: 'b', title: 'B', editable: true, validate: (value) => (value === 'bad' ? 'Denied' : undefined) },
    ],
    dataSource: source,
  });
  assert.throws(() => engine.replaceText('old', 'bad'), /Denied/);
  assert.equal(source.getValue(0, 'a'), 'old');
  assert.equal(engine.canUndo(), false);
  engine.setLocked({ scope: 'cell', rowIndex: 0, columnIndex: 1 }, true);
  assert.throws(() => engine.replaceText('old', 'new'), /editable/);
  assert.equal(source.getValue(0, 'a'), 'old');
  engine.select(0, 0);
  engine.replaceText('old', 'new', { scope: 'selection' });
  assert.equal(source.getValue(0, 'a'), 'new');
  assert.equal(source.getValue(0, 'b'), 'old');
  engine.destroy();
});
test('replace preflights scan and expansion limits before writes or large output allocation', () => {
  let reads = 0,
    writes = 0;
  const large = createGridEngine({
    columns: [{ key: 'a', title: 'A', editable: true }],
    dataSource: {
      getRowCount: () => 100001,
      getRowId: (row) => row,
      getValue: () => {
        reads++;
        return 'a';
      },
      setValues: () => {
        writes++;
      },
    },
  });
  assert.throws(() => large.replaceText('a', 'b'), /cell limit/);
  assert.equal(reads, 0);
  assert.equal(writes, 0);
  large.destroy();
  const source = new LocalDataSource([{ a: 'a'.repeat(10000) }], (_, i) => i);
  const engine = createGridEngine({ columns: [{ key: 'a', title: 'A', editable: true }], dataSource: source });
  assert.throws(() => engine.replaceText('a', 'b'.repeat(10000)), /text limit/);
  assert.equal(source.getValue(0, 'a').length, 10000);
  assert.equal(engine.canUndo(), false);
  engine.destroy();
});
