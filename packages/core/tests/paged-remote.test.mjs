import test from 'node:test';
import assert from 'node:assert/strict';
import { createGridEngine, createPagedRemoteDataSource } from '../dist/index.js';

test('integrated draft recovery transitions to uncertain journal recovery and adopts canonical data once', async () => {
  const first = fixture().source;
  await first.loadPage(0);
  first.setValue(0, 'title', 'integrated');
  const draft = JSON.parse(JSON.stringify(first.exportDrafts()));
  first.destroy();
  let journal, sent;
  const second = fixture({
    persistMutation: (value) => {
      journal = JSON.parse(JSON.stringify(value));
    },
    write: async (mutation) => {
      sent = mutation;
      throw Error('Lost ACK');
    },
  }).source;
  await second.restoreDrafts(draft);
  await assert.rejects(second.commit(), /Lost ACK/);
  assert.throws(() => second.exportDrafts(), /pending/);
  assert.equal(second.pendingCellCount, 1);
  second.destroy();
  const { source, requests } = fixture();
  source.restoreMutation(journal);
  await source.commit();
  assert.deepEqual(requests[0], sent);
  assert.equal(source.pendingCellCount, 0);
  assert.equal(source.revision, '2');
  await source.loadPage(0);
  assert.equal(source.getValue(0, 'title'), 'INTEGRATED');
  await assert.rejects(source.restoreDrafts(draft), /no longer matches/);
  assert.equal(source.pendingCellCount, 0);
  source.destroy();
});

test('draft checkpoints survive reload and eviction, validate pages and commit one restored cohort', async () => {
  const first = fixture().source;
  await first.loadPage(0);
  first.setValue(0, 'title', { nested: ['saved'] });
  await first.loadPage(4);
  first.setValue(4, 'title', 'four');
  const saved = first.exportDrafts();
  assert.ok(Object.isFrozen(saved.changes[0].value.nested));
  const snapshot = JSON.parse(JSON.stringify(saved));
  first.destroy();
  const { source, requests } = fixture();
  await source.restoreDrafts(snapshot);
  assert.equal(source.pendingCellCount, 2);
  assert.deepEqual(source.getValue(0, 'title'), { nested: ['saved'] });
  assert.equal(source.getValue(4, 'title'), 'four');
  assert.equal(source.getPageState(0), null);
  assert.equal(requests.length, 0);
  snapshot.changes[0].value.nested[0] = 'mutated';
  assert.deepEqual(source.getValue(0, 'title'), { nested: ['saved'] });
  await source.commit();
  assert.equal(requests.length, 1);
  assert.deepEqual(
    requests[0].changes.map((change) => [change.rowId, change.columnKey, change.previous]),
    [
      [0, 'title', '0'],
      [4, 'title', '4'],
    ],
  );
  assert.equal(source.pendingCellCount, 0);
  source.destroy();
});

test('checkpoint admission and stale rows fail without installing partial drafts', async () => {
  const original = fixture().source;
  await original.loadPage(0);
  original.setValue(0, 'title', 'zero');
  await original.loadPage(4);
  original.setValue(4, 'title', 'four');
  const saved = original.exportDrafts();
  for (const mutate of [
    (value) => {
      value.version = 2;
    },
    (value) => {
      value.datasetId = 'other';
    },
    (value) => {
      value.columnKeys = ['other'];
    },
    (value) => {
      value.query = { sort: { columnKey: 'title', direction: 'desc' } };
    },
    (value) => {
      value.changes.push(value.changes[0]);
    },
    (value) => {
      value.changes[0].rowIndex = -1;
    },
    (value) => {
      value.changes[0].rowId = null;
    },
    (value) => {
      delete value.changes[0].previous;
    },
    (value) => {
      value.changes[0].columnKey = 'other';
    },
    (value) => {
      value.changes[0].value = Infinity;
    },
    (value) => {
      value.revision = 'old';
    },
    (value) => {
      value.total = 9999;
    },
    (value) => {
      value.changes[1].rowId = 0;
    },
    (value) => {
      value.changes[1].previous = 'changed';
    },
  ]) {
    const copy = JSON.parse(JSON.stringify(saved));
    mutate(copy);
    const { source, requests } = fixture();
    await assert.rejects(source.restoreDrafts(copy));
    assert.equal(source.pendingCellCount, 0);
    assert.equal(requests.length, 0);
    assert.equal(source.status, 'ready');
    source.destroy();
  }
  const bounded = fixture({ maxPendingCells: 1 }).source;
  await assert.rejects(bounded.restoreDrafts(saved), /checkpoint/);
  assert.equal(bounded.revision, null);
  bounded.destroy();
  await assert.rejects(original.restoreDrafts(saved), /empty/);
  assert.equal(original.pendingCellCount, 2);
  original.destroy();
});

