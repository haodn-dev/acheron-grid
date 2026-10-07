import test from 'node:test';
import assert from 'node:assert/strict';
import { createGridEngine, LocalDataSource, LocalDataView } from '../dist/index.js';

function fixture(extra = {}, count = 1024) {
  const source = new LocalDataSource(
    Array.from({ length: count }, (_, id) => ({ id, value: 'old', rank: id % 17 })),
    (row) => row.id,
  );
  const changes = [];
  const engine = createGridEngine({
    dataSource: source,
    columns: [
      { key: 'value', title: 'Value', editable: true },
      { key: 'rank', title: 'Rank', editable: true },
    ],
    onInvalidate: (change) => changes.push(change),
    ...extra,
  });
  return { source, engine, changes };
}
const scheduler = { yieldControl: async () => {} };

test('revision-guarded final checks yield and reject late changes without losing data or history', async () => {
  for (const operation of ['update', 'paste', 'undo', 'redo']) {
    const { engine, source } = fixture();
    const updates = Array.from({ length: 1024 }, (_, rowIndex) => ({ rowIndex, columnKey: 'value', value: 'new' }));
    if (operation === 'undo' || operation === 'redo') engine.updateCells(updates);
    if (operation === 'redo') engine.undo();
    if (operation === 'paste') engine.select(0, 0);
    let revision = '1',
      passes = 0;
    const options = {
      ...scheduler,
      getRevision: () => revision,
      onProgress: (progress) => {
        if (
          progress.phase === 'validate' &&
          progress.completed === 1024 &&
          ++passes === (operation === 'paste' ? 5 : 3)
        )
          revision = '2';
      },
    };
    const job =
      operation === 'update'
        ? engine.updateCellsAsync(updates, options)
        : operation === 'paste'
          ? engine.pasteAsync(Array(1024).fill('new').join('\n'), options)
          : operation === 'undo'
            ? engine.undoAsync(options)
            : engine.redoAsync(options);
    options.getRevision = undefined;
    await assert.rejects(job, /revision changed/);
    assert.equal(source.getValue(0, 'value'), operation === 'undo' ? 'new' : 'old');
    assert.equal(engine.canUndo(), operation === 'undo');
    assert.equal(engine.canRedo(), operation === 'redo');
    engine.destroy();
  }
});

test('bulk snapshots coordinates/options and rechecks paste authority after the last yield', async () => {
  let pasteable = true;
  let validationPasses = 0;
  const { engine, source } = fixture({ resolveCellPermission: () => ({ pasteable }) });
  const updates = [{ rowIndex: 0, columnKey: 'value', value: 'captured' }];
  const job = engine.updateCellsAsync(updates, scheduler);
  updates[0].value = 'changed';
  await job;
  assert.equal(source.getValue(0, 'value'), 'captured');
  engine.undo();
  engine.select(0, 0);
  await assert.rejects(
    engine.pasteAsync(Array(1024).fill('new').join('\n'), {
      ...scheduler,
      onProgress: (progress) => {
        if (progress.phase === 'validate' && progress.completed === 1024 && ++validationPasses === 3) pasteable = false;
      },
    }),
    /paste/i,
  );
  assert.equal(source.getValue(0, 'value'), 'old');
  assert.equal(engine.canUndo(), false);
  engine.destroy();
});

test('bulk paste/update/history yield without exposing partial data and retain one command', async () => {
  const { source, engine, changes } = fixture();
  engine.select(0, 0);
  changes.length = 0;
  let yields = 0;
  const options = {
    yieldControl: async () => {
      yields++;
      assert.equal(source.getValue(0, 'value'), 'old');
      assert.throws(
        () => engine.updateCells([{ rowIndex: 0, columnKey: 'value', value: 'nested' }]),
        /Nested grid mutations/,
      );
    },
  };
  const quoted = '"' + 'x'.repeat(9000) + '\n""quoted"""';
  await engine.pasteAsync([quoted, ...Array(1023).fill('new')].join('\n'), options);
  assert.ok(yields > 10);
  assert.equal(source.getValue(0, 'value'), 'x'.repeat(9000) + '\n"quoted"');
  assert.equal(source.getValue(1023, 'value'), 'new');
  assert.equal(changes.filter((change) => change.type === 'cells').length, 1);
  assert.equal(await engine.undoAsync(scheduler), true);
  assert.equal(source.getValue(1023, 'value'), 'old');
  assert.equal(engine.canUndo(), false);
  assert.equal(await engine.redoAsync(scheduler), true);
  await engine.updateCellsAsync(
    [
      { rowIndex: 0, columnKey: 'rank', value: 99 },
      { rowIndex: 0, columnKey: 'rank', value: 100 },
    ],
    scheduler,
  );
  assert.equal(source.getValue(0, 'rank'), 100);
  engine.destroy();
});

