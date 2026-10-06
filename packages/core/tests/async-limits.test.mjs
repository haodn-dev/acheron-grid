import test from 'node:test';
import assert from 'node:assert/strict';
import { setImmediate } from 'node:timers/promises';
import { createAsyncDataSource } from '@acheron-grid/core';

test('async loads bound concurrency, deduplicate queued pages and preflight range capacity', async () => {
  const requests = [];
  let active = 0,
    peak = 0;
  const source = createAsyncDataSource({
    pageSize: 1,
    maxPages: 5,
    maxConcurrentLoads: 2,
    maxPendingLoads: 3,
    createAbortController: () => new AbortController(),
    load: ({ offset }) =>
      new Promise((resolve, reject) => {
        peak = Math.max(peak, ++active);
        requests.push({
          offset,
          complete(error) {
            active--;
            if (error) reject(error);
            else resolve({ total: 5, rows: [{ value: offset }] });
          },
        });
      }),
  });
  const a = source.loadPage(0),
    b = source.loadPage(1),
    queued = source.loadPage(2);
  assert.equal(source.loadPage(2), queued);
  await setImmediate();
  assert.deepEqual(
    requests.map((request) => request.offset),
    [0, 1],
  );
  assert.throws(() => source.loadPage(3), /pending load limit/);
  assert.throws(() => source.loadRange(2, 4), /pending load limit/);
  assert.equal(source.getPageState(3), null);
  requests[0].complete();
  await a;
  await setImmediate();
  assert.deepEqual(
    requests.map((request) => request.offset),
    [0, 1, 2],
  );
  requests[1].complete(new Error('offline'));
  await assert.rejects(b, /offline/);
  requests[2].complete();
  await queued;
  assert.equal(peak, 2);
  assert.equal(source.getValue(2, 'value'), 2);
  const retry = source.loadPage(1);
  await setImmediate();
  requests[3].complete();
  await retry;
  assert.equal(source.getPageState(1).status, 'ready');
  source.destroy();
});

test('cancel settles queued work and keeps unresolved old loaders within the global limit after reset', async () => {
  const requests = [];
  const source = createAsyncDataSource({
    pageSize: 1,
    maxConcurrentLoads: 1,
    createAbortController: () => new AbortController(),
    load: ({ offset, signal }) => new Promise((resolve) => requests.push({ offset, signal, resolve })),
  });
  const old = source.loadPage(0),
    queued = source.loadPage(1);
  await setImmediate();
  source.reset();
  await queued;
  assert.equal(requests[0].signal.aborted, true);
  assert.equal(source.getPageState(1), null);
  const fresh = source.loadPage(0);
  await setImmediate();
  assert.equal(requests.length, 1);
  requests[0].resolve({ total: 1, rows: [{ value: 'stale' }] });
  await old;
  await setImmediate();
  assert.equal(requests.length, 2);
  assert.equal(source.getRowCount(), 0);
  requests[1].resolve({ total: 1, rows: [{ value: 'fresh' }] });
  await fresh;
  assert.equal(source.getValue(0, 'value'), 'fresh');
  source.destroy();
});

test('async limits validate dimensions and observer cancellation prevents queued loader calls', async () => {
  for (const key of ['maxConcurrentLoads', 'maxPendingLoads'])
    for (const value of [0, -1, 1.5, Infinity]) {
      assert.throws(
        () =>
          createAsyncDataSource({
            [key]: value,
            createAbortController: () => new AbortController(),
            load: async () => ({ total: 0, rows: [] }),
          }),
        RangeError,
      );
    }
  let calls = 0;
  const source = createAsyncDataSource({
    createAbortController: () => new AbortController(),
    load: async () => {
      calls++;
      return { total: 0, rows: [] };
    },
  });
  source.subscribe((state) => {
    if (state.status === 'loading') source.cancel();
  });
  await source.loadPage(0);
  assert.equal(calls, 0);
  source.destroy();
});