test('restore guards concurrent commands and cancellation or destroy never installs drafts', async () => {
  const original = fixture().source;
  await original.loadPage(0);
  original.setValue(0, 'title', 'draft');
  const saved = original.exportDrafts();
  original.destroy();
  for (const action of ['cancel', 'destroy']) {
    let resolve;
    const source = fixture({
      load: () =>
        new Promise((done) => {
          resolve = done;
        }),
    }).source;
    const restoring = source.restoreDrafts(saved);
    await new Promise((done) => setImmediate(done));
    assert.equal(source.status, 'loading');
    assert.throws(() => source.setValue(0, 'title', 'other'), /operation/);
    assert.throws(() => source.exportDrafts(), /operation/);
    assert.throws(() => source.setQuery({}), /operation/);
    await assert.rejects(source.restoreDrafts(saved), /operation/);
    await assert.rejects(source.commit(), /operation/);
    source[action]();
    resolve({
      datasetId: 'tasks',
      revision: '1',
      total: 10000,
      rows: [0, 1].map((id) => ({ id, values: { title: String(id) } })),
    });
    await assert.rejects(restoring, /canceled|generation/);
    assert.equal(source.pendingCellCount, 0);
    source.destroy();
  }
});

test('checkpoint export refuses uncertain writes while preserving exact retry', async () => {
  const requests = [];
  const source = fixture({
    write: async (mutation) => {
      requests.push(mutation);
      throw Error('Lost ACK');
    },
  }).source;
  await source.loadPage(0);
  source.setValue(0, 'title', 'draft');
  await assert.rejects(source.commit(), /Lost ACK/);
  assert.throws(() => source.exportDrafts(), /pending/);
  await assert.rejects(source.restoreDrafts({}), /pending/);
  await assert.rejects(source.commit(), /Lost ACK/);
  assert.equal(requests[0], requests[1]);
  source.destroy();
});

test('paged mutation journal recovers evicted rows and query without loads or new IDs', async () => {
  const query = { sort: { columnKey: 'title', direction: 'desc' } };
  let saved,
    original,
    ids = 0,
    writes = 0;
  const first = fixture({
    query,
    persistMutation: (checkpoint) => {
      saved = JSON.parse(JSON.stringify(checkpoint));
    },
    write: async (mutation, signal, criteria) => {
      writes++;
      original = mutation;
      assert.deepEqual(criteria, query);
      throw Error('Lost ACK');
    },
  }).source;
  await first.loadPage(0);
  first.setValue(0, 'title', 'zero');
  await first.loadPage(4);
  first.setValue(4, 'title', 'four');
  await assert.rejects(first.commit(), /Lost ACK/);
  assert.deepEqual(saved.positions, [
    { rowIndex: 0, rowId: 0 },
    { rowIndex: 4, rowId: 4 },
  ]);
  assert.deepEqual(first.exportMutation(), saved);
  first.destroy();
  const fixture2 = fixture({
    query,
    createMutationId: () => {
      ids++;
      return 'new-id';
    },
    write: async (mutation, signal, criteria) => {
      writes++;
      assert.deepEqual(mutation, original);
      assert.deepEqual(criteria, query);
      return {
        mutationId: mutation.mutationId,
        status: 'accepted',
        total: 7,
        delta: {
          datasetId: 'tasks',
          baseRevision: '1',
          revision: '2',
          cells: mutation.changes.map((change) => ({
            rowId: change.rowId,
            columnKey: change.columnKey,
            value: change.value,
          })),
        },
      };
    },
  });
  const source = fixture2.source;
  source.restoreMutation(saved);
  saved.writer.mutation.changes[0].value = 'tampered';
  assert.equal(source.status, 'disconnected');
  assert.equal(source.getRowCount(), 10000);
  assert.equal(source.pendingCellCount, 2);
  assert.equal(source.getValue(0, 'title'), 'zero');
  assert.equal(source.getValue(4, 'title'), 'four');
  assert.equal(fixture2.loads(), 0);
  assert.equal(ids, 0);
  assert.throws(() => source.setValue(0, 'title', 'new'), /pending/);
  assert.throws(() => source.setQuery({}), /pending/);
  await source.commit();
  assert.equal(writes, 2);
  assert.equal(fixture2.loads(), 0);
  assert.equal(ids, 0);
  assert.equal(source.getRowCount(), 7);
  assert.equal(source.revision, '2');
  assert.equal(source.pendingCellCount, 0);
  assert.equal(source.getPageState(0), null);
  assert.throws(() => source.exportMutation(), /No uncertain/);
  source.destroy();
});

