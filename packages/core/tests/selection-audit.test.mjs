import test from 'node:test';
import assert from 'node:assert/strict';
import { createGridEngine, LocalDataSource } from '../dist/index.js';
const make = () =>
  createGridEngine({
    columns: ['a', 'b', 'c'].map((key) => ({ key, title: key })),
    dataSource: new LocalDataSource(
      Array.from({ length: 12 }, (_, id) => ({ id, a: id, b: id % 2 ? 'odd' : 'even', c: id })),
      (row) => row.id,
    ),
  });
const has = (engine, row, col) =>
  engine
    .getSelectionRanges()
    .some((r) => r.startRow <= row && r.endRow >= row && r.startColumn <= col && r.endColumn >= col);
test('subtracting a visible cell under a filter retains selected records outside that filter', () => {
  const engine = make();
  engine.selectRange({ startRow: 0, endRow: 7, startColumn: 0, endColumn: 2 });
  engine.setView({ filters: [{ columnKey: 'b', query: 'odd' }], sort: { columnKey: 'a', direction: 'desc' } });
  const removed = engine.getRowId(2);
  assert.equal(removed, 7);
  engine.toggleSelection(2, 1);
  engine.setView({});
  for (let row = 0; row < 8; row++)
    for (let col = 0; col < 3; col++)
      assert.equal(has(engine, row, col), !(row === removed && col === 1), 'source cell ' + row + ':' + col);
  engine.destroy();
});

test('repeated projected toggles agree with an independent source-cell oracle', () => {
  const engine = make(),
    expected = new Set();
  let seed = 731;
  const random = (n) => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed % n;
  };
  for (let step = 0; step < 120; step++) {
    if (step % 12 === 0) {
      engine.clearSelection();
      expected.clear();
    }
    const filter = step % 3;
    engine.setView({
      filters: filter ? [{ columnKey: 'b', query: filter === 1 ? 'odd' : 'even' }] : [],
      sort: { columnKey: 'a', direction: step % 2 ? 'asc' : 'desc' },
    });
    const row = random(filter ? 6 : 12),
      col = random(3),
      id = engine.getRowId(row),
      key = id + ':' + col;
    engine.toggleSelection(row, col);
    if (expected.has(key)) expected.delete(key);
    else expected.add(key);
    engine.setView({});
    for (let r = 0; r < 12; r++)
      for (let c = 0; c < 3; c++)
        assert.equal(has(engine, r, c), expected.has(r + ':' + c), 'step ' + step + ', source cell ' + r + ':' + c);
  }
  engine.destroy();
});

test('paste keeps selection attached to its source record when sorting moves the edited row', () => {
  const engine = createGridEngine({
    columns: [{ key: 'a', title: 'A', editable: true, parse: Number }],
    dataSource: new LocalDataSource(
      [
        { id: 0, a: 1 },
        { id: 1, a: 2 },
        { id: 2, a: 3 },
      ],
      (r) => r.id,
    ),
  });
  engine.setView({ sort: { columnKey: 'a', direction: 'asc' } });
  engine.select(0, 0);
  engine.paste('9');
  assert.equal(engine.getSelection().rowId, 0);
  assert.equal(engine.getSelection().rowIndex, 2);
  assert.equal(engine.getValue(2, 'a'), 9);
  engine.undo();
  assert.equal(engine.getSelection().rowId, 0);
  assert.equal(engine.getValue(0, 'a'), 1);
  engine.destroy();
});

test('cooperative paste preserves filtered-out source selection without selecting the next visible row', async () => {
  const engine = createGridEngine({
    columns: [{ key: 'a', title: 'A', editable: true }],
    dataSource: new LocalDataSource(
      [
        { id: 0, a: 'keep one' },
        { id: 1, a: 'keep two' },
        { id: 2, a: 'other' },
      ],
      (r) => r.id,
    ),
  });
  engine.setView({ filters: [{ columnKey: 'a', query: 'keep' }] });
  engine.select(0, 0);
  await engine.pasteAsync('removed', { yieldControl: async () => {} });
  assert.equal(engine.getSelection(), null);
  assert.deepEqual(engine.getSelectionRanges(), []);
  engine.setView({});
  assert.equal(engine.getSelection().rowId, 0);
  assert.equal(engine.getValue(0, 'a'), 'removed');
  engine.undo();
  assert.equal(engine.getValue(0, 'a'), 'keep one');
  engine.destroy();
});
