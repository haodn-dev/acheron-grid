import test from 'node:test';
import assert from 'node:assert/strict';
import { createGridEngine, LocalDataSource } from '@acheron-grid/core';

function fixture(extra = {}) {
  const data = [
    { id: 'a', team: 'A', amount: 10 },
    { id: 'b', team: 'A', amount: 20 },
    { id: 'c', team: 'B', amount: -5 },
    { id: 'd', team: null, amount: 7 },
  ];
  const source = new LocalDataSource(data, (row) => row.id);
  const engine = createGridEngine({
    columns: [
      { key: 'team', title: 'Team', editable: true },
      { key: 'amount', title: 'Amount', editable: true, parse: Number },
    ],
    dataSource: source,
    grouping: { columnKey: 'team', sumColumns: ['amount'] },
    ...extra,
  });
  return { source, engine };
}
const metadata = (engine) => Array.from({ length: engine.rowCount }, (_, row) => engine.getRowMetadata(row));

test('group rows have separate identity, frozen metadata and no record permissions', () => {
  const initialEvents = [];
  const { engine } = fixture({ onEvent: (event) => initialEvents.push(event) });
  assert.deepEqual(initialEvents, []);
  assert.equal(engine.rowCount, 7);
  assert.deepEqual(
    metadata(engine).map((row) => (row.kind === 'group' ? row.key : row.rowId)),
    ['A', 'a', 'b', 'B', 'c', null, 'd'],
  );
  const group = engine.getRowMetadata(0);
  assert.equal(group.count, 2);
  assert.equal(group.sums.amount, 30);
  assert.equal(engine.getValue(0, 'team'), 'A');
  assert.equal(engine.getValue(0, 'amount'), 30);
  assert.throws(() => engine.getRowId(0), /no source record/);
  assert.throws(() => engine.getRowSourceIndex(0), /no source record/);
  assert.throws(() => {
    group.sourceIndices[0] = 99;
  }, TypeError);
  assert.throws(() => {
    group.sums.amount = 99;
  }, TypeError);
  assert.equal(engine.canEdit(0, 0), false);
  assert.equal(engine.isLocked({ scope: 'cell', rowIndex: 0, columnIndex: 0 }), true);
  assert.deepEqual(Object.values(engine.getCellPermission(0, 0)), Array(6).fill(false));
  engine.select(1, 0);
  engine.select(0, 0);
  assert.equal(engine.getFocusedGroup(), 0);
  assert.equal(engine.getSelection(), null);
  assert.deepEqual(engine.getSelectionRanges(), []);
  assert.equal(engine.copySelection(), '');
});

test('collapse, filtering and leaf sorting preserve aggregates and source identity', () => {
  const { engine, source } = fixture();
  engine.setView({ sort: { columnKey: 'amount', direction: 'desc' } });
  assert.equal(engine.getRowId(1), 'b');
  engine.setDataGroupExpanded('A', false);
  assert.equal(engine.rowCount, 5);
  assert.equal(engine.getFocusedGroup(), 0);
  assert.equal(engine.getRowMetadata(0).sums.amount, 30);
  engine.setDataGroupExpanded('A', true);
  assert.equal(engine.getRowId(1), 'b');
  engine.setView({ filters: [{ columnKey: 'team', operator: 'equals', query: 'B' }] });
  assert.equal(engine.getFocusedGroup(), -1);
  assert.equal(engine.rowCount, 2);
  assert.equal(engine.getRowId(1), 'c');
  assert.equal(source.getRowCount(), 4);
  engine.setView({ filters: [{ columnKey: 'team', operator: 'equals', query: 'missing' }] });
  assert.equal(engine.rowCount, 0);
  engine.setView({});
  engine.setGrouping(null);
  assert.equal(engine.rowCount, 4);
  assert.equal(engine.getRowId(0), 'a');
});

test('group-key edits, aggregate edits and history use real source records', () => {
  const { engine, source } = fixture();
  engine.updateCells([{ rowIndex: 2, columnKey: 'team', value: 'B' }]);
  assert.equal(source.getValue(1, 'team'), 'B');
  assert.equal(engine.getRowMetadata(0).sums.amount, 10);
  assert.equal(engine.getRowMetadata(2).sums.amount, 15);
  engine.undo();
  assert.equal(engine.getRowMetadata(0).sums.amount, 30);
  engine.redo();
  assert.equal(engine.getRowMetadata(2).count, 2);
  engine.updateCells([{ rowIndex: 3, columnKey: 'amount', value: 25 }]);
  assert.equal(source.getValue(1, 'amount'), 25);
  assert.equal(engine.getRowMetadata(2).sums.amount, 20);
  engine.focusGroup(0);
  engine.updateCells([{ rowIndex: 1, columnKey: 'team', value: 'B' }]);
  assert.equal(engine.getFocusedGroup(), -1);
  engine.undo();
  assert.equal(engine.getFocusedGroup(), -1);
});