test('paged mutation restoration rejects malformed envelopes and row coverage before changing state', async () => {
  const original = fixture({
    write: async () => {
      throw Error('Lost ACK');
    },
  }).source;
  await original.loadPage(0);
  original.setValue(0, 'title', 'zero');
  await original.loadPage(4);
  original.setValue(4, 'title', 'four');
  await assert.rejects(original.commit());
  const saved = original.exportMutation();
  for (const corrupt of [
    (x) => {
      x.version = 2;
    },
    (x) => {
      x.total = -1;
    },
    (x) => {
      x.query = { sort: { columnKey: 'title', direction: 'desc' } };
    },
    (x) => {
      x.positions = [];
    },
    (x) => {
      x.positions[0].rowIndex = x.total;
    },
    (x) => {
      x.positions[1].rowIndex = 0;
    },
    (x) => {
      x.positions[1].rowId = 0;
    },
    (x) => {
      x.positions[0].rowId = 'other';
    },
    (x) => {
      x.positions[0].rowId = '\0acheron-unloaded:0';
    },
    (x) => {
      x.writer.mutation.changes.pop();
    },
    (x) => {
      x.writer.columnKeys = ['other'];
    },
    (x) => {
      x.writer.mutation.changes[0].previous = 'wrong';
    },
    (x) => {
      x.writer.snapshot.datasetId = 'other';
    },
    (x) => {
      x.writer.mutation.mutationId = '';
    },
  ]) {
    const value = JSON.parse(JSON.stringify(saved));
    corrupt(value);
    const source = fixture().source;
    assert.throws(() => source.restoreMutation(value));
    assert.equal(source.revision, null);
    assert.equal(source.getRowCount(), 0);
    assert.equal(source.pendingCellCount, 0);
    source.restoreMutation(saved);
    assert.equal(source.pendingCellCount, 2);
    source.destroy();
  }
  const bounded = fixture({ maxPendingCells: 1 }).source;
  assert.throws(() => bounded.restoreMutation(saved), /checkpoint/);
  bounded.destroy();
  assert.throws(() => original.restoreMutation(saved), /pending|new paged/);
  original.destroy();
});

test('paged persistence failures and destroy while saving cannot send a late write', async () => {
  let writes = 0;
  const source = fixture({
    persistMutation: () => {
      throw Error('Quota');
    },
    write: async () => {
      writes++;
    },
  }).source;
  await source.loadPage(0);
  source.setValue(0, 'title', 'draft');
  await assert.rejects(source.commit(), /Quota/);
  assert.equal(writes, 0);
  assert.equal(source.status, 'disconnected');
  assert.equal(source.pendingCellCount, 1);
  source.destroy();
  let started, release;
  const waiting = new Promise((done) => {
    started = done;
  });
  const destroying = fixture({
    persistMutation: () => {
      started();
      return new Promise((done) => {
        release = done;
      });
    },
    write: async () => {
      writes++;
    },
  }).source;
  await destroying.loadPage(0);
  destroying.setValue(0, 'title', 'draft');
  const operation = destroying.commit();
  await waiting;
  destroying.destroy();
  release();
  await operation;
  assert.equal(writes, 0);
});

