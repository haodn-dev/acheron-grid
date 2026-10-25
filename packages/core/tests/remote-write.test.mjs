import test from 'node:test';
import assert from 'node:assert/strict';
import { createRemoteDataSource, createGridEngine } from '../dist/index.js';
const snapshot = (revision = '0', value = 'old') => ({
  datasetId: 'people',
  revision,
  rows: [
    { id: 'a', values: { name: value } },
    { id: 'b', values: { name: 'other' } },
  ],
});
const accepted = (request) => ({
  mutationId: request.mutationId,
  status: 'accepted',
  snapshot: snapshot('1', request.changes[0].value),
});
function fixture(write = async (request) => accepted(request), extra = {}) {
  let id = 0;
  return createRemoteDataSource({
    datasetId: 'people',
    columnKeys: ['name'],
    createAbortController: () => new AbortController(),
    createMutationId: () => `m-${++id}`,
    load: async () => snapshot(),
    write,
    ...extra,
  });
}

test('remote option, snapshot and row validation reject malformed transport data', async () => {
  for (const extra of [
    { datasetId: '' },
    { datasetId: 1 },
    { columnKeys: [] },
    { columnKeys: ['name', 'name'] },
    { columnKeys: [''] },
    { columnKeys: [1] },
    { maxRows: 0 },
    { maxPendingCells: 0.5 },
    { persistMutation: true },
  ])
    assert.throws(() => fixture(undefined, extra), TypeError);
  for (const value of [
    null,
    { ...snapshot(), datasetId: 'wrong' },
    { ...snapshot(), revision: '' },
    { ...snapshot(), revision: 1 },
    { ...snapshot(), rows: {} },
    { ...snapshot(), rows: [null] },
    { ...snapshot(), rows: [{ id: 'a', values: [] }] },
    { ...snapshot(), rows: [{ id: 'a', values: {} }] },
    {
      ...snapshot(),
      rows: [
        { id: 'a', values: { name: 'x' } },
        { id: 'a', values: { name: 'y' } },
      ],
    },
  ]) {
    const remote = fixture(undefined, { load: async () => value });
    try {
      await assert.rejects(remote.resync());
      assert.equal(remote.status, 'disconnected');
      assert.equal(remote.revision, null);
      assert.equal(remote.getRowCount(), 0);
    } finally {
      remote.destroy();
    }
  }
  const limited = fixture(undefined, { maxRows: 1 });
  try {
    await assert.rejects(limited.resync(), /snapshot/);
  } finally {
    limited.destroy();
  }
});

test('mutation checkpoint reload retries the exact accepted request without loading or creating another ID', async () => {
  let journal,
    request,
    writes = 0,
    loads = 0,
    ids = 0;
  const first = fixture(
    async (mutation) => {
      request = mutation;
      writes++;
      throw Error('Lost ACK');
    },
    {
      persistMutation: (checkpoint) => {
        journal = JSON.parse(JSON.stringify(checkpoint));
      },
    },
  );
  await first.resync();
  const value = { nested: ['draft'] };
  first.setValue(0, 'name', value);
  const operation = first.commit();
  value.nested[0] = 'changed after commit entry';
  await assert.rejects(operation, /Lost ACK/);
  assert.deepEqual(journal.mutation, request);
  assert.equal(journal.snapshot.rows[0].values.name, 'old');
  const exported = first.exportMutation();
  assert.ok(Object.isFrozen(exported.mutation.changes[0].value.nested));
  first.destroy();
  const restored = fixture(
    async (mutation) => {
      writes++;
      assert.deepEqual(mutation, request);
      return accepted(mutation);
    },
    {
      createMutationId: () => {
        ids++;
        return 'different';
      },
      load: async () => {
        loads++;
        return snapshot('99', 'newer server');
      },
    },
  );
  restored.restoreMutation(journal);
  journal.mutation.changes[0].value.nested[0] = 'tampered';
  assert.equal(restored.status, 'disconnected');
  assert.deepEqual(restored.getValue(0, 'name'), { nested: ['draft'] });
  assert.throws(() => restored.setValue(0, 'name', 'other'), /ready/);
  assert.throws(() => restored.resync(true), /uncertain/);
  await restored.commit();
  assert.equal(restored.status, 'ready');
  assert.equal(restored.pendingCellCount, 0);
  assert.equal(restored.revision, '1');
  assert.equal(writes, 2);
  assert.equal(loads, 0);
  assert.equal(ids, 0);
  assert.throws(() => restored.exportMutation(), /No uncertain/);
  restored.destroy();
});

