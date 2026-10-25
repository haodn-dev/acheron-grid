import test from 'node:test';
import assert from 'node:assert/strict';
import { LocalDataSource, LocalDataView, createGridEngine } from '../dist/index.js';
import { groupLocalRowsSteps } from '../dist/internal/grouping.js';
import { drain, runSteps } from '../dist/internal/bulk.js';

const columns = ['team', 'amount'];
const options = { columnKey: 'team', sumColumns: ['amount'] };
const data = [
  { id: 'a', team: 'A', amount: 10 },
  { id: 'b', team: 'A', amount: 20 },
  { id: 'c', team: 'B', amount: null },
  { id: 'd', team: 'B', amount: -5 },
  { id: 'e', team: null, amount: 7 },
  { id: 'f', team: undefined, amount: '9' },
];
const sourceOf = (rows = data) => new LocalDataSource(rows, (row) => row.id);
const build = (source, indices = Array.from({ length: source.getRowCount() }, (_, i) => i), criteria = options) =>
  drain(groupLocalRowsSteps(source, columns, indices, criteria));
const summary = (groups) => groups.map(({ key, count, sums }) => [key, count, sums.amount]);

test('local groups preserve retained order, raw number sums and immutable snapshots', () => {
  const source = sourceOf();
  const before = data.map((_, i) => source.getRow(i));
  const groups = build(source);
  assert.deepEqual(summary(groups), [
    ['A', 2, 30],
    ['B', 2, -5],
    [null, 2, 7],
  ]);
  assert.deepEqual(
    groups.map((g) => g.sourceIndices),
    [
      [0, 1],
      [2, 3],
      [4, 5],
    ],
  );
  assert.deepEqual(summary(build(source, [0, 2, 4])), [
    ['A', 1, 10],
    ['B', 1, 0],
    [null, 1, 7],
  ]);
  assert.deepEqual(summary(build(source, [3, 1, 0])), [
    ['B', 1, -5],
    ['A', 2, 30],
  ]);
  assert.deepEqual(build(source, []), []);
  for (const group of groups) {
    assert.ok(Object.isFrozen(group) && Object.isFrozen(group.sourceIndices) && Object.isFrozen(group.sums));
    assert.throws(() => group.sourceIndices.push(9), TypeError);
    assert.throws(() => {
      group.sums.amount = 100;
    }, TypeError);
  }
  assert.ok(Object.isFrozen(groups));
  source.setValue(0, 'amount', 99);
  assert.equal(groups[0].sums.amount, 30);
  assert.deepEqual(
    before,
    data.map((row) => ({ id: row.id, values: row })),
  );
});

test('typed grouping keys keep missing, strings, booleans and numbers distinct', () => {
  const keys = [1, '1', true, 'true', false, '', null, undefined, -0, 0];
  const source = sourceOf(keys.map((team, id) => ({ id, team, amount: id % 2 ? false : '12' })));
  const groups = build(source);
  assert.deepEqual(
    groups.map((g) => [g.key, g.count]),
    [
      [1, 1],
      ['1', 1],
      [true, 1],
      ['true', 1],
      [false, 1],
      ['', 1],
      [null, 2],
      [0, 2],
    ],
  );
  assert.equal(Object.is(groups.at(-1).key, -0), false);
  assert.ok(groups.every((g) => g.sums.amount === 0));
  assert.deepEqual(
    build(source, [0, 8, 9], { columnKey: 'team', sumColumns: ['team'] }).map((g) => g.sums.team),
    [1, 0],
  );
  assert.deepEqual(build(source, [0], { columnKey: 'team' })[0].sums, {});
});

