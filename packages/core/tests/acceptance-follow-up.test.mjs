import test from 'node:test';
import assert from 'node:assert/strict';
import { createGridEngine, LocalDataSource, encodeBlocks } from '../dist/index.js';
import { createProjection } from '../dist/internal/projection.js';

test('denied grouping and validated rich paste preserve data, state, history and events', () => {
  const source = new LocalDataSource(
    [
      { id: 1, value: 'a' },
      { id: 2, value: 'b' },
    ],
    (row) => row.id,
  );
  let allow = true;
  const events = [];
  const engine = createGridEngine({
    dataSource: source,
    columns: [
      { key: 'value', title: 'Value', editable: true, validate: (value) => (value === 'bad' ? 'Invalid' : null) },
    ],
    canChangeLayout: () => allow,
    onEvent: (event) => events.push(event.type),
  });
  engine.updateCells([{ rowIndex: 0, columnKey: 'value', value: 'changed' }]);
  engine.undo();
  engine.select(0, 0);
  const state = engine.exportState();
  const history = [engine.canUndo(), engine.canRedo()];
  const count = events.length;
  allow = false;
  assert.throws(() => engine.groupRows(0, 1), /disabled/);
  assert.throws(
    () =>
      engine.pasteSelectionBlocks(
        encodeBlocks([{ row: 0, column: 0, values: [['bad']], formats: [[{ background: '#fff' }]] }]),
      ),
    /Invalid/,
  );
  assert.deepEqual(engine.exportState(), state);
  assert.equal(source.getValue(0, 'value'), 'a');
  assert.deepEqual([engine.canUndo(), engine.canRedo()], history);
  assert.equal(events.length, count);
  allow = true;
  assert.equal(engine.redo(), true);
  assert.equal(source.getValue(0, 'value'), 'changed');
  engine.destroy();
});

test('structural replay remaps current surviving locks and restores deleted locks', () => {
  const source = new LocalDataSource(
    Array.from({ length: 4 }, (_, id) => ({ id, value: String(id) })),
    (row) => row.id,
  );
  const engine = createGridEngine({
    dataSource: source,
    columns: [
      { key: 'value', title: 'Value' },
      { key: 'extra', title: 'Extra' },
    ],
  });
  engine.setLocked({ scope: 'row', rowIndex: 1 }, true);
  engine.deleteRows([0]);
  engine.setLocked({ scope: 'row', rowIndex: 2 }, true);
  assert.equal(engine.undo(), true);
  assert.deepEqual(
    Array.from({ length: 4 }, (_, rowIndex) => engine.isLocked({ scope: 'row', rowIndex })),
    [false, true, false, true],
  );
  assert.equal(engine.redo(), true);
  assert.deepEqual(
    Array.from({ length: 3 }, (_, rowIndex) => engine.isLocked({ scope: 'row', rowIndex })),
    [true, false, true],
  );
  engine.setLocked({ scope: 'cell', rowIndex: 1, columnIndex: 1 }, true);
  engine.deleteColumns([1]);
  assert.equal(engine.undo(), true);
  assert.equal(engine.isLocked({ scope: 'cell', rowIndex: 1, columnIndex: 1 }), true);
  engine.destroy();
});

test('outline projection keeps blocks, frozen prefix and collapsed headers across filters and sorts', () => {
  const rows = Array.from({ length: 15 }, (_, id) => ({
    id,
    score: id % 4,
    text: [4, 8, 12].includes(id) ? 'match' : 'other',
  }));
  const context = {
    dataSource: new LocalDataSource(rows, (row) => row.id),
    rowCount: rows.length,
    columnIndices: new Map([
      ['score', 0],
      ['text', 1],
    ]),
    merges: [{ startRow: 6, endRow: 8, startColumn: 0, endColumn: 0 }],
    groups: [
      { id: 'outer', startRow: 2, endRow: 4, collapsed: false },
      { id: 'inner', startRow: 3, endRow: 4, collapsed: false },
      { id: 'collapsed', startRow: 10, endRow: 12, collapsed: true },
    ],
    frozenRows: 2,
  };
  const projection = createProjection(context, {});
  const blocks = [[0], [1], [2, 3, 4], [5], [6, 7, 8], [9], [10, 11, 12], [13], [14]];
  for (const direction of ['asc', 'desc'])
    for (const query of [null, 'match', 'absent']) {
      const kept = blocks.filter((block) => query === null || block.some((id) => rows[id].text.includes(query)));
      const pinned = kept.filter((block) => block[0] < 2);
      const movable = kept
        .filter((block) => block[0] >= 2)
        .sort((a, b) => (direction === 'asc' ? 1 : -1) * (rows[a[0]].score - rows[b[0]].score) || a[0] - b[0]);
      const expected = [...pinned, ...movable].flat().filter((id) => id !== 11 && id !== 12);
      assert.deepEqual(
        projection.buildProjection({
          sort: { columnKey: 'score', direction },
          ...(query === null ? {} : { filters: [{ columnKey: 'text', query, operator: 'contains' }] }),
        }),
        expected,
      );
    }
});
