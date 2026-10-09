import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGridEngine, LocalDataSource } from '../dist/index.js';

test('policy probes do not promise source setters and formatting remains independent', () => {
  const engine = createGridEngine({
    columns: [{ key: 'a', title: 'A', editable: true }],
    dataSource: { getRowCount: () => 1, getRowId: () => 1, getValue: () => 'old' },
  });
  assert.equal(engine.getCellPermission(0, 0).writable, true);
  assert.equal(engine.canEdit(0, 0), false);
  engine.select(0, 0);
  assert.equal(engine.canPaste(), false);
  assert.throws(() => engine.editCell(0, 0, 'new'));
  assert.equal(engine.getValue(0, 'a'), 'old');
  assert.equal(engine.canUndo(), false);
  engine.destroy();
  const readonly = createGridEngine({
    columns: [{ key: 'a', title: 'A', editable: true }],
    dataSource: new LocalDataSource([{ a: 'old' }], () => 1),
    permissions: { writable: false },
  });
  const target = { scope: 'cell', rowIndex: 0, columnIndex: 0 };
  assert.equal(readonly.getCellPermission(0, 0).editable, false);
  assert.equal(readonly.canFormat([target]), true);
  readonly.format([target], { fontWeight: 'bold' });
  assert.equal(readonly.getFormat(0, 0).fontWeight, 'bold');
  assert.equal(readonly.getValue(0, 'a'), 'old');
  readonly.undo();
  assert.deepEqual(readonly.getFormat(0, 0), {});
  readonly.destroy();
});

test('undo availability is not replay permission and a veto retains the pending command', () => {
  const engine = createGridEngine({
    columns: [{ key: 'a', title: 'A', editable: true }],
    dataSource: new LocalDataSource([{ a: 'old' }], () => 1),
  });
  engine.editCell(0, 0, 'new');
  engine.setLocked({ scope: 'table' }, true);
  assert.equal(engine.canUndo(), true);
  assert.throws(() => engine.undo());
  assert.equal(engine.getValue(0, 'a'), 'new');
  assert.equal(engine.canUndo(), true);
  assert.equal(engine.canRedo(), false);
  engine.setLocked({ scope: 'table' }, false);
  assert.equal(engine.undo(), true);
  assert.equal(engine.getValue(0, 'a'), 'old');
  engine.destroy();
  engine.cancelCut();
  assert.equal(engine.canUndo(), false);
  assert.equal(engine.undo(), false);
});
test('malformed structural capability queries and array formatting leave state and history untouched', () => {
  const source = new LocalDataSource([{ a: 'original' }], (_, i) => i);
  const grid = createGridEngine({ dataSource: source, columns: [{ key: 'a', title: 'A', editable: true }] });
  grid.select(0, 0);
  const before = grid.exportState();
  assert.equal(
    grid.canChangeStructure({ axis: 'row', kind: 'move', indices: Array(1), beforeIndex: 0, count: 1 }),
    false,
  );
  assert.throws(() => grid.format([{ scope: 'table' }], []), TypeError);
  assert.throws(
    () => grid.restoreState({ ...before, formats: [{ target: { scope: 'table' }, patch: [] }] }),
    TypeError,
  );
  assert.deepEqual(grid.exportState(), before);
  assert.equal(grid.canUndo(), false);
  grid.destroy();
});