test('bulk cancellation, revisions, external changes and disposal cannot partially commit', async () => {
  for (const failure of ['abort', 'revision', 'external', 'destroy']) {
    const { engine, source } = fixture();
    const signal = { aborted: false };
    let revision = '1',
      yields = 0;
    const job = engine.updateCellsAsync(
      Array.from({ length: 1024 }, (_, rowIndex) => ({ rowIndex, columnKey: 'value', value: 'new' })),
      {
        signal,
        getRevision: () => revision,
        yieldControl: async () => {
          if (++yields !== 3) return;
          if (failure === 'abort') signal.aborted = true;
          if (failure === 'revision') revision = '2';
          if (failure === 'external') source.setValue(0, 'value', 'external');
          if (failure === 'destroy') engine.destroy();
        },
      },
    );
    if (failure === 'external') {
      // Changes before value preparation become the base; a later host revision must guard them.
      await job;
      assert.equal(source.getValue(0, 'value'), 'new');
    } else {
      await assert.rejects(job);
      assert.equal(source.getValue(0, 'value'), 'old');
      assert.equal(engine.canUndo(), false);
    }
    engine.destroy();
  }
  const { engine, source } = fixture();
  let changed = false;
  await assert.rejects(
    engine.updateCellsAsync(
      Array.from({ length: 1024 }, (_, rowIndex) => ({ rowIndex, columnKey: 'value', value: 'new' })),
      {
        ...scheduler,
        onProgress: (progress) => {
          if (progress.phase === 'validate' && !changed) {
            source.setValue(0, 'value', 'external');
            changed = true;
          }
        },
      },
    ),
    /changed|conflict/i,
  );
  assert.equal(source.getValue(1023, 'value'), 'old');
  await engine.updateCellsAsync([{ rowIndex: 1, columnKey: 'value', value: 'recovered' }], scheduler);
  assert.equal(source.getValue(1, 'value'), 'recovered');
  engine.destroy();
});

test('cooperative sort/filter matches the synchronous stable projection', async () => {
  const rows = Array.from({ length: 1400 }, (_, id) => ({
    id,
    value: id % 13 === 0 ? null : ['A2', 'a10', 'B', ''][id % 4],
    rank: id % 17,
  }));
  const source = new LocalDataSource(rows, (row) => row.id);
  const engine = createGridEngine({
    dataSource: source,
    columns: [
      { key: 'value', title: 'Value' },
      { key: 'rank', title: 'Rank' },
    ],
  });
  for (const view of [
    {
      sorts: [
        { columnKey: 'value', direction: 'desc' },
        { columnKey: 'rank', direction: 'asc' },
      ],
    },
    {
      sort: { columnKey: 'rank', direction: 'desc' },
      filters: [{ columnKey: 'value', query: 'a', operator: 'contains' }],
    },
    { filters: [{ columnKey: 'value', query: '', operator: 'empty' }] },
    {},
  ]) {
    const expected = new LocalDataView(source, view);
    await engine.setViewAsync(view, scheduler);
    assert.deepEqual(
      Array.from({ length: engine.rowCount }, (_, i) => engine.getRowId(i)),
      Array.from({ length: expected.getRowCount() }, (_, i) => expected.getRowId(i)),
    );
  }
  engine.destroy();
});

test('history limits reject oversized commands before writes and evict oldest retained records', () => {
  const { engine, source } = fixture({ historyLimits: { maxCommands: 2, maxValueCells: 3 } });
  assert.throws(
    () =>
      engine.updateCells(Array.from({ length: 4 }, (_, rowIndex) => ({ rowIndex, columnKey: 'value', value: 'new' }))),
    /budget/,
  );
  assert.equal(source.getValue(0, 'value'), 'old');
  for (let rowIndex = 0; rowIndex < 3; rowIndex++) engine.updateCells([{ rowIndex, columnKey: 'value', value: 'new' }]);
  assert.equal(engine.undo(), true);
  assert.equal(engine.undo(), true);
  assert.equal(engine.undo(), false);
  assert.equal(source.getValue(0, 'value'), 'new');
  engine.destroy();
});