test('invalid groups, overflow and mixed-header mutations fail before any source write', () => {
  const { engine, source } = fixture();
  const before = metadata(engine);
  for (const updates of [
    [
      { rowIndex: 1, columnKey: 'amount', value: 99 },
      { rowIndex: 0, columnKey: 'amount', value: 88 },
    ],
    [{ rowIndex: 1, columnKey: 'team', value: {} }],
    [{ rowIndex: 1, columnKey: 'amount', value: Infinity }],
    [
      { rowIndex: 1, columnKey: 'amount', value: Number.MAX_VALUE },
      { rowIndex: 2, columnKey: 'amount', value: Number.MAX_VALUE },
    ],
  ])
    assert.throws(() => engine.updateCells(updates));
  assert.deepEqual(metadata(engine), before);
  assert.equal(source.getValue(0, 'amount'), 10);
  assert.equal(engine.undo(), false);
  engine.select(2, 0);
  assert.throws(() => engine.paste('A\nB'), /no source record/);
  assert.equal(source.getValue(1, 'team'), 'A');
  assert.throws(() => engine.cutSelectionBlocks(), /unavailable/);
  assert.throws(
    () =>
      engine.format([{ scope: 'range', range: { startRow: 0, endRow: 1, startColumn: 0, endColumn: 0 } }], {
        fontWeight: 'bold',
      }),
    /no source record/,
  );
});

test('grouped bulk abort and revision conflicts leave values and history untouched', async () => {
  for (const mode of ['cancel', 'revision']) {
    const { engine, source } = fixture();
    let revision = 'one',
      prepared = false;
    const signal = { aborted: false };
    await assert.rejects(
      engine.updateCellsAsync([{ rowIndex: 1, columnKey: 'amount', value: 99 }], {
        signal,
        getRevision: () => revision,
        onProgress: () => {
          prepared = true;
        },
        yieldControl: async () => {
          if (prepared) {
            if (mode === 'cancel') signal.aborted = true;
            else revision = 'two';
          }
        },
      }),
      /canceled|revision changed/,
    );
    assert.equal(source.getValue(0, 'amount'), 10);
    assert.equal(engine.getRowMetadata(0).sums.amount, 30);
    assert.equal(engine.undo(), false);
  }
  const { engine } = fixture();
  await engine.updateCellsAsync([{ rowIndex: 1, columnKey: 'amount', value: 99 }], { yieldControl: async () => {} });
  await engine.undoAsync({ yieldControl: async () => {} });
  assert.equal(engine.getRowMetadata(0).sums.amount, 30);
});

test('criteria and incompatible row layout reject atomically; replace skips summaries', () => {
  const { engine } = fixture();
  for (const grouping of [{ columnKey: 'missing' }, { columnKey: 'team', sumColumns: 'amount' }]) {
    assert.throws(() => engine.setGrouping(grouping));
    assert.equal(engine.grouping.columnKey, 'team');
  }
  assert.throws(() => engine.setView({ sort: { columnKey: 'missing', direction: 'asc' } }), /Unknown view column/);
  assert.throws(() => engine.setFrozen(1, 0));
  assert.throws(() => engine.exportState(), /Clear grouping/);
  assert.throws(() => engine.exportConfiguration(), /Clear grouping/);
  assert.throws(() => engine.refreshData(), /Clear grouping/);
  assert.equal(engine.replaceText('A', 'C').changedCells, 2);
  assert.equal(engine.getRowMetadata(0).key, 'C');
});

test('grouping view state round-trips typed keys and rejects corrupt state atomically', () => {
  const { engine } = fixture();
  engine.setDataGroupExpanded('A', false);
  const saved = engine.exportGroupingState();
  engine.setGrouping(null);
  engine.restoreGroupingState(JSON.parse(JSON.stringify(saved)));
  assert.deepEqual(engine.exportGroupingState(), saved);
  assert.equal(engine.rowCount, 5);
  for (const state of [
    null,
    { ...saved, version: 2 },
    { ...saved, collapsedKeys: ['A', 'A'] },
    { ...saved, collapsedKeys: [{}] },
    { ...saved, grouping: { columnKey: 'missing' } },
    { ...saved, grouping: { columnKey: 'team', sumColumns: [42] } },
  ]) {
    assert.throws(() => engine.restoreGroupingState(state));
    assert.deepEqual(engine.exportGroupingState(), saved);
  }
});
