import test from 'node:test';
import assert from 'node:assert/strict';
import { createGridEngine, LocalDataSource } from '@acheron-grid/core';
import { exportSelectionCsv } from '@acheron-grid/export';

const rows = [
  { id: 'z', parent: 0, name: 'zulu', amount: 3 },
  { id: '', parent: null, name: 'root', amount: 9 },
  { id: 0, parent: '', name: 'branch', amount: 2 },
  { id: 'b', parent: 0, name: 'beta', amount: 1 },
  { id: 'other', parent: '', name: 'other', amount: 4 },
];
function fixture(extra = {}) {
  const source = new LocalDataSource(rows, (row) => row.id);
  const engine = createGridEngine({
    columns: ['parent', 'name', 'amount'].map((key) => ({ key, title: key, editable: true })),
    dataSource: source,
    tree: { parentColumnKey: 'parent' },
    ...extra,
  });
  return { source, engine };
}
const ids = (engine) => Array.from({ length: engine.rowCount }, (_, i) => engine.getRowId(i));

test('tree engine retains real identities and metadata; filters keep only matches and ancestors; sorts stay within siblings', () => {
  const events = [];
  const { engine } = fixture({ onEvent: (event) => events.push(event) });
  assert.deepEqual(events, []);
  assert.deepEqual(ids(engine), ['', 0, 'z', 'b', 'other']);
  assert.equal(engine.getRowMetadata(2).kind, 'leaf');
  assert.deepEqual(engine.getTreeRowMetadata(2), {
    sourceIndex: 0,
    rowId: 'z',
    parentId: 0,
    level: 3,
    hasChildren: false,
    expanded: false,
  });
  assert.ok(Object.isFrozen(engine.getTreeRowMetadata(1)));
  engine.setView({ sort: { columnKey: 'amount', direction: 'asc' } });
  assert.deepEqual(ids(engine), ['', 0, 'b', 'z', 'other']);
  engine.setView({ filters: [{ columnKey: 'name', operator: 'equals', query: 'beta' }] });
  assert.deepEqual(ids(engine), ['', 0, 'b']);
  engine.setView({ filters: [{ columnKey: 'name', operator: 'equals', query: 'root' }] });
  assert.deepEqual(ids(engine), ['']);
  assert.equal(engine.getTreeRowMetadata(0).hasChildren, false);
  engine.setView({ filters: [{ columnKey: 'name', operator: 'equals', query: 'absent' }] });
  assert.equal(engine.rowCount, 0);
  engine.setView({});
  assert.equal(engine.rowCount, 5);
});

test('closing a tree branch moves hidden active descendant to parent and drops hidden selection ranges', () => {
  const { engine } = fixture();
  engine.selectRange({ startRow: 1, endRow: 3, startColumn: 1, endColumn: 1 });
  engine.select(3, 1);
  engine.setTreeExpanded(0, false);
  assert.deepEqual(ids(engine), ['', 0, 'other']);
  assert.equal(engine.getSelection().rowId, 0);
  assert.equal(engine.copySelection(), 'branch');
  engine.selectRange({ startRow: 0, endRow: 2, startColumn: 1, endColumn: 1 });
  assert.equal(exportSelectionCsv(engine), 'root\r\nbranch\r\nother');
  engine.select(1, 1);
  engine.setTreeExpanded(0, true);
  assert.equal(engine.getSelection().rowId, 0);
  assert.equal(engine.copySelection(), 'branch');
  engine.select(2, 1);
  engine.setTreeExpanded(0, true);
  assert.equal(engine.getSelection().rowId, 'z');
  assert.throws(() => engine.setTreeExpanded('missing', false), /Unknown/);
});

test('invalid tree activation is atomic and collapsed filtered metadata invalidates even when indices stay unchanged', () => {
  const source = new LocalDataSource(
    [
      { id: 'root', parent: null, name: 'match' },
      { id: 'child', parent: 'root', name: 'other' },
    ],
    (row) => row.id,
  );
  const invalidations = [];
  const engine = createGridEngine({
    dataSource: source,
    columns: ['parent', 'name'].map((key) => ({ key, title: key, editable: true })),
    onInvalidate: (change) => invalidations.push(change.type),
  });
  engine.select(0, 1);
  assert.throws(() => engine.setTree({ parentColumnKey: 'missing' }));
  assert.equal(engine.tree, null);
  assert.equal(engine.getSelection().rowId, 'root');
  engine.setTree({ parentColumnKey: 'parent' });
  engine.updateCells([{ rowIndex: 1, columnKey: 'name', value: 'match' }]);
  engine.setView({ filters: [{ columnKey: 'name', operator: 'equals', query: 'match' }] });
  engine.setTreeExpanded('root', false);
  assert.equal(engine.getTreeRowMetadata(0).hasChildren, true);
  engine.undo();
  assert.equal(engine.rowCount, 1);
  assert.equal(engine.getTreeRowMetadata(0).hasChildren, false);
  assert.equal(invalidations.at(-1), 'structure');
  engine.setTree(null);
  source.setValue(1, 'parent', 'missing');
  engine.select(0, 1);
  assert.throws(() => engine.setTree({ parentColumnKey: 'parent' }), /parent/);
  assert.equal(engine.tree, null);
  assert.equal(engine.getSelection().rowId, 'root');
});

