import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { createAsyncDataSource, createGridEngine } from '@acheron-grid/core';

test('query snapshots isolate callers, validate atomically and discard old loads', async () => {
  const requests = [];
  const criteria = { sorts: [{ columnKey: 'name', direction: 'asc' }], filters: [{ columnKey: 'name', query: 'old' }] };
  const source = createAsyncDataSource({ query: criteria, pageSize: 1, maxConcurrentLoads: 1,
    createAbortController: () => new AbortController(),
    load: request => new Promise((resolve, reject) => requests.push({ ...request, resolve, reject })) });
  criteria.filters[0].query = 'mutated';
  assert.equal(source.query.filters[0].query, 'old');
  assert.throws(() => { source.query.sorts[0].direction = 'desc'; }, TypeError);
  const old = source.loadPage(0), queued = source.loadPage(1);
  await setImmediate();
  const snapshot = source.query;
  for (const invalid of [null, { filters: null }, { sorts: [null] }, { sorts: Array(1) },
    { sorts: [{ columnKey: 'name', direction: 'asc' }, { columnKey: 'name', direction: 'desc' }] }]) {
    assert.throws(() => source.setQuery(invalid), TypeError);
    assert.equal(source.query, snapshot);
    assert.equal(requests[0].signal.aborted, false);
  }
  assert.throws(() => source.setQuery({}, -1), RangeError);
  source.setQuery({ filters: [{ columnKey: 'name', query: 'new' }] });
  await queued;
  assert.equal(requests[0].signal.aborted, true);
  const fresh = source.loadPage(0);
  requests[0].reject(new Error('stale failure'));
  await old; await setImmediate();
  assert.equal(requests.length, 2);
  assert.equal(requests[0].query.filters[0].query, 'old');
  assert.equal(requests[1].query.filters[0].query, 'new');
  assert.equal(source.getPageState(0).status, 'loading');
  requests[1].resolve({ total: 1, rows: [{ name: 'new' }] }); await fresh;
  assert.equal(source.getValue(0, 'name'), 'new');
  assert.throws(() => source.setQuery({ filters: [{ columnKey: 'name', query: 1 }] }), TypeError);
  assert.equal(source.getValue(0, 'name'), 'new');
  source.reset(); assert.equal(source.query.filters[0].query, 'new');
  source.destroy();
  assert.throws(() => source.setQuery({}), /destroyed/);
  assert.throws(() => source.query, /destroyed/);
});

test('abort listeners see the installed query and cannot reopen a destroyed source', async () => {
  let reentrant, complete;
  const seen = [];
  const source = createAsyncDataSource({ pageSize: 1, maxConcurrentLoads: 1,
    createAbortController: () => new AbortController(),
    load: ({ signal, query }) => {
      seen.push(query);
      if (seen.length === 1) {
        signal.addEventListener('abort', () => { assert.equal(source.getRowCount(), 2); reentrant = source.loadPage(0); });
        return new Promise(resolve => { complete = resolve; });
      }
      signal.addEventListener('abort', () => assert.throws(() => source.loadPage(0), /destroyed/));
      return Promise.resolve({ total: 2, rows: [{ value: 'fresh' }] });
    } });
  const old = source.loadPage(0); await setImmediate();
  source.setQuery({ sort: { columnKey: 'value', direction: 'desc' } }, 2);
  complete({ total: 1, rows: [{ value: 'stale' }] });
  await old; await reentrant;
  assert.equal(seen[1].sort.direction, 'desc');
  assert.equal(source.getValue(0, 'value'), 'fresh');
  source.destroy();
});

test('host refresh clears previous query identity state and destruction rejects abort reentry', async () => {
  let source;
  source = createAsyncDataSource({ createAbortController: () => new AbortController(),
    load: async ({ signal }) => {
      signal.addEventListener('abort', () => assert.throws(() => source.loadPage(0), /destroyed/));
      return { total: 1, rows: [{ value: 'old' }] };
    } });
  await source.loadPage(0);
  const engine = createGridEngine({ dataSource: source, columns: [{ key: 'value', title: 'Value' }] });
  engine.select(0, 0);
  source.setQuery({}); engine.refreshData();
  assert.equal(engine.getSelectionRanges().length, 0);
  const pending = source.loadPage(0);
  await setImmediate(); await pending;
  engine.destroy(); source.destroy();
  const pendingSource = createAsyncDataSource({ createAbortController: () => new AbortController(),
    load: ({ signal }) => new Promise(resolve => {
      signal.addEventListener('abort', () => {
        assert.throws(() => pendingSource.loadPage(0), /destroyed/);
        resolve({ total: 0, rows: [] });
      });
    }) });
  const load = pendingSource.loadPage(0); await setImmediate();
  pendingSource.destroy(); await load;
});
