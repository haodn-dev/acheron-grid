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