test('persistence failure and disconnect or destroy while persisting cannot start transport', async () => {
  let writes = 0;
  const source = fixture(
    async (mutation) => {
      writes++;
      return accepted(mutation);
    },
    {
      persistMutation: () => {
        throw Error('Quota');
      },
    },
  );
  await source.resync();
  source.setValue(0, 'name', 'draft');
  await assert.rejects(source.commit(), /Quota/);
  assert.equal(writes, 0);
  assert.equal(source.status, 'disconnected');
  assert.equal(source.pendingCellCount, 1);
  assert.equal(source.exportMutation().mutation.mutationId, 'm-1');
  source.destroy();
  for (const action of ['disconnect', 'destroy']) {
    let release, started;
    const waiting = new Promise((done) => {
      started = done;
    });
    const remote = fixture(
      async (mutation) => {
        writes++;
        return accepted(mutation);
      },
      {
        persistMutation: () => {
          started();
          return new Promise((done) => {
            release = done;
          });
        },
      },
    );
    await remote.resync();
    remote.setValue(0, 'name', 'draft');
    const operation = remote.commit();
    await waiting;
    remote[action]();
    release();
    await operation;
    assert.equal(writes, 0);
    if (action === 'disconnect') assert.equal(remote.pendingCellCount, 1);
    remote.destroy();
  }
});

test('mutation recovery rejects malformed or incompatible checkpoints atomically', async () => {
  const original = fixture(async () => {
    throw Error('Lost ACK');
  });
  await original.resync();
  original.setValue(0, 'name', 'draft');
  await assert.rejects(original.commit());
  const checkpoint = original.exportMutation();
  const corruptions = [
    (x) => {
      x.version = 2;
    },
    (x) => {
      x.columnKeys = ['other'];
    },
    (x) => {
      x.snapshot.datasetId = 'other';
    },
    (x) => {
      x.mutation.datasetId = 'other';
    },
    (x) => {
      x.mutation.expectedRevision = 'other';
    },
    (x) => {
      x.mutation.mutationId = '';
    },
    (x) => {
      x.mutation.changes = [];
    },
    (x) => {
      x.mutation.changes.push(x.mutation.changes[0]);
    },
    (x) => {
      x.mutation.changes[0].rowId = 'unknown';
    },
    (x) => {
      x.mutation.changes[0].columnKey = 'other';
    },
    (x) => {
      x.mutation.changes[0].previous = 'wrong';
    },
    (x) => {
      delete x.mutation.changes[0].value;
    },
    (x) => {
      x.mutation.extra = true;
    },
    (x) => {
      x.mutation.changes[0].extra = true;
    },
    (x) => {
      x.mutation.changes[0].value = Infinity;
    },
  ];
  for (const corrupt of corruptions) {
    const saved = JSON.parse(JSON.stringify(checkpoint));
    corrupt(saved);
    const remote = fixture();
    assert.throws(() => remote.restoreMutation(saved));
    assert.equal(remote.getRowCount(), 0);
    assert.equal(remote.revision, null);
    assert.equal(remote.pendingCellCount, 0);
    remote.restoreMutation(checkpoint);
    assert.equal(remote.pendingCellCount, 1);
    remote.destroy();
  }
  const small = fixture(undefined, { maxRows: 1 });
  assert.throws(() => small.restoreMutation(checkpoint), /snapshot/);
  small.destroy();
  assert.throws(() => original.restoreMutation(checkpoint), /new remote/);
  original.destroy();
});