test('tree collapse clears selection if parent fallback is not selectable', () => {
  const { engine } = fixture({
    resolveCellPermission: ({ rowId }) => (rowId === 0 ? { selectable: false } : undefined),
  });
  engine.select(2, 1);
  engine.setTreeExpanded(0, false);
  assert.equal(engine.getSelection(), null);
  assert.deepEqual(engine.getSelectionRanges(), []);
});

test('parent capability blocks edits, API writes, mixed paste and history atomically', () => {
  const { engine, source } = fixture();
  assert.equal(engine.getCellPermission(1, 0).writable, false);
  assert.equal(engine.getCellPermission(1, 0).selectable, true);
  assert.equal(engine.canEdit(1, 0), false);
  assert.throws(
    () =>
      engine.updateCells([
        { rowIndex: 1, columnKey: 'parent', value: null },
        { rowIndex: 1, columnKey: 'amount', value: 90 },
      ]),
    /read-only/,
  );
  assert.equal(source.getValue(2, 'amount'), 2);
  engine.select(1, 0);
  assert.throws(() => engine.paste('new\tnew name'), /permission|read-only/);
  assert.equal(source.getValue(2, 'name'), 'branch');
  assert.equal(engine.undo(), false);
  engine.setTree(null);
  engine.updateCells([{ rowIndex: 0, columnKey: 'parent', value: '' }]);
  engine.setTree({ parentColumnKey: 'parent' });
  assert.throws(() => engine.undo(), /read-only/);
  assert.equal(source.getValue(0, 'parent'), '');
});

test('value changes rebuild tree before committing and history remains attached through sort and collapse', () => {
  const changes = [];
  const { engine, source } = fixture({ onInvalidate: (change) => changes.push(change.type) });
  engine.setView({ sort: { columnKey: 'amount', direction: 'asc' } });
  engine.updateCells([{ rowIndex: 2, columnKey: 'amount', value: 8 }]);
  assert.equal(source.getValue(3, 'amount'), 8);
  assert.deepEqual(ids(engine), ['', 0, 'z', 'b', 'other']);
  engine.setTreeExpanded(0, false);
  assert.equal(engine.undo(), true);
  assert.equal(source.getValue(3, 'amount'), 1);
  assert.equal(engine.redo(), true);
  assert.equal(source.getValue(3, 'amount'), 8);
  assert.ok(changes.includes('structure'));
});

test('tree state validates dataset IDs and criteria before replacing view or selection', () => {
  const { engine } = fixture();
  engine.setTreeExpanded(0, false);
  engine.select(1, 1);
  const state = engine.exportTreeState();
  assert.ok(Object.isFrozen(state) && Object.isFrozen(state.collapsedIds));
  for (const bad of [
    null,
    { ...state, version: 2 },
    { ...state, collapsedIds: [0, 0] },
    { ...state, collapsedIds: ['missing'] },
    { ...state, collapsedIds: [false] },
    { ...state, tree: { parentColumnKey: 'missing' } },
  ]) {
    assert.throws(() => engine.restoreTreeState(bad));
    assert.deepEqual(engine.exportTreeState(), state);
    assert.equal(engine.getSelection().rowId, 0);
  }
  engine.setTree(null);
  assert.equal(engine.getTreeRowMetadata(0), null);
  engine.setGrouping({ columnKey: 'name' });
  assert.equal(engine.getTreeRowMetadata(0), null);
  engine.setGrouping(null);
  engine.restoreTreeState(state);
  assert.deepEqual(ids(engine), ['', 0, 'other']);
  for (const action of [
    () => engine.exportState(),
    () => engine.exportConfiguration(),
    () => engine.refreshData('values'),
    () => engine.cutSelectionBlocks(),
    () => engine.setGrouping({ columnKey: 'name' }),
    () => engine.resizeRow(0, 30),
    () => engine.setFrozen(1, 0),
  ])
    assert.throws(action);
  assert.equal(engine.canChangeStructure({ axis: 'row', kind: 'delete', indices: [0] }), false);
});

test('tree bulk view/value cancellation and revision conflicts leave installed metadata and source unchanged', async () => {
  const { engine, source } = fixture();
  const before = engine.getTreeRowMetadata(1);
  let revision = 'a',
    calls = 0;
  await assert.rejects(
    engine.setViewAsync(
      { filters: [{ columnKey: 'name', operator: 'equals', query: 'beta' }] },
      {
        getRevision: () => revision,
        yieldControl: async () => {
          if (++calls === 2) revision = 'b';
        },
      },
    ),
    /revision/,
  );
  assert.equal(engine.getTreeRowMetadata(1), before);
  const signal = { aborted: false };
  await assert.rejects(
    engine.updateCellsAsync([{ rowIndex: 2, columnKey: 'amount', value: 20 }], {
      signal,
      yieldControl: async () => {
        signal.aborted = true;
      },
    }),
    /canceled/,
  );
  assert.equal(source.getValue(0, 'amount'), 3);
  await engine.setViewAsync({ sort: { columnKey: 'name', direction: 'asc' } }, { yieldControl: async () => {} });
  assert.deepEqual(ids(engine), ['', 0, 'b', 'z', 'other']);
});
