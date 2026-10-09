import test from 'node:test';
import assert from 'node:assert/strict';
import { createGridEngine, LocalDataSource } from '../dist/index.js';
import { createTsvWorker } from '../dist/worker.js';

function fixture() {
  const source = new LocalDataSource([{ value: 'old' }], (_, i) => i);
  const grid = createGridEngine({ dataSource: source, columns: [{ key: 'value', title: 'Value', editable: true }] });
  grid.select(0, 0);
  return { grid, source };
}
test('worker cleanup failures settle requests and still attempt every cleanup', async () => {
  for (const failed of ['abort', 'message', 'error', 'messageerror', 'terminate']) {
    const listeners = new Map();
    const cleaned = [];
    const cleanup = (name) => {
      cleaned.push(name);
      if (name === failed) throw Error('cleanup failed');
    };
    const client = createTsvWorker(() => ({
      postMessage: () => {},
      terminate: () => cleanup('terminate'),
      addEventListener: (type, listener) => listeners.set(type, listener),
      removeEventListener: (type) => cleanup(type),
    }));
    const promise = client.decodeTsv('a', { aborted: false, removeEventListener: () => cleanup('abort') });
    const rejected = assert.rejects(promise, /cleanup failed/);
    assert.doesNotThrow(() => listeners.get('message')({ data: { values: [['a']] } }));
    await rejected;
    assert.deepEqual(cleaned, ['abort', 'message', 'error', 'messageerror', 'terminate']);
    client.destroy();
  }
});
test('external TSV decoder output validates before mutation and preserves history on failure', async () => {
  for (const values of [
    undefined,
    [],
    [['a'], ['b', 'c']],
    [[1]],
    [Array(100001).fill('a')],
    [['x'.repeat(10000001)]],
  ]) {
    const { grid, source } = fixture();
    await assert.rejects(
      grid.pasteAsync('a', { yieldControl: async () => {}, tsvDecoder: { decodeTsv: async () => values } }),
    );
    assert.equal(source.getValue(0, 'value'), 'old');
    assert.equal(grid.canUndo(), false);
  }
  const { grid, source } = fixture();
  await grid.pasteAsync('new', { yieldControl: async () => {}, tsvDecoder: { decodeTsv: async () => [['new']] } });
  assert.equal(source.getValue(0, 'value'), 'new');
  grid.undo();
  assert.equal(source.getValue(0, 'value'), 'old');
});
test('worker wait retains mutation guard and captures revision before decoding', async () => {
  for (const end of ['revision', 'destroy', 'cancel', 'error']) {
    const { grid, source } = fixture();
    let resolve,
      reject,
      revision = '1';
    const controller = new AbortController();
    const promise = grid.pasteAsync('new', {
      yieldControl: async () => {},
      getRevision: () => revision,
      signal: controller.signal,
      tsvDecoder: {
        decodeTsv: () =>
          new Promise((yes, no) => {
            resolve = yes;
            reject = no;
          }),
      },
    });
    await Promise.resolve();
    await Promise.resolve();
    assert.throws(() => grid.updateCells([{ rowIndex: 0, columnKey: 'value', value: 'nested' }]));
    if (end === 'revision') revision = '2';
    if (end === 'destroy') grid.destroy();
    if (end === 'cancel') controller.abort();
    if (end === 'error') reject(new Error('worker failed'));
    else resolve([['new']]);
    await assert.rejects(promise);
    assert.equal(source.getValue(0, 'value'), 'old');
    if (end !== 'destroy') {
      assert.equal(grid.canUndo(), false);
      grid.paste('retry');
    }
  }
});
test('worker client terminates on success, abort, errors and destroy without leaking listeners', async () => {
  for (const end of ['success', 'abort', 'error', 'messageerror', 'destroy', 'malformed']) {
    const listeners = new Map();
    let terminated = 0;
    const controller = new AbortController();
    const client = createTsvWorker(() => ({
      postMessage: () => {},
      terminate: () => terminated++,
      addEventListener: (type, listener) => listeners.set(type, listener),
      removeEventListener: (type) => listeners.delete(type),
    }));
    const promise = client.decodeTsv('a', controller.signal);
    await assert.rejects(client.decodeTsv('second'), /busy/);
    if (end === 'success') listeners.get('message')({ data: { values: [['a']] } });
    else if (end === 'abort') controller.abort();
    else if (end === 'destroy') client.destroy();
    else if (end === 'malformed') listeners.get('message')({ data: null });
    else listeners.get(end)();
    if (end === 'success') assert.deepEqual(await promise, [['a']]);
    else await assert.rejects(promise);
    assert.equal(terminated, 1);
    assert.equal(listeners.size, 0);
    client.destroy();
    client.destroy();
    await assert.rejects(client.decodeTsv('a'), /destroyed/);
  }
});
test('worker creation failures and pre-aborted requests reject safely', async () => {
  let calls = 0;
  const client = createTsvWorker(() => {
    calls++;
    throw new Error('CSP');
  });
  await assert.rejects(client.decodeTsv('a', { aborted: true }), /canceled/);
  await assert.rejects(client.decodeTsv('x'.repeat(10000001)), /large/);
  assert.equal(calls, 0);
  await assert.rejects(client.decodeTsv('a'), /failed/);
  await assert.rejects(client.decodeTsv('b'), /failed/);
  assert.equal(calls, 2);
});