test('restored mutations keep existing conflict and definite rejection resolution', async () => {
  const original = fixture(async () => {
    throw Error('Lost ACK');
  });
  await original.resync();
  original.setValue(0, 'name', 'draft');
  await assert.rejects(original.commit());
  const saved = original.exportMutation();
  original.destroy();
  for (const kind of ['conflict', 'rejected']) {
    const remote = fixture(async (mutation) =>
      kind === 'conflict'
        ? { mutationId: mutation.mutationId, status: kind, snapshot: snapshot('2', 'server') }
        : { datasetId: 'people', mutationId: mutation.mutationId, status: kind, message: 'Denied' },
    );
    remote.restoreMutation(saved);
    await remote.commit();
    if (kind === 'conflict') {
      assert.equal(remote.status, 'conflict');
      assert.throws(() => remote.exportMutation(), /No uncertain/);
      remote.acceptServer();
      assert.equal(remote.getValue(0, 'name'), 'server');
    } else {
      assert.equal(remote.status, 'ready');
      assert.equal(remote.pendingCellCount, 1);
      remote.setValue(0, 'name', 'corrected');
    }
    remote.destroy();
  }
});

test('remote malformed receipts and mutation IDs preserve drafts for explicit retry', async () => {
  const results = [
    null,
    {},
    { status: 'unknown' },
    { status: 'rejected', datasetId: 'wrong', message: 'no' },
    { status: 'rejected', datasetId: 'people', message: 1 },
    { status: 'accepted', snapshot: null },
  ];
  for (const result of results) {
    const remote = fixture(async (request) => result && { mutationId: request.mutationId, ...result });
    try {
      await remote.resync();
      remote.setValue(0, 'name', 'draft');
      await assert.rejects(remote.commit());
      assert.equal(remote.pendingCellCount, 1);
      assert.equal(remote.getValue(0, 'name'), 'draft');
      assert.equal(remote.revision, '0');
    } finally {
      remote.destroy();
    }
  }
  for (const id of ['', null, 1]) {
    const remote = fixture(undefined, { createMutationId: () => id });
    try {
      await remote.resync();
      remote.setValue(0, 'name', 'draft');
      assert.throws(() => remote.commit(), /mutation ID/);
      assert.equal(remote.status, 'ready');
      assert.equal(remote.pendingCellCount, 1);
    } finally {
      remote.destroy();
    }
  }
});

test('remote observer failures are bounded, drainable and unsubscribed without disrupting state', async () => {
  const remote = fixture();
  let notifications = 0;
  const unsubscribe = remote.subscribe(() => {
    notifications++;
    throw Error('observer');
  });
  try {
    for (let i = 0; i < 8; i++) {
      await remote.resync();
      remote.disconnect();
    }
    assert.equal(remote.takeObserverErrors().length, 10);
    assert.deepEqual(remote.takeObserverErrors(), []);
    const before = notifications;
    unsubscribe();
    unsubscribe();
    await remote.reconnect();
    assert.equal(notifications, before);
    assert.equal(remote.status, 'ready');
    await remote.commit();
    assert.equal(remote.pendingCellCount, 0);
  } finally {
    remote.destroy();
    remote.destroy();
  }
  for (const action of [
    () => remote.getRowCount(),
    () => remote.getRowId(0),
    () => remote.getValue(0, 'name'),
    () => remote.getPendingChanges(),
    () => remote.subscribe(() => {}),
    () => remote.resync(),
    () => remote.commit(),
    () => remote.disconnect(),
    () => remote.acceptServer(),
    () => remote.setValue(0, 'name', 'x'),
  ])
    assert.throws(action, /destroyed/);
});