test('paged restored rejected/conflict requests preserve existing resolution and ignore old page generations', async () => {
  const original = fixture({
    write: async () => {
      throw Error('Lost ACK');
    },
  }).source;
  await original.loadPage(0);
  original.setValue(0, 'title', 'draft');
  await assert.rejects(original.commit());
  const saved = original.exportMutation();
  original.destroy();
  for (const kind of ['rejected', 'conflict']) {
    const source = fixture({
      write: async (mutation) =>
        kind === 'rejected'
          ? { datasetId: 'tasks', mutationId: mutation.mutationId, status: kind, message: 'Denied', total: 10000 }
          : {
              mutationId: mutation.mutationId,
              status: kind,
              total: 9,
              snapshot: { datasetId: 'tasks', revision: '2', rows: [{ id: 0, values: { title: 'server' } }] },
            },
    }).source;
    source.restoreMutation(saved);
    await source.commit();
    if (kind === 'rejected') {
      assert.equal(source.status, 'ready');
      source.setValue(0, 'title', 'corrected');
      assert.equal(source.pendingCellCount, 1);
    } else {
      assert.equal(source.status, 'conflict');
      source.acceptServer();
      assert.equal(source.getRowCount(), 9);
      assert.equal(source.pendingCellCount, 0);
    }
    source.destroy();
  }
  let resolve;
  const source = fixture({
    load: () =>
      new Promise((done) => {
        resolve = done;
      }),
  }).source;
  const pending = source.loadPage(0);
  await new Promise((done) => setImmediate(done));
  source.restoreMutation(saved);
  resolve({
    datasetId: 'tasks',
    revision: 'stale',
    total: 2,
    rows: [0, 1].map((id) => ({ id, values: { title: 'late' } })),
  });
  await pending;
  assert.equal(source.revision, '1');
  assert.equal(source.getRowCount(), 10000);
  assert.equal(source.getValue(0, 'title'), 'draft');
  source.destroy();
  let finish;
  const reentrant = fixture({
    load: ({ signal }) => {
      signal.addEventListener('abort', () => reentrant.destroy());
      return new Promise((done) => {
        finish = done;
      });
    },
  }).source;
  const loading = reentrant.loadPage(0);
  await new Promise((done) => setImmediate(done));
  assert.throws(() => reentrant.restoreMutation(saved), /destroyed/);
  finish({
    datasetId: 'tasks',
    revision: 'late',
    total: 2,
    rows: [0, 1].map((id) => ({ id, values: { title: 'late' } })),
  });
  await loading;
  assert.equal(reentrant.status, 'destroyed');
  assert.equal(reentrant.pendingCellCount, 0);
});

test('paged object drafts preserve engine history references and freeze write intent at commit entry', async () => {
  const requests = [];
  const { source } = fixture({
    write: async (mutation) => {
      requests.push(mutation);
      if (requests.length === 1) throw Error('Lost ACK');
      return {
        mutationId: mutation.mutationId,
        status: 'accepted',
        total: 10000,
        delta: {
          datasetId: 'tasks',
          baseRevision: '1',
          revision: '2',
          cells: mutation.changes.map((change) => ({
            rowId: change.rowId,
            columnKey: change.columnKey,
            value: change.value,
          })),
        },
      };
    },
  });
  await source.loadPage(0);
  const engine = createGridEngine({ dataSource: source, columns: [{ key: 'title', title: 'Title', editable: true }] });
  const value = { nested: { count: 1 } };
  engine.updateCells([{ rowIndex: 0, columnKey: 'title', value }]);
  assert.equal(source.getValue(0, 'title'), value);
  assert.equal(engine.undo(), true);
  assert.equal(source.pendingCellCount, 0);
  assert.equal(engine.redo(), true);
  const first = source.commit();
  value.nested.count = 99;
  await assert.rejects(first, /Lost ACK/);
  assert.equal(requests[0].changes[0].value.nested.count, 1);
  assert.ok(Object.isFrozen(requests[0].changes[0].value.nested));
  await source.commit();
  assert.equal(requests[0], requests[1]);
  assert.equal(source.pendingCellCount, 0);
  engine.destroy();
  source.destroy();
});

test('paged identity validation includes dirty rows after their cache page was evicted', async () => {
  const { source } = fixture({
    load: async ({ offset }) => ({
      datasetId: 'tasks',
      revision: '1',
      total: 10000,
      rows: [offset === 4 ? 0 : offset, offset + 1].map((id) => ({ id, values: { title: String(id) } })),
    }),
  });
  await source.loadPage(0);
  source.setValue(0, 'title', 'draft');
  await source.loadPage(2);
  await assert.rejects(source.loadPage(4), /identity|ID/);
  assert.equal(source.getRowId(0), 0);
  assert.equal(source.getValue(0, 'title'), 'draft');
  assert.equal(source.pendingCellCount, 1);
  source.destroy();
});

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

