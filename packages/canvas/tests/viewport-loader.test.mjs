import test from 'node:test';
import assert from 'node:assert/strict';
import { createGridEngine, createPagedRemoteDataSource } from '../../core/dist/index.js';
import { createViewportLoader } from '../../../examples/paged/viewport-loader.js';

const view = (...ranges) => ({ regions: ranges.map(([start, end]) => ({ rows: { start, end } })) });
async function idle(loader) {
  for (let i = 0; i < 100 && loader.getState().loading; i++) await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(loader.getState().loading, false);
}
function fixture({ load, maxPages = 3 } = {}) {
  const requests = [],
    windows = [],
    ids = [],
    states = [];
  let active = 0,
    peak = 0,
    guard = false;
  const source = createPagedRemoteDataSource({
    datasetId: 'window',
    columnKeys: ['title'],
    rowCount: 1000000,
    pageSize: 10,
    maxPages,
    createAbortController: () => new AbortController(),
    createMutationId: () => 'unused',
    load: async ({ offset, limit, signal }) => {
      requests.push(offset);
      peak = Math.max(peak, ++active);
      try {
        await load?.(offset, signal);
        return {
          datasetId: 'window',
          revision: 'r1',
          total: 1000000,
          rows: Array.from({ length: limit }, (_, i) => ({ id: offset + i, values: { title: `Task ${offset + i}` } })),
        };
      } finally {
        active--;
      }
    },
    write: async () => {
      throw Error('Unexpected write');
    },
  });
  const engine = createGridEngine({
    dataSource: {
      ...source,
      getRowId: (row) => {
        ids.push(row);
        return source.getRowId(row);
      },
    },
    columns: [{ key: 'title', title: 'Task', editable: true }],
  });
  const loader = createViewportLoader({
    source,
    maxPages,
    grid: {
      refreshRows(start, end) {
        if (guard) throw Error('Editor is open');
        windows.push([start, end]);
        return engine.refreshRows(start, end);
      },
    },
    onState: (state) => states.push(state),
  });
  return {
    source,
    engine,
    loader,
    requests,
    windows,
    ids,
    states,
    get peak() {
      return peak;
    },
    setGuard: (value) => {
      guard = value;
    },
    dispose() {
      loader.dispose();
      engine.destroy();
      source.destroy();
    },
  };
}

test('viewport loader refreshes separate evicted windows and retains verified dirty IDs/history', async () => {
  const f = fixture();
  try {
    f.loader.setViewport(view([0, 1]));
    await idle(f.loader);
    f.engine.updateCells([{ rowIndex: 0, columnKey: 'title', value: 'Draft' }]);
    f.ids.length = 0;
    f.windows.length = 0;
    f.loader.setViewport(view([500000, 500001]));
    await idle(f.loader);
    assert.equal(f.source.pendingCellCount, 1);
    assert.equal(f.engine.getValue(0, 'title'), 'Draft');
    assert(f.windows.some(([start]) => start === 0));
    assert(f.windows.every(([start, end]) => end - start === 9));
    assert.equal(f.ids.length, f.windows.length * 10);
    assert(f.loader.getState().cachedPages <= 3);
    f.loader.setViewport(view([0, 1]));
    await idle(f.loader);
    assert.equal(f.engine.undo(), true);
    assert.equal(f.engine.getValue(0, 'title'), 'Task 0');
    assert.equal(f.engine.redo(), true);
    assert.equal(f.source.pendingCellCount, 1);
    assert.equal(f.peak, 1);
    assert(f.requests.length < 12);
    const reads = f.ids.length,
      requests = f.requests.length;
    f.engine.selectRange({ startRow: 0, endRow: 999999, startColumn: 0, endColumn: 0 });
    assert.throws(() => f.engine.copySelection(), /too many cells/);
    assert(f.ids.length - reads < 10);
    assert.equal(f.requests.length, requests);
  } finally {
    f.dispose();
  }
});

test('rapid viewport updates deduplicate requests and prefer the latest window after the in-flight page', async () => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const f = fixture({ load: (offset) => (offset === 0 ? gate : undefined) });
  try {
    f.loader.setViewport(view([0, 1]));
    await new Promise((resolve) => setTimeout(resolve, 0));
    for (let i = 1; i <= 50; i++) f.loader.setViewport(view([i * 1000, i * 1000 + 1]));
    assert.deepEqual(f.requests, [0]);
    release();
    await idle(f.loader);
    assert.deepEqual(f.requests, [0, 50000, 49990, 50010]);
    for (let i = 0; i < 50; i++) f.loader.setViewport(view([50000, 50001]));
    await idle(f.loader);
    assert.equal(f.requests.length, 4);
    assert.equal(f.peak, 1);
  } finally {
    release();
    f.dispose();
  }
});

