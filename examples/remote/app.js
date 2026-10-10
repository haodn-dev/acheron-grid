import { createRemoteDataSource } from '/core/index.js';
import { createGrid } from '/canvas/index.js';
const $ = (id) => document.getElementById(id);
async function request(path, body, signal) {
  const response = await fetch('/remote/api/' + path, {
    signal,
    ...(body === undefined
      ? {}
      : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  });
  if (!response.ok) throw Error('HTTP ' + response.status);
  return response.json();
}
const remote = createRemoteDataSource({
  datasetId: 'demo',
  columnKeys: ['title'],
  createAbortController: () => new AbortController(),
  createMutationId: () => crypto.randomUUID(),
  load: (signal) => request('snapshot', undefined, signal),
  write: (mutation, signal) => request('write', mutation, signal),
});
let grid,
  operationPending = false;
function update() {
  const error = remote.lastError;
  $('status').textContent =
    `${remote.status} · ${remote.pendingCellCount} pending cells · revision ${remote.revision ?? 'none'}${error ? ' · ' + (error instanceof Error ? error.message : String(error)) : ''}`;
  const busy = operationPending || ['loading', 'committing', 'destroyed'].includes(remote.status);
  $('stage').disabled = busy || remote.status !== 'ready';
  $('save').disabled = busy || remote.status === 'conflict' || !remote.pendingCellCount;
  $('reload').disabled = busy || !!remote.pendingCellCount;
  $('external').disabled = busy;
  $('mode').disabled = busy;
  $('conflict').hidden = remote.status !== 'conflict';
  if (remote.conflict)
    $('review').textContent = JSON.stringify(
      { server: remote.conflict.rows, myDraft: remote.getPendingChanges() },
      null,
      2,
    );
  grid?.render();
}
remote.subscribe(update);
async function run(operation) {
  operationPending = true;
  update();
  let failure;
  try {
    await operation();
  } catch (error) {
    failure = error;
  } finally {
    operationPending = false;
    update();
    if (failure) $('status').textContent += ' · ' + failure.message;
  }
}
await run(async () => {
  await remote.resync();
  grid = createGrid({
    container: $('grid'),
    columns: [
      {
        key: 'title',
        title: 'Task',
        editable: true,
        validate: (value) => {
          if (typeof value !== 'string' || !value.trim() || value.length > 200)
            throw Error('Use a title of 1–200 characters');
        },
      },
    ],
    dataSource: remote,
    resolveCellPermission: () => ({ writable: remote.status === 'ready' }),
  });
});
$('edit').addEventListener('submit', (event) => {
  event.preventDefault();
  run(() => grid.updateCells([{ rowIndex: 0, columnKey: 'title', value: $('draft').value }]));
});
$('save').addEventListener('click', () =>
  run(async () => {
    const ids = grid.captureRowIdentity();
    await remote.commit();
    if (remote.status === 'ready' && !remote.pendingCellCount) grid.refreshData(ids);
  }),
);
$('reload').addEventListener('click', () =>
  run(async () => {
    const ids = grid.captureRowIdentity();
    await remote.reconnect();
    grid.refreshData(ids);
  }),
);
$('mode').addEventListener('change', () => run(() => request('control', { mode: $('mode').value })));
$('external').addEventListener('click', () => run(() => request('control', { external: true })));
function resolve(keep) {
  const pending = remote.getPendingChanges(),
    ids = grid.captureRowIdentity();
  remote.acceptServer();
  grid.refreshData(ids);
  if (keep) {
    const updates = pending.map((change) => {
      const rowIndex = Array.from({ length: remote.getRowCount() }, (_, i) => i).find((i) =>
        Object.is(remote.getRowId(i), change.rowId),
      );
      if (rowIndex === undefined) throw Error('Draft row no longer exists');
      return { rowIndex, columnKey: change.columnKey, value: change.value };
    });
    grid.updateCells(updates);
  }
  update();
}
$('server').addEventListener('click', () => run(() => resolve(false)));
$('mine').addEventListener('click', () => run(() => resolve(true)));
addEventListener(
  'pagehide',
  () => {
    grid?.destroy();
    remote.destroy();
  },
  { once: true },
);
