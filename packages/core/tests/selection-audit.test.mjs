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

test('projected selection no-ops preserve event counts and detached snapshots', () => {
  const events = [];
  const engine = createGridEngine({
    columns: [{ key: 'a', title: 'A' }],
    dataSource: new LocalDataSource([{ a: 3 }, { a: 1 }, { a: 2 }], (_, id) => id),
    onEvent: (event) => events.push(event),
  });
  engine.setView({ sort: { columnKey: 'a', direction: 'asc' } });
  assert.equal(engine.select(0, 0), true);
  const count = events.length;
  assert.equal(engine.select(0, 0), false);
  assert.equal(engine.selectRange({ startRow: 0, endRow: 0, startColumn: 0, endColumn: 0 }), false);
  assert.equal(events.length, count);
  const snapshot = engine.getSelectionRanges();
  snapshot[0].endRow = 99;
  assert.deepEqual(engine.getSelectionRanges(), [{ startRow: 0, endRow: 0, startColumn: 0, endColumn: 0 }]);
  engine.destroy();
});

test('denied projected selection does not move the extension anchor', () => {
  const events = [];
  const engine = createGridEngine({
    columns: [{ key: 'a', title: 'A' }],
    dataSource: new LocalDataSource(
      Array.from({ length: 4 }, (_, id) => ({ a: id })),
      (_, id) => id,
    ),
    resolveCellPermission: (cell) => (cell.rowId === 1 ? { selectable: false } : undefined),
    onEvent: (event) => events.push(event),
  });
  engine.setView({ sort: { columnKey: 'a', direction: 'desc' } });
  engine.select(0, 0);
  const count = events.length;
  assert.equal(engine.select(2, 0), false);
  assert.equal(events.length, count);
  assert.equal(engine.getSelection().rowId, 3);
  engine.select(3, 0, true);
  assert.deepEqual(engine.getSelectionRanges(), [{ startRow: 0, endRow: 3, startColumn: 0, endColumn: 0 }]);
  engine.destroy();
});

test('fragmented projected range limits and invalid inputs leave selection and events untouched', () => {
  const events = [];
  const engine = createGridEngine({
    columns: [{ key: 'a', title: 'A' }],
    dataSource: new LocalDataSource(
      Array.from({ length: 260 }, (_, id) => ({ a: id % 2 ? 'odd' : 'even' })),
      (_, id) => id,
    ),
    onEvent: (event) => events.push(event),
  });
  engine.setView({ filters: [{ columnKey: 'a', query: 'even' }] });
  const range = { startRow: 0, endRow: 127, startColumn: 0, endColumn: 0 };
  engine.selectRange(range);
  const snapshot = engine.exportState();
  const count = events.length;
  assert.throws(() => engine.selectRange({ ...range, endRow: 128 }), /128 source ranges/);
  for (const bad of [
    { ...range, startRow: -1 },
    { ...range, endRow: 130 },
    { ...range, startRow: 0.5 },
    { ...range, endColumn: 1 },
    { ...range, startRow: 2, endRow: 1 },
  ])
    assert.throws(() => engine.selectRange(bad), RangeError);
  assert.throws(() => engine.selectRange(range, 'invalid'), TypeError);
  assert.deepEqual(engine.exportState(), snapshot);
  assert.equal(events.length, count);
  engine.clearSelection();
  const cleared = events.length;
  engine.clearSelection();
  assert.equal(events.length, cleared);
  assert.deepEqual(engine.getSelectionRanges(), []);
  engine.destroy();
});
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
