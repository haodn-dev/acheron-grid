import test from 'node:test';
import assert from 'node:assert/strict';
import { createPagedRemoteDataSource } from '../dist/index.js';

function fixture(extra = {}) {
  const rows = Array.from({ length: 10000 }, (_, id) => ({ id, values: { title: String(id) } }));
  let revision = '1',
    loads = 0;
  const requests = [];
  const source = createPagedRemoteDataSource({
    datasetId: 'tasks',
    columnKeys: ['title'],
    pageSize: 2,
    maxPages: 1,
    maxPendingCells: 3,
    createAbortController: () => new AbortController(),
    createMutationId: () => 'write-1',
    load: async ({ offset, limit, expectedRevision }) => {
      loads++;
      assert.ok(expectedRevision === null || expectedRevision === revision);
      return { datasetId: 'tasks', revision, total: rows.length, rows: rows.slice(offset, offset + limit) };
    },
    write: async (mutation) => {
      requests.push(mutation);
      revision = '2';
      const cells = mutation.changes.map((change) => ({
        rowId: change.rowId,
        columnKey: change.columnKey,
        value: String(change.value).toUpperCase(),
      }));
      for (const cell of cells) rows[cell.rowId].values[cell.columnKey] = cell.value;
      return {
        mutationId: mutation.mutationId,
        status: 'accepted',
        total: rows.length,
        delta: { datasetId: 'tasks', baseRevision: '1', revision, cells },
      };
    },
    ...extra,
  });
  return { source, rows, requests, loads: () => loads };
}

test('paged drafts survive eviction; accepted bounded receipts invalidate pages without fetching the dataset', async () => {
  const { source, loads, requests } = fixture();
  await source.loadPage(0);
  assert.equal(source.getRowCount(), 10000);
  assert.throws(() => source.setValue(99, 'title', 'unloaded'), /Load/);
  source.setValue(0, 'title', 'draft');
  await source.loadPage(2);
  assert.equal(source.getPageState(0), null);
  assert.equal(source.getRowId(0), 0);
  assert.equal(source.getValue(0, 'title'), 'draft');
  assert.equal(source.getValue(1, 'title'), undefined);
  assert.throws(() => source.setQuery({}), /drafts/);
  await source.commit();
  assert.equal(requests[0].changes.length, 1);
  assert.equal(loads(), 2);
  assert.equal(source.revision, '2');
  assert.equal(source.pendingCellCount, 0);
  assert.equal(source.getValue(0, 'title'), undefined);
  await source.loadPage(0);
  assert.equal(source.getValue(0, 'title'), 'DRAFT');
  assert.equal(loads(), 3);
  source.destroy();
});

test('paged rejected, uncertain and conflict receipts preserve drafts and exact retry', async () => {
  let mode = 'reject',
    first;
  const { source } = fixture({
    write: async (mutation) => {
      if (mode === 'reject')
        return {
          datasetId: 'tasks',
          mutationId: mutation.mutationId,
          status: 'rejected',
          message: 'denied',
          total: 10000,
        };
      if (mode === 'lost') {
        first = mutation;
        throw Error('Lost ACK');
      }
      if (mode === 'retry') {
        assert.equal(mutation, first);
        return {
          mutationId: mutation.mutationId,
          status: 'conflict',
          total: 10000,
          snapshot: { datasetId: 'tasks', revision: '2', rows: [{ id: 0, values: { title: 'server' } }] },
        };
      }
    },
  });
  await source.loadPage(0);
  source.setValue(0, 'title', 'draft');
  await source.commit();
  assert.equal(source.lastError, 'denied');
  assert.equal(source.pendingCellCount, 1);
  mode = 'lost';
  await assert.rejects(source.commit(), /Lost ACK/);
  assert.throws(() => source.discardPending(), /Resolve/);
  assert.throws(() => source.setValue(0, 'title', 'another'), /Resolve/);
  mode = 'retry';
  await source.commit();
  assert.equal(source.status, 'conflict');
  assert.equal(source.conflict.rows[0].values.title, 'server');
  assert.equal(source.getValue(0, 'title'), 'draft');
  source.acceptServer();
  assert.equal(source.pendingCellCount, 0);
  assert.equal(source.revision, '2');
  source.destroy();
});

test('paged validation rejects stale pages, duplicate IDs and malformed receipts atomically', async () => {
  for (const corrupt of [
    (result) => (result.revision = '2'),
    (result) => (result.total = 9999),
    (result) => (result.rows[0].id = 0),
  ]) {
    const { source } = fixture({
      load: async ({ offset }) => {
        const result = {
          datasetId: 'tasks',
          revision: '1',
          total: 10000,
          rows: [offset, offset + 1].map((id) => ({ id, values: { title: String(id) } })),
        };
        if (offset) corrupt(result);
        return result;
      },
      maxPages: 2,
    });
    await source.loadPage(0);
    await assert.rejects(source.loadPage(2));
    assert.equal(source.getValue(0, 'title'), '0');
    assert.equal(source.revision, '1');
    source.destroy();
  }
  const { source } = fixture({
    write: async (mutation) => ({
      status: 'accepted',
      mutationId: mutation.mutationId,
      total: 10000,
      delta: { datasetId: 'tasks', baseRevision: 'wrong', revision: '2', cells: [] },
    }),
  });
  await source.loadPage(0);
  source.setValue(0, 'title', 'draft');
  await assert.rejects(source.commit());
  assert.equal(source.revision, '1');
  assert.equal(source.getValue(0, 'title'), 'draft');
  source.destroy();
});

test('paged query generations discard late loads and validate resets before modifying state', async () => {
  let resolve;
  const { source } = fixture({ load: () => new Promise((done) => (resolve = done)) });
  const old = source.loadPage(0);
  await new Promise((done) => setImmediate(done));
  source.setQuery({ sort: { columnKey: 'title', direction: 'desc' } });
  resolve({
    datasetId: 'tasks',
    revision: 'old',
    total: 2,
    rows: [
      { id: 0, values: { title: 'old' } },
      { id: 1, values: { title: 'old' } },
    ],
  });
  await old;
  assert.equal(source.getRowCount(), 0);
  assert.equal(source.revision, null);
  assert.throws(() => source.setQuery({}, -1));
  assert.equal(source.query.sort.direction, 'desc');
  source.destroy();
  const canceled = fixture({ load: () => new Promise((done) => (resolve = done)) }).source;
  const pending = canceled.loadPage(0);
  await new Promise((done) => setImmediate(done));
  canceled.cancel();
  resolve({
    datasetId: 'tasks',
    revision: 'canceled',
    total: 2,
    rows: [
      { id: 0, values: { title: 'old' } },
      { id: 1, values: { title: 'old' } },
    ],
  });
  await pending;
  assert.equal(canceled.revision, null);
  assert.equal(canceled.getRowCount(), 0);
  canceled.destroy();
});