test('multiple aggregate columns remain own frozen fields even for prototype-like names', () => {
  const source = {
    getRowCount: () => 2,
    getRowId: (i) => (i === 0 ? '' : 0),
    getValue: (i, key) => (key === 'team' ? '__proto__' : key === '__proto__' ? i + 1 : 10),
  };
  const result = drain(
    groupLocalRowsSteps(source, ['team', '__proto__', 'constructor'], [0, 1], {
      columnKey: 'team',
      sumColumns: ['__proto__', 'constructor'],
    }),
  );
  assert.equal(result[0].key, '__proto__');
  assert.equal(result[0].sums.__proto__, 3);
  assert.equal(result[0].sums.constructor, 20);
  assert.ok(Object.hasOwn(result[0].sums, '__proto__'));
  assert.equal(Object.getPrototypeOf(result[0].sums), Object.prototype);
  assert.ok(Object.isFrozen(result[0].sums));
  assert.deepEqual(drain(groupLocalRowsSteps(sourceOf([]), columns, [], options)), []);
});

test('group validation rejects malformed criteria, indices, identities, keys and numeric overflow', () => {
  const source = sourceOf();
  for (const criteria of [
    null,
    [],
    {},
    { columnKey: 'missing' },
    { columnKey: 'team', sumColumns: null },
    { columnKey: 'team', sumColumns: ['amount', 'amount'] },
    { columnKey: 'team', sumColumns: ['missing'] },
  ])
    assert.throws(() => build(source, [], criteria), TypeError);
  for (const schema of [null, ['team', 'team'], ['team', 1], ['team', ''], ['team', ,]])
    assert.throws(() => drain(groupLocalRowsSteps(source, schema, [], options)), TypeError);
  for (const indices of [null, [-1], [6], [0.5], [NaN], [0, 0], new Array(1)])
    assert.throws(() => build(source, indices), /grouping/);
  for (const count of [-1, 0.5, Infinity, Number.MAX_SAFE_INTEGER + 1])
    assert.throws(() => build({ ...source, getRowCount: () => count }, []), RangeError);
  for (const id of [null, {}, NaN, Infinity, 1n])
    assert.throws(() => build({ getRowCount: () => 1, getRowId: () => id, getValue: () => 'A' }, [0]), TypeError);
  assert.throws(
    () => build({ getRowCount: () => 2, getRowId: () => 0, getValue: () => 'A' }),
    /duplicate grouping row ID/,
  );
  for (const team of [{}, [], NaN, Infinity, 1n, Symbol('key'), () => {}])
    assert.throws(() => build(sourceOf([{ id: 0, team, amount: 1 }])), /Grouping keys/);
  for (const amount of [NaN, Infinity, -Infinity])
    assert.throws(() => build(sourceOf([{ id: 0, team: 'A', amount }])), /Nonfinite grouping sum/);
  assert.throws(
    () => build(sourceOf([0, 1].map((id) => ({ id, team: 'A', amount: Number.MAX_VALUE })))),
    /Nonfinite grouping sum/,
  );
  assert.deepEqual(summary(build(source)), [
    ['A', 2, 30],
    ['B', 2, -5],
    [null, 2, 7],
  ]);
});

test('grouping consumes existing filtered/sorted source indices and rebuilds after engine edit/undo', () => {
  const source = sourceOf();
  const view = new LocalDataView(source, {
    filters: [{ columnKey: 'team', query: 'A', operator: 'equals' }],
    sort: { columnKey: 'amount', direction: 'desc' },
  });
  const indices = Array.from({ length: view.getRowCount() }, (_, i) => view.getSourceIndex(i));
  assert.deepEqual(build(source, indices)[0].sourceIndices, [1, 0]);
  const engine = createGridEngine({
    dataSource: source,
    columns: columns.map((key) => ({ key, title: key, editable: true })),
  });
  const original = build(source);
  engine.updateCells([{ rowIndex: 1, columnKey: 'team', value: 'B' }]);
  assert.deepEqual(summary(build(source)), [
    ['A', 1, 10],
    ['B', 3, 15],
    [null, 2, 7],
  ]);
  assert.equal(engine.undo(), true);
  assert.deepEqual(build(source), original);
  assert.equal(source.getRowId(1), 'b');
  engine.destroy();
});