test('remote late rejected loaders and writers cannot resurrect a disconnected or destroyed source', async () => {
  for (const phase of ['load', 'write'])
    for (const finish of ['disconnect', 'destroy']) {
      let reject;
      const delayed = () =>
        new Promise((_, fail) => {
          reject = fail;
        });
      const remote = fixture(phase === 'write' ? delayed : undefined, phase === 'load' ? { load: delayed } : {});
      if (phase === 'write') {
        await remote.resync();
        remote.setValue(0, 'name', 'draft');
      }
      const pending = phase === 'load' ? remote.resync() : remote.commit();
      await Promise.resolve();
      remote[finish]();
      reject(Error('late transport failure'));
      await pending;
      assert.equal(remote.status, finish === 'destroy' ? 'destroyed' : 'disconnected');
      assert.equal(remote.lastError, undefined);
      remote.destroy();
    }
});
test('remote engine validation, optimistic atomic drafts, undo and accepted canonical refresh', async () => {
  const remote = fixture();
  await remote.resync();
  const engine = createGridEngine({
    dataSource: remote,
    columns: [
      { key: 'name', title: 'Name', editable: true, validate: (value) => (value.length > 20 ? 'Too long' : undefined) },
    ],
  });
  assert.throws(
    () =>
      engine.updateCells([
        { rowIndex: 0, columnKey: 'name', value: 'draft' },
        { rowIndex: 1, columnKey: 'name', value: 'x'.repeat(21) },
      ]),
    /Too long/,
  );
  assert.equal(remote.pendingCellCount, 0);
  engine.editCell(0, 0, 'draft');
  assert.equal(remote.pendingCellCount, 1);
  engine.undo();
  assert.equal(remote.pendingCellCount, 0);
  engine.redo();
  await remote.commit();
  assert.equal(remote.status, 'ready');
  assert.equal(remote.revision, '1');
  assert.equal(remote.pendingCellCount, 0);
  assert.equal(remote.getValue(0, 'name'), 'draft');
  engine.refreshData('values');
  assert.equal(engine.canUndo(), false);
  engine.destroy();
  remote.destroy();
});
test('lost ACK retries exact immutable mutation, freezes edits and forbids uncertain discard', async () => {
  const requests = [];
  let attempts = 0;
  const remote = fixture(async (request) => {
    requests.push(request);
    if (++attempts === 1) throw Error('Lost ACK');
    return accepted(request);
  });
  await remote.resync();
  remote.setValue(0, 'name', 'draft');
  await assert.rejects(remote.commit(), /Lost ACK/);
  assert.equal(remote.status, 'disconnected');
  assert.throws(() => remote.setValue(0, 'name', 'next'), /ready/);
  assert.throws(() => remote.resync(true), /uncertain/);
  await remote.commit();
  assert.equal(requests[0], requests[1]);
  assert.equal(Object.isFrozen(requests[0].changes), true);
  assert.equal(remote.getValue(0, 'name'), 'draft');
});
test('conflict preserves draft until explicit server adoption; rejection permits correction', async () => {
  let reject = false;
  const remote = fixture(async (request) =>
    reject
      ? { datasetId: 'people', mutationId: request.mutationId, status: 'rejected', message: 'Server validation' }
      : { mutationId: request.mutationId, status: 'conflict', snapshot: snapshot('4', 'server') },
  );
  await remote.resync();
  remote.setValue(0, 'name', 'draft');
  await remote.commit();
  assert.equal(remote.status, 'conflict');
  assert.equal(remote.getValue(0, 'name'), 'draft');
  assert.equal(remote.conflict.rows[0].values.name, 'server');
  assert.throws(() => remote.setValue(0, 'name', 'next'));
  const drafts = remote.getPendingChanges();
  remote.acceptServer();
  assert.equal(remote.getValue(0, 'name'), 'server');
  assert.equal(remote.pendingCellCount, 0);
  assert.equal(drafts[0].value, 'draft');
  reject = true;
  remote.setValue(0, 'name', 'retry');
  await remote.commit();
  assert.equal(remote.status, 'ready');
  assert.equal(remote.pendingCellCount, 1);
  assert.equal(remote.lastError, 'Server validation');
  remote.setValue(0, 'name', 'corrected');
});
test('bounded staging handles duplicate/reverted edits and nullish originals atomically', async () => {
  const remote = fixture(undefined, { maxPendingCells: 1, load: async () => snapshot('0', null) });
  await remote.resync();
  remote.setValue(0, 'name', 'one');
  remote.setValues([
    { rowIndex: 0, columnKey: 'name', value: null },
    { rowIndex: 0, columnKey: 'name', value: 'two' },
  ]);
  assert.equal(remote.getPendingChanges()[0].previous, null);
  assert.throws(
    () =>
      remote.setValues([
        { rowIndex: 0, columnKey: 'name', value: 'three' },
        { rowIndex: 1, columnKey: 'name', value: 'four' },
      ]),
    /limit/,
  );
  assert.equal(remote.getValue(0, 'name'), 'two');
  assert.equal(remote.getValue(1, 'name'), 'other');
  remote.setValue(0, 'name', null);
  assert.equal(remote.pendingCellCount, 0);
  remote.disconnect();
  await remote.reconnect();
  assert.equal(remote.status, 'ready');
});
test('disconnect/resync and destroy reject stale load/ack generations and malformed receipts', async () => {
  let complete;
  const remote = fixture(
    async (request) =>
      new Promise((resolve) => {
        complete = () => resolve(accepted(request));
      }),
  );
  await remote.resync();
  remote.setValue(0, 'name', 'draft');
  const committing = remote.commit();
  await Promise.resolve();
  remote.disconnect();
  complete();
  await committing;
  assert.equal(remote.revision, '0');
  assert.equal(remote.getValue(0, 'name'), 'draft');
  const retry = remote.commit();
  await Promise.resolve();
  remote.destroy();
  complete();
  await retry;
  assert.equal(remote.status, 'destroyed');
  assert.throws(() => remote.getValue(0, 'name'));
  for (const patch of [
    { mutationId: 'wrong' },
    { snapshot: snapshot('0') },
    { snapshot: { ...snapshot('1'), datasetId: 'wrong' } },
  ]) {
    const invalid = fixture(async (request) => ({ ...accepted(request), ...patch }));
    await invalid.resync();
    invalid.setValue(0, 'name', 'draft');
    await assert.rejects(invalid.commit());
    assert.equal(invalid.status, 'disconnected');
    assert.equal(invalid.pendingCellCount, 1);
  }
});

