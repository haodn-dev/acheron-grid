import { createPagedRemoteDataSource } from '/core/index.js';
import { createGrid } from '/canvas/index.js';
const $ = (id) => document.getElementById(id);
async function request(path, body, signal) {
  const response = await fetch('/paged/api/' + path, {
    signal,
    ...(body === undefined
      ? {}
      : { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  });
  if (!response.ok) throw Error('HTTP ' + response.status);
  return response.json();
}
const source = createPagedRemoteDataSource({
  datasetId: 'paged-demo',
  columnKeys: ['title'],
  pageSize: 20,
  maxPages: 2,
  maxPendingCells: 100,
  createAbortController: () => new AbortController(),
  createMutationId: () => crypto.randomUUID(),
  load: ({ offset, limit, signal, query, expectedRevision }) =>
    request(
      'page?' +
        new URLSearchParams({
          offset,
          limit,
          query: JSON.stringify(query),
          ...(expectedRevision ? { revision: expectedRevision } : {}),
        }),
      undefined,
      signal,
    ),
  write: (mutation, signal, query) => request('write', { mutation, query }, signal),
});
let offset = 0,
  grid,
  busy = false;
function mount() {
  grid?.destroy();
  const start = offset;
  grid = createGrid({
    container: $('grid'),
    columns: [{ key: 'title', title: 'Task', editable: true }],
    dataSource: {
      getRowCount: () => Math.max(0, Math.min(20, source.getRowCount() - start)),
      getRowId: (index) => source.getRowId(start + index),
      getValue: (index, key) => source.getValue(start + index, key),
      setValue: (index, key, value) => source.setValue(start + index, key, value),
      setValues: (updates) =>
        source.setValues(updates.map((update) => ({ ...update, rowIndex: start + update.rowIndex }))),
    },
    onEvent: update,
  });
}
function update() {
  $('grid').inert = busy;
  $('grid').setAttribute('aria-busy', String(busy));
  $('status').textContent =
    `${source.status} · ${source.pendingCellCount} pending cells · revision ${source.revision ?? 'none'} · page ${offset / 20 + 1} · ${source.getRowCount()} records${source.lastError ? ' · ' + String(source.lastError) : ''}`;
  for (const id of ['previous', 'next', 'stage', 'save', 'reload', 'query', 'external', 'mode', 'accept'])
    $(id).disabled = busy;
  $('previous').disabled = busy || offset === 0;
  $('next').disabled = busy || offset + 20 >= source.getRowCount();
  $('stage').disabled = busy || source.status !== 'ready' || offset >= source.getRowCount();
  $('save').disabled = busy || !source.pendingCellCount || source.status === 'conflict';
  for (const id of ['query', 'reload']) $(id).disabled = busy || !!source.pendingCellCount;
  $('conflict').hidden = source.status !== 'conflict';
  if (source.conflict)
    $('review').textContent = JSON.stringify(
      { server: source.conflict.rows, draft: source.getPendingChanges() },
      null,
      2,
    );
}
async function run(operation) {
  busy = true;
  update();
  let failure;
  try {
    await operation();
  } catch (error) {
    failure = error;
  } finally {
    busy = false;
    update();
    if (failure) $('status').textContent += ' · ' + failure.message;
  }
}
async function page(next) {
  await source.loadPage(next);
  offset = next;
  mount();
}
$('previous').onclick = () => run(() => page(offset - 20));
$('next').onclick = () => run(() => page(offset + 20));
$('stage').onclick = () => {
  grid.updateCells([{ rowIndex: 0, columnKey: 'title', value: 'Updated task' }]);
  update();
};
$('save').onclick = () =>
  run(async () => {
    await source.commit();
    if (!source.pendingCellCount) {
      offset = Math.min(offset, Math.max(0, Math.ceil(source.getRowCount() / 20) - 1) * 20);
      await page(offset);
    }
  });
$('reload').onclick = () =>
  run(async () => {
    source.reset();
    await page(0);
  });
$('query').onclick = () =>
  run(async () => {
    source.setQuery({
      sort: { columnKey: 'title', direction: $('order').value },
      filters: [{ columnKey: 'title', operator: 'contains', query: $('search').value }],
    });
    await page(0);
  });
$('mode').onchange = () => run(() => request('control', { mode: $('mode').value }));
$('external').onclick = () => run(() => request('control', { mode: 'external' }));
$('accept').onclick = () =>
  run(async () => {
    source.acceptServer();
    await page(0);
  });
await run(() => page(0));
window.addEventListener('pagehide', () => {
  grid?.destroy();
  source.destroy();
});