test('cooperative grouping snapshots inputs and never returns a partial result on cancellation or stale revision', async () => {
  const source = sourceOf(Array.from({ length: 600 }, (_, id) => ({ id, team: id % 2, amount: 1 })));
  const indices = Array.from({ length: 600 }, (_, i) => i),
    schema = [...columns],
    criteria = structuredClone(options);
  const steps = groupLocalRowsSteps(source, schema, indices, criteria);
  assert.equal(steps.next().value.completed, 256);
  indices.fill(0);
  schema.length = 0;
  criteria.columnKey = 'missing';
  criteria.sumColumns.length = 0;
  assert.deepEqual(summary(drain(steps)), [
    [0, 300, 300],
    [1, 300, 300],
  ]);
  for (const mode of ['cancel', 'revision', 'destroy']) {
    const signal = { aborted: false };
    let revision = '1',
      alive = true,
      returned = false;
    const promise = runSteps(
      groupLocalRowsSteps(
        source,
        columns,
        Array.from({ length: 600 }, (_, i) => i),
        options,
      ),
      {
        signal,
        getRevision: () => revision,
        yieldControl: async () => {},
        onProgress: () => {
          if (mode === 'cancel') signal.aborted = true;
          if (mode === 'revision') revision = '2';
          if (mode === 'destroy') alive = false;
        },
      },
      () => {
        if (!alive) throw Error('destroyed');
      },
    ).then(() => {
      returned = true;
    });
    await assert.rejects(
      promise,
      mode === 'cancel' ? /canceled/ : mode === 'revision' ? /revision changed/ : /destroyed/,
    );
    assert.equal(returned, false);
    assert.equal(source.getValue(599, 'amount'), 1);
  }
});

test('the final source read cannot bypass shared revision checks and source failures keep prior snapshots', async () => {
  const source = sourceOf(),
    previous = build(source);
  let revision = '1';
  const changing = {
    getRowCount: () => source.getRowCount(),
    getRowId: (i) => source.getRowId(i),
    getValue: (i, key) => {
      if (i === 5 && key === 'amount') revision = '2';
      return source.getValue(i, key);
    },
  };
  await assert.rejects(
    runSteps(
      groupLocalRowsSteps(changing, columns, [0, 1, 2, 3, 4, 5], options),
      { getRevision: () => revision, yieldControl: async () => {} },
      () => {},
    ),
    /revision changed/,
  );
  for (const getter of ['getValue', 'getRowId']) {
    const broken = {
      getRowCount: () => 6,
      getRowId: (i) => source.getRowId(i),
      getValue: (i, key) => source.getValue(i, key),
      [getter]: () => {
        throw Error('source failed');
      },
    };
    assert.throws(() => build(broken), /source failed/);
    assert.deepEqual(build(source), previous);
  }
  let counts = 0;
  assert.throws(
    () => build({ getRowCount: () => (++counts === 1 ? 1 : 2), getRowId: () => 0, getValue: () => 1 }, [0]),
    /source count changed/,
  );
});

test('grouping read work scales with the retained working set rather than the logical source size', () => {
  for (const count of [10_000, 100_000])
    for (const cardinality of [1, 10, 1000, count]) {
      let ids = 0,
        values = 0,
        counts = 0;
      const source = {
        getRowCount: () => {
          counts++;
          return 1_000_000;
        },
        getRowId: (i) => {
          ids++;
          return i;
        },
        getValue: (i, key) => {
          values++;
          return key === 'team' ? i % cardinality : 1;
        },
      };
      const result = build(
        source,
        Array.from({ length: count }, (_, i) => i),
      );
      assert.equal(result.length, cardinality);
      assert.equal(
        result.reduce((n, group) => n + group.count, 0),
        count,
      );
      assert.equal(
        result.reduce((n, group) => n + group.sums.amount, 0),
        count,
      );
      assert.equal(ids, count);
      assert.equal(values, count * 2);
      assert.equal(counts, 2);
    }
});