test('remote JSON boundary rejects unsafe batches and snapshots nested mutations before retry', async () => {
  const requests = [];
  let attempts = 0;
  const remote = fixture(async (request) => {
    requests.push(request);
    if (++attempts === 1) throw Error('Lost ACK');
    return accepted(request);
  });
  await remote.resync();
  assert.throws(
    () =>
      remote.setValues([
        { rowIndex: 0, columnKey: 'name', value: 'safe' },
        { rowIndex: 1, columnKey: 'name', value: { bad: undefined } },
      ]),
    /JSON/,
  );
  assert.equal(remote.getValue(0, 'name'), 'old');
  assert.equal(remote.pendingCellCount, 0);
  const nested = { items: [{ label: 'original' }] };
  remote.setValue(0, 'name', nested);
  const first = remote.commit();
  nested.items[0].label = 'host mutation';
  await assert.rejects(first, /Lost ACK/);
  assert.equal(requests[0].changes[0].value.items[0].label, 'original');
  assert.equal(Object.isFrozen(requests[0].changes[0].value.items[0]), true);
  await remote.commit();
  assert.equal(requests[0], requests[1]);
  assert.equal(remote.getValue(0, 'name').items[0].label, 'original');
  const invalid = fixture(undefined, { load: async () => snapshot('0', Infinity) });
  await assert.rejects(invalid.resync(), /finite/);
  assert.equal(invalid.getRowCount(), 0);
  assert.ok(invalid.lastError instanceof Error);
});

test('disconnect before sending retains a committable draft without forced discard', async () => {
  const remote = fixture();
  await remote.resync();
  remote.setValue(0, 'name', 'offline draft');
  remote.disconnect();
  assert.throws(() => remote.reconnect(), /pending/);
  await remote.commit();
  assert.equal(remote.getValue(0, 'name'), 'offline draft');
  assert.equal(remote.pendingCellCount, 0);
  assert.equal(remote.status, 'ready');
});
