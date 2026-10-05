import test from 'node:test';
import assert from 'node:assert/strict';
import { createRemoteSaveExample } from '../../../examples/remote-save.mjs';

function session(save) {
  let id = 0;
  return createRemoteSaveExample({ datasetId: 'people', revision: 0, rows: [{ id: 'a', name: 'old' }, { id: 'b', name: 'other' }], createRequestId: () => `request-${++id}`, save });
}
const receipt = (request, status = 'saved') => ({ requestId: request.requestId, datasetId: request.datasetId, status, revision: request.expectedRevision + 1 });

test('acknowledgment preserves newer edits and undo creates a new unsaved draft', async () => {
  let complete, request;
  const client = session(value => { request = value; return new Promise(resolve => { complete = resolve; }); });
  client.engine.editCell(0, 0, 'first');
  const saving = client.save();
  await assert.rejects(client.save(), /already running/);
  client.engine.editCell(0, 0, 'second');
  complete(receipt(request)); await saving;
  assert.equal(client.engine.getValue(0, 'name'), 'second');
  assert.deepEqual(client.getDrafts(), [{ rowId: 'a', columnKey: 'name', previous: 'first', value: 'second' }]);
  client.engine.undo(); assert.equal(client.status, 'clean');
  client.engine.undo(); assert.equal(client.status, 'dirty');
  client.destroy();
});

test('server rejection and local validation preserve drafts; rollback uses permissions and history', async () => {
  for (const status of ['validation', 'conflict']) {
    const client = session(async request => receipt(request, status));
    assert.throws(() => client.engine.updateCells([{ rowIndex: 0, columnKey: 'name', value: 'good' }, { rowIndex: 1, columnKey: 'name', value: 5 }]), /Name must/);
    assert.equal(client.status, 'clean');
    client.engine.editCell(0, 0, 'draft');
    assert.equal((await client.save()).status, status);
    assert.equal(client.status, 'dirty'); assert.equal(client.revision, 0);
    client.engine.setLocked({ scope: 'table' }, true);
    assert.throws(() => client.discardDrafts());
    assert.equal(client.engine.getValue(0, 'name'), 'draft');
    client.engine.setLocked({ scope: 'table' }, false);
    client.engine.setView({ filters: [{ columnKey: 'name', query: 'other' }] });
    assert.throws(() => client.discardDrafts(), /hidden drafts/);
    assert.equal(client.getDrafts().length, 1);
    client.engine.setView({});
    client.discardDrafts(); assert.equal(client.status, 'clean');
    client.engine.undo(); assert.equal(client.status, 'dirty');
    client.destroy();
  }
});

test('lost acknowledgment retries the exact idempotent batch before sending newer drafts', async () => {
  const committed = new Map(), requests = [];
  let serverRevision = 0;
  const client = session(async request => {
    requests.push(request);
    if (committed.has(request.requestId)) return committed.get(request.requestId);
    assert.equal(request.expectedRevision, serverRevision);
    serverRevision++;
    const result = receipt(request); committed.set(request.requestId, result);
    if (serverRevision === 1) throw new Error('Connection lost after commit');
    return result;
  });
  client.engine.editCell(0, 0, 'first');
  await assert.rejects(client.save(), /Connection lost/);
  assert.equal(client.status, 'uncertain');
  assert.throws(() => client.discardDrafts(), /pending server outcome/);
  client.engine.editCell(0, 0, 'second');
  await client.save(); assert.equal(requests[1], requests[0]);
  assert.equal(client.status, 'dirty'); assert.equal(serverRevision, 1);
  await client.save(); assert.equal(serverRevision, 2); assert.equal(client.status, 'clean');
  assert.equal((await client.save()).status, 'unchanged');
  client.destroy();
});

test('invalid receipts stay uncertain and destroy ignores late acknowledgments', async () => {
  for (const patch of [{ revision: 99 }, { datasetId: 'other' }, { requestId: 'other' }, { status: 'partial' }]) {
    const invalid = session(async request => ({ ...receipt(request), ...patch }));
    invalid.engine.editCell(0, 0, 'draft'); await assert.rejects(invalid.save(), /Invalid save receipt/);
    assert.equal(invalid.status, 'uncertain'); assert.equal(invalid.revision, 0); invalid.destroy();
  }
  let complete;
  const client = session(request => new Promise(resolve => { complete = () => resolve(receipt(request)); }));
  client.engine.editCell(0, 0, 'draft'); const saving = client.save();
  client.destroy(); complete(); await assert.rejects(saving, /session closed/);
  assert.equal(client.revision, 0); await assert.rejects(client.save(), /destroyed/);
});