test('paged option and page payload boundaries reject malformed loads without installing revisions', async () => {
  for (const extra of [
    { datasetId: '' },
    { datasetId: 3 },
    { columnKeys: [] },
    { columnKeys: ['title', 'title'] },
    { columnKeys: [''] },
    { maxPendingCells: 0 },
    { maxPendingCells: Infinity },
  ])
    assert.throws(() => fixture(extra), TypeError);
  const valid = { datasetId: 'tasks', revision: '1', total: 1, rows: [{ id: 0, values: { title: 'old' } }] };
  for (const patch of [
    { datasetId: 'wrong' },
    { revision: '' },
    { revision: 1 },
    { total: -1 },
    { total: 1.5 },
    { rows: [] },
    { rows: null },
    { rows: [null] },
    { rows: [{ id: 0, values: [] }] },
    { rows: [{ id: 0, values: {} }] },
    { rows: [{ id: '\0acheron-unloaded:fake', values: { title: 'x' } }] },
  ]) {
    const { source } = fixture({ load: async () => ({ ...valid, ...patch }) });
    try {
      await assert.rejects(source.loadPage(0));
      assert.equal(source.revision, null);
      assert.equal(source.pendingCellCount, 0);
    } finally {
      source.destroy();
    }
  }
});

test('paged invalid batches, draft limits and reverts leave existing drafts atomic', async () => {
  const { source } = fixture({ maxPendingCells: 1 });
  try {
    await source.loadPage(0);
    source.setValue(0, 'title', 'draft');
    for (const updates of [
      null,
      [{ rowIndex: 0, columnKey: 'missing', value: 'x' }],
      [{ rowIndex: 0, columnKey: 'title' }],
      [
        { rowIndex: 0, columnKey: 'title', value: 'changed' },
        { rowIndex: 1, columnKey: 'title', value: 'new' },
      ],
    ]) {
      assert.throws(() => source.setValues(updates));
      assert.equal(source.pendingCellCount, 1);
      assert.equal(source.getValue(0, 'title'), 'draft');
      assert.equal(source.getValue(1, 'title'), '1');
    }
    source.setValue(0, 'title', '0');
    assert.equal(source.pendingCellCount, 0);
    await source.commit();
    source.setValue(0, 'title', 'draft');
    const changes = source.getPendingChanges();
    assert.ok(Object.isFrozen(changes) && Object.isFrozen(changes[0]));
    source.discardPending();
    assert.equal(source.pendingCellCount, 0);
    source.reset(4);
    assert.equal(source.getRowCount(), 4);
    assert.equal(source.revision, null);
    assert.throws(() => source.acceptServer(), /conflict/);
  } finally {
    source.destroy();
    source.destroy();
  }
  for (const action of [
    () => source.setValue(0, 'title', 'x'),
    () => source.reset(),
    () => source.cancel(),
    () => source.discardPending(),
    () => source.acceptServer(),
  ])
    assert.throws(action, /destroyed/);
  await assert.rejects(source.commit(), /destroyed/);
});

test('paged malformed receipt totals preserve drafts and committing guards prevent concurrent edits', async () => {
  for (const total of [undefined, -1, 0.5, '1']) {
    const { source } = fixture({
      write: async (mutation) => ({
        mutationId: mutation.mutationId,
        status: 'rejected',
        datasetId: 'tasks',
        message: 'no',
        total,
      }),
    });
    try {
      await source.loadPage(0);
      source.setValue(0, 'title', 'draft');
      await assert.rejects(source.commit());
      assert.equal(source.getValue(0, 'title'), 'draft');
      assert.equal(source.pendingCellCount, 1);
      assert.equal(source.revision, '1');
    } finally {
      source.destroy();
    }
  }
  let complete;
  const { source } = fixture({
    write: (mutation) =>
      new Promise((resolve) => {
        complete = () =>
          resolve({
            mutationId: mutation.mutationId,
            status: 'rejected',
            datasetId: 'tasks',
            message: 'no',
            total: 10000,
          });
      }),
  });
  await source.loadPage(0);
  source.setValue(0, 'title', 'draft');
  const pending = source.commit();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(source.status, 'committing');
  await assert.rejects(source.commit(), /running/);
  assert.throws(() => source.setValue(0, 'title', 'next'), /Resolve/);
  assert.throws(() => source.setQuery({}), /Resolve/);
  assert.throws(() => source.acceptServer(), /conflict/);
  source.destroy();
  complete();
  await pending;
  assert.equal(source.status, 'destroyed');
  assert.equal(source.pendingCellCount, 0);
});

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
