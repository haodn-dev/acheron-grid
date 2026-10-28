import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalDataSource } from '../dist/index.js';
import { localTreeRowsSteps } from '../dist/internal/tree.js';
import { drain, runSteps } from '../dist/internal/bulk.js';

const sourceOf = (rows) => new LocalDataSource(rows, (row) => row.id);
const build = (rows, collapsed = []) => drain(localTreeRowsSteps(sourceOf(rows), ['parent'], 'parent', collapsed));

test('tree preorder preserves sibling order, real IDs and immutable collapse metadata', () => {
  const rows = [
    { id: 'child', parent: 0 },
    { id: '', parent: null },
    { id: 0, parent: '' },
    { id: 'second', parent: '' },
    { id: 'root', parent: undefined },
  ];
  assert.deepEqual(
    build(rows).map((row) => [row.rowId, row.level]),
    [
      ['', 1],
      [0, 2],
      ['child', 3],
      ['second', 2],
      ['root', 1],
    ],
  );
  const result = build(rows, [0]);
  assert.deepEqual(
    result.map((row) => row.rowId),
    ['', 0, 'second', 'root'],
  );
  assert.deepEqual(result[1], { sourceIndex: 2, rowId: 0, parentId: '', level: 2, hasChildren: true, expanded: false });
  assert.ok(Object.isFrozen(result) && result.every(Object.isFrozen));
  assert.throws(() => {
    result[0].level = 8;
  }, TypeError);
  assert.deepEqual(build([]), []);
});

test('tree rejects malformed identities, orphan parents and disconnected cycles, including collapsed ones', () => {
  for (const rows of [
    [{ id: 'a', parent: 'missing' }],
    [{ id: 'a', parent: 'a' }],
    [
      { id: 'root', parent: null },
      { id: 'a', parent: 'b' },
      { id: 'b', parent: 'a' },
    ],
    [{ id: 'a', parent: false }],
    [{ id: 'a', parent: Infinity }],
  ])
    assert.throws(() => build(rows), TypeError);
  assert.throws(
    () =>
      build(
        [
          { id: 'a', parent: 'b' },
          { id: 'b', parent: 'a' },
        ],
        ['a', 'b'],
      ),
    /cycle/,
  );
  const malformed = { getRowCount: () => 2, getRowId: () => 'same', getValue: () => null };
  assert.throws(() => drain(localTreeRowsSteps(malformed, ['parent'], 'parent')), /duplicate/);
  for (const id of [NaN, Infinity, null, false, {}])
    assert.throws(
      () => drain(localTreeRowsSteps({ ...malformed, getRowId: () => id }, ['parent'], 'parent')),
      TypeError,
    );
  assert.throws(() => build([{ id: 'a', parent: null }], ['missing']), /Unknown collapsed/);
  assert.throws(() => build([], ['a', 'a']), /duplicate/);
  assert.throws(() => drain(localTreeRowsSteps(sourceOf([]), ['parent'], 'missing')), /criteria/);
  assert.throws(() => drain(localTreeRowsSteps({ getRowCount: () => -1 }, ['parent'], 'parent')), RangeError);
});

test('tree depth validation is iterative and applies to hidden descendants', () => {
  const chain = Array.from({ length: 4096 }, (_, id) => ({ id, parent: id ? id - 1 : null }));
  assert.equal(build(chain).at(-1).level, 4096);
  chain.push({ id: 4096, parent: 4095 });
  assert.throws(() => build(chain, [0]), /depth/);
});

test('tree reads each local identity and parent once at 100k rows without source writes', () => {
  let ids = 0,
    values = 0;
  const source = {
    getRowCount: () => 100000,
    getRowId: (i) => {
      ids++;
      return i;
    },
    getValue: (i) => {
      values++;
      return i ? 0 : null;
    },
  };
  const result = drain(localTreeRowsSteps(source, ['parent'], 'parent', [0]));
  assert.equal(result.length, 1);
  assert.equal(ids, 100000);
  assert.equal(values, 100000);
});

test('tree snapshots collapse input before yielding and cooperates with cancellation and revision checks', async () => {
  const source = sourceOf(Array.from({ length: 600 }, (_, id) => ({ id, parent: id ? 0 : null })));
  const collapsed = [0];
  const steps = localTreeRowsSteps(source, ['parent'], 'parent', collapsed);
  assert.equal(steps.next().done, false);
  collapsed.length = 0;
  assert.equal(drain(steps).length, 1);
  const signal = { aborted: false };
  await assert.rejects(
    runSteps(
      localTreeRowsSteps(source, ['parent'], 'parent'),
      {
        signal,
        yieldControl: async () => {
          signal.aborted = true;
        },
      },
      () => {},
    ),
    /canceled/,
  );
  let revision = '1',
    yields = 0;
  await assert.rejects(
    runSteps(
      localTreeRowsSteps(source, ['parent'], 'parent'),
      {
        getRevision: () => revision,
        yieldControl: async () => {
          if (++yields === 2) revision = '2';
        },
      },
      () => {},
    ),
    /revision/,
  );
});
