import test from 'node:test';
import assert from 'node:assert/strict';
import { createGridEngine, LocalDataSource } from '@acheron-grid/core';

function fixture(options = {}) {
  const source = new LocalDataSource(
    Array.from({ length: 12 }, (_, id) => ({ id, a: 'A' + id, b: 'B' + id, c: 'C' + id })),
    (row) => row.id,
  );
  const engine = createGridEngine({
    dataSource: source,
    columns: ['a', 'b', 'c'].map((key) => ({ key, title: key, editable: true })),
    ...options,
  });
  return { source, engine };
}
const span = { startRow: 1, endRow: 2, startColumn: 0, endColumn: 1 };

test('merged geometry, selection and editing preserve subordinate values and atomic clipboard/history', () => {
  const { engine, source } = fixture();
  engine.mergeCells(span);
  engine.select(2, 1);
  assert.deepEqual(engine.getSelectionRange(), span);
  assert.equal(engine.getSelection().rowIndex, 1);
  const viewport = engine.getViewport({ width: 480, height: 320, scrollLeft: 0, scrollTop: 0 });
  assert.deepEqual(viewport.hitTest(200, 75), { row: 1, col: 0 });
  assert.equal(viewport.cellRect(2, 1).width, 320);
  assert.equal(viewport.cellRect(2, 1).height, 64);
  assert.equal(engine.copySelection(), 'A1\t\r\n\t');
  assert.throws(() => engine.paste('changed\tunsafe'), /hidden merged/);
  assert.equal(source.getValue(1, 'a'), 'A1');
  engine.paste('changed\t\n\t');
  assert.equal(source.getValue(2, 'b'), 'B2');
  engine.undo();
  assert.equal(source.getValue(1, 'a'), 'A1');
  engine.editCell(2, 1, 'edited');
  assert.equal(source.getValue(1, 'a'), 'edited');
  engine.undo();
  engine.unmergeCells(span);
  assert.equal(engine.getMerge(2, 1), null);
  assert.equal(source.getValue(1, 'b'), 'B1');
  engine.undo();
  assert.deepEqual(engine.getMerge(2, 1), span);
  engine.setLocked({ scope: 'cell', rowIndex: 2, columnIndex: 1 }, true);
  assert.equal(engine.canEdit(1, 0), false);
  assert.throws(() => engine.editCell(1, 0, 'blocked'));
  assert.throws(() => engine.unmergeCells(span));
  const projected = fixture().engine;
  const group = projected.groupRows(0, 3);
  projected.setGroupCollapsed(group, true);
  const visibleSpan = { startRow: 1, endRow: 2, startColumn: 0, endColumn: 1 };
  projected.mergeCells(visibleSpan);
  projected.select(2, 1);
  assert.equal(projected.getSelection().rowIndex, 1);
  assert.deepEqual(projected.getSelectionRange(), visibleSpan);
  projected.selectRange({ startRow: 2, endRow: 2, startColumn: 1, endColumn: 1 });
  assert.deepEqual(projected.getSelectionRange(), visibleSpan);
});

test('merge validates overlap, freeze, view, host policy and structural remapping before writes', () => {
  const { engine } = fixture();
  engine.setFrozen(2, 0);
  assert.equal(engine.canMerge(span), false);
  engine.setFrozen(0, 0);
  engine.mergeCells(span);
  assert.equal(engine.canMerge({ ...span, startRow: 2, endRow: 3 }), false);
  assert.throws(() => engine.setFrozen(2, 0));
  assert.equal(engine.frozenRows, 0);
  engine.setView({ sort: { columnKey: 'a', direction: 'asc' } });
  assert.equal(engine.getMergedCells().length, 1);
  engine.setView({});
  assert.throws(() => engine.moveRows([1], 6), /split/);
  assert.equal(engine.getRowId(1), 1);
  engine.moveRows([1, 2], 6);
  assert.deepEqual(engine.getMergedCells()[0], { ...span, startRow: 4, endRow: 5 });
  engine.undo();
  assert.deepEqual(engine.getMergedCells()[0], span);
  engine.deleteRows([1]);
  assert.equal(engine.getMergedCells().length, 0);
  engine.undo();
  assert.deepEqual(engine.getMergedCells()[0], span);
  const blocked = fixture({ allowMerging: false }).engine;
  assert.equal(blocked.canMerge(span), false);
  assert.throws(() => blocked.mergeCells(span));
});

