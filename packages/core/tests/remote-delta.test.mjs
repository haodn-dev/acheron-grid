import test from 'node:test';
import assert from 'node:assert/strict';
import { createRemoteDataSource } from '../dist/index.js';

const initial = () => ({
  datasetId: 'tasks',
  revision: '1',
  rows: Array.from({ length: 10000 }, (_, id) => ({ id, values: { title: String(id), status: 'todo' } })),
});
function fixture(write, extra = {}) {
  return createRemoteDataSource({
    datasetId: 'tasks',
    columnKeys: ['title', 'status'],
    createAbortController: () => new AbortController(),
    createMutationId: () => 'write-1',
    load: async () => initial(),
    write,
    ...extra,
  });
}
const receipt = (mutation) => ({
  mutationId: mutation.mutationId,
  status: 'accepted',
  delta: {
    datasetId: 'tasks',
    baseRevision: '1',
    revision: '2',
    cells: [{ rowId: 2, columnKey: 'title', value: 'Canonical title' }],
  },
});

test('delta acknowledges canonical cells and server effects without fetching or replacing unrelated rows', async () => {
  let loads = 0;
  const remote = fixture(
    async (mutation) => {
      assert.equal(mutation.changes.length, 1);
      const result = receipt(mutation);
      result.delta.cells.push({ rowId: 8, columnKey: 'status', value: 'done' });
      assert.ok(JSON.stringify(result).length < 400);
      return result;
    },
    {
      load: async () => {
        loads++;
        return initial();
      },
    },
  );
  await remote.resync();
  remote.setValue(2, 'title', 'Draft');
  await remote.commit();
  assert.equal(loads, 1);
  assert.equal(remote.getRowCount(), 10000);
  assert.equal(remote.getValue(2, 'title'), 'Canonical title');
  assert.equal(remote.getValue(8, 'status'), 'done');
  assert.equal(remote.getValue(9999, 'title'), '9999');
  assert.equal(remote.pendingCellCount, 0);
  assert.equal(remote.revision, '2');
  remote.destroy();
});

test('invalid deltas retain the draft and revision atomically', async () => {
  const corruptions = [
    (delta) => {
      delta.baseRevision = 'stale';
    },
    (delta) => {
      delta.datasetId = 'another';
    },
    (delta) => {
      delta.revision = '1';
    },
    (delta) => {
      delta.cells = [];
    },
    (delta) => {
      delta.cells.push({ ...delta.cells[0] });
    },
    (delta) => {
      delta.cells.push({ rowId: 'missing', columnKey: 'status', value: 'done' });
    },
    (delta) => {
      delta.cells.push({ rowId: 8, columnKey: 'private', value: 'secret' });
    },
    (delta) => {
      delta.cells.push({ rowId: 8, columnKey: 'status', value: NaN });
    },
    (delta) => {
      delete delta.cells[0].value;
    },
  ];
  for (const corrupt of corruptions) {
    const remote = fixture(async (mutation) => {
      const result = receipt(mutation);
      corrupt(result.delta);
      return result;
    });
    await remote.resync();
    remote.setValue(2, 'title', 'Draft');
    await assert.rejects(remote.commit());
    assert.equal(remote.status, 'disconnected');
    assert.equal(remote.revision, '1');
    assert.equal(remote.pendingCellCount, 1);
    assert.equal(remote.getValue(2, 'title'), 'Draft');
    assert.equal(remote.getValue(8, 'status'), 'todo');
    remote.destroy();
  }
});

test('uncertain delta commit retries the identical immutable mutation', async () => {
  const requests = [];
  const remote = fixture(async (mutation) => {
    requests.push(mutation);
    if (requests.length === 1) throw new Error('Lost receipt');
    return receipt(mutation);
  });
  await remote.resync();
  remote.setValue(2, 'title', 'Draft');
  await assert.rejects(remote.commit(), /Lost receipt/);
  await remote.commit();
  assert.equal(requests[0], requests[1]);
  assert.ok(Object.isFrozen(requests[0].changes));
  assert.equal(remote.revision, '2');
  assert.equal(remote.getValue(2, 'title'), 'Canonical title');
  remote.destroy();
});