test('refresh rejection pauses loading with bounded pending windows until explicit retry', async () => {
  const f = fixture();
  try {
    f.setGuard(true);
    f.loader.setViewport(view([0, 1]));
    await idle(f.loader);
    assert.equal(f.loader.getState().blocked, true);
    assert.equal(f.loader.getState().queuedWindows, 1);
    for (let i = 0; i < 50; i++) f.loader.setViewport(view([500000, 500001]));
    assert.deepEqual(f.requests, [0]);
    f.setGuard(false);
    f.loader.retry();
    await idle(f.loader);
    assert.equal(f.loader.getState().blocked, false);
    assert.equal(f.loader.getState().queuedWindows, 0);
    assert(f.requests.includes(500000));
  } finally {
    f.dispose();
  }
});

test('load errors wait for retry, cache budgets reject oversized windows and dispose ignores late completion', async () => {
  let reject = true,
    release;
  const f = fixture({
    load: (offset) => {
      if (offset === 0 && reject) throw Error('Offline');
    },
  });
  try {
    f.loader.setViewport(view([0, 1]));
    await idle(f.loader);
    for (let i = 0; i < 20; i++) f.loader.setViewport(view([0, 1]));
    await idle(f.loader);
    assert.equal(f.requests.filter((offset) => offset === 0).length, 1);
    assert.match(f.loader.getState().error, /Offline/);
    reject = false;
    f.loader.retry();
    await idle(f.loader);
    assert.equal(f.source.getPageState(0).status, 'ready');
    f.loader.setViewport(view([0, 1000000]));
    assert.match(f.loader.getState().error, /cache budget/);
    f.loader.retry();
    assert.match(f.loader.getState().error, /cache budget/);
  } finally {
    f.dispose();
  }
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const late = fixture({ load: () => gate });
  late.loader.setViewport(view([0, 1]));
  await new Promise((resolve) => setTimeout(resolve, 0));
  const notices = late.states.length;
  late.dispose();
  release();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(late.states.length, notices);
  assert.deepEqual(late.windows, []);
});

test('pause retains deferred eviction windows and touching the edited ready page protects it from one incoming page', async () => {
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const f = fixture({ maxPages: 2, load: (offset) => (offset === 20 ? gate : undefined) });
  let loader,
    editorOpen = false;
  const windows = [];
  try {
    await f.source.loadPage(0);
    f.loader.dispose();
    loader = createViewportLoader({
      source: f.source,
      maxPages: 2,
      grid: {
        refreshRows(start, end) {
          assert.equal(editorOpen, false);
          windows.push([start, end]);
          return f.engine.refreshRows(start, end);
        },
      },
    });
    loader.setViewport(view([0, 1]));
    await idle(loader);
    assert.equal(loader.getState().cachedPages, 2);
    loader.setViewport(view([20, 21]));
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(f.requests.at(-1), 20);
    loader.setViewport(view([0, 1]));
    editorOpen = true;
    loader.pause();
    await f.source.loadPage(0);
    const before = windows.length;
    release();
    await idle(loader);
    assert.equal(f.source.getPageState(0).status, 'ready');
    assert.equal(f.source.getValue(0, 'title'), 'Task 0');
    assert.equal(loader.getState().paused, true);
    assert.equal(loader.getState().blocked, false);
    assert.equal(loader.getState().queuedWindows, 2);
    assert.equal(windows.length, before);
    f.engine.updateCells([{ rowIndex: 0, columnKey: 'title', value: 'Committed editor' }]);
    editorOpen = false;
    loader.resume();
    await idle(loader);
    assert.equal(loader.getState().queuedWindows, 0);
    assert.equal(f.engine.getValue(0, 'title'), 'Committed editor');
    assert.equal(f.engine.undo(), true);
    assert.equal(f.source.getValue(0, 'title'), 'Task 0');
  } finally {
    release();
    loader?.dispose();
    f.dispose();
  }
});

test('resume does not automatically retry an already failed page', async () => {
  let fail = true;
  const f = fixture({
    load: (offset) => {
      if (offset === 0 && fail) throw Error('Offline');
    },
  });
  try {
    f.loader.setViewport(view([0, 1]));
    await idle(f.loader);
    f.loader.pause();
    f.loader.resume();
    await idle(f.loader);
    assert.equal(f.requests.filter((offset) => offset === 0).length, 1);
    assert.match(f.loader.getState().error, /Offline/);
    fail = false;
    f.loader.retry();
    await idle(f.loader);
    assert.equal(f.source.getPageState(0).status, 'ready');
  } finally {
    f.dispose();
  }
});