test('nested row groups keep source identity, freeze, selection, source height and mixed history', () => {
  const { engine, source } = fixture();
  engine.setRowHeight(7, 60);
  engine.setFrozen(6, 0);
  const parent = engine.groupRows(0, 4),
    child = engine.groupRows(1, 3);
  assert.throws(() => engine.groupRows(3, 6), /nested/);
  engine.select(7, 0);
  engine.setGroupCollapsed(child, true);
  assert.equal(engine.rowCount, 10);
  assert.equal(engine.frozenRows, 4);
  assert.equal(engine.getSelection().rowIndex, 5);
  assert.equal(engine.rows.size(5), 60);
  engine.setGroupCollapsed(parent, true);
  assert.equal(engine.rowCount, 8);
  assert.equal(engine.frozenRows, 2);
  assert.equal(engine.getRowId(1), 5);
  assert.throws(() => engine.moveRows([1], 4));
  engine.editCell(1, 0, 'Visible five');
  assert.equal(source.getValue(5, 'a'), 'Visible five');
  engine.undo();
  engine.undo();
  assert.equal(engine.rowCount, 10);
  engine.undo();
  assert.equal(engine.rowCount, 12);
  assert.equal(engine.getRowGroups().length, 2);
  engine.setGroupCollapsed(parent, true);
  engine.ungroupRows(parent);
  assert.equal(engine.rowCount, 12);
  engine.undo();
  assert.equal(engine.rowCount, 8);
  engine.setGroupCollapsed(parent, false);
  engine.setFrozen(2, 0);
  assert.throws(() => engine.setGroupCollapsed(parent, true), /frozen/);
  engine.setFrozen(0, 0);
  engine.mergeCells(span);
  assert.throws(() => engine.setGroupCollapsed(child, true), /Unmerge/);
  engine.setView({ filters: [{ columnKey: 'a', query: 'A' }] });
  assert.equal(engine.getRowGroups().length, 2);
});

test('merging a larger rectangle replaces contained merges atomically and preserves values and history', () => {
  let blocked = false;
  const { engine, source } = fixture({ canChangeLayout: () => !blocked });
  const second = { startRow: 4, endRow: 5, startColumn: 1, endColumn: 2 };
  const unrelated = { startRow: 8, endRow: 9, startColumn: 0, endColumn: 0 };
  const larger = { startRow: 0, endRow: 6, startColumn: 0, endColumn: 2 };
  engine.mergeCells(span);
  engine.mergeCells(second);
  engine.mergeCells(unrelated);
  const before = engine.getMergedCells();
  assert.equal(engine.canMerge(span), false);
  assert.equal(engine.canMerge({ ...larger, endRow: 4 }), false);
  assert.throws(() => engine.mergeCells({ ...larger, endRow: 4 }));
  blocked = true;
  assert.equal(engine.canMerge(larger), false);
  blocked = false;
  engine.setLocked({ scope: 'cell', rowIndex: 6, columnIndex: 2 }, true);
  assert.equal(engine.canMerge(larger), false);
  engine.setLocked({ scope: 'cell', rowIndex: 6, columnIndex: 2 }, false);
  assert.equal(engine.canMerge(larger), true);
  engine.mergeCells(larger);
  assert.deepEqual(engine.getMergedCells(), [unrelated, larger]);
  assert.equal(source.getValue(2, 'b'), 'B2');
  assert.equal(source.getValue(4, 'b'), 'B4');
  engine.undo();
  assert.deepEqual(engine.getMergedCells(), before);
  engine.redo();
  assert.deepEqual(engine.getMergedCells(), [unrelated, larger]);
  engine.unmergeCells(larger);
  assert.deepEqual(engine.getMergedCells(), [unrelated]);
  assert.equal(source.getValue(4, 'b'), 'B4');
});
