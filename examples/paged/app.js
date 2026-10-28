import { createPagedRemoteDataSource } from '/core/index.js';
import { createGrid } from '/canvas/index.js';
import { request } from './transport.js';
const $ = (id) => document.getElementById(id);
const journalKey = 'acheron-paged-mutation-v1';
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
  persistMutation: (checkpoint) => localStorage.setItem(journalKey, JSON.stringify(checkpoint)),
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
    resolveCellPermission: () => ({ writable: source.status === 'ready' }),
  });
}
function update() {
  $('grid').inert = busy;
  $('grid').setAttribute('aria-busy', String(busy));
  $('status').textContent =
    `${source.status} · ${source.pendingCellCount} pending cells · revision ${source.revision ?? 'none'} · page ${offset / 20 + 1} · ${source.getRowCount()} records${source.lastError ? ' · ' + String(source.lastError) : ''}`;
  for (const id of [
    'previous',
    'next',
    'stage',
    'save',
    'reload',
    'query',
    'external',
    'mode',
    'accept',
    'checkpoint',
    'restore',
  ])
    $(id).disabled = busy;
  $('previous').disabled = busy || source.status !== 'ready' || offset === 0;
  $('next').disabled = busy || source.status !== 'ready' || offset + 20 >= source.getRowCount();
  $('stage').disabled = busy || source.status !== 'ready' || offset >= source.getRowCount();
  $('save').disabled = busy || !source.pendingCellCount || source.status === 'conflict';
  $('checkpoint').disabled = busy || source.status !== 'ready';
  $('restore').disabled = busy || source.status !== 'ready' || !!source.pendingCellCount;
  for (const id of ['query', 'reload']) $(id).disabled = busy || !!source.pendingCellCount;
  $('query').disabled ||= !grid;
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
$('checkpoint').onclick = () =>
  run(() => localStorage.setItem('acheron-paged-draft-v1', JSON.stringify(source.exportDrafts())));
$('restore').onclick = () =>
  run(async () => {
    const saved = localStorage.getItem('acheron-paged-draft-v1');
    if (saved === null) throw Error('No saved draft.');
    await source.restoreDrafts(JSON.parse(saved));
    await page(0);
  });
$('save').onclick = () =>
  run(async () => {
    await source.commit();
    if (!source.pendingCellCount) {
      localStorage.removeItem('acheron-paged-draft-v1');
      offset = Math.min(offset, Math.max(0, Math.ceil(source.getRowCount() / 20) - 1) * 20);
      await page(offset);
    } else if (source.status === 'ready') await page(offset);
    if (source.status === 'ready') localStorage.removeItem(journalKey);
  });
$('reload').onclick = () =>
  run(async () => {
    if (!grid) {
      await initialize();
      return;
    }
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
    localStorage.removeItem(journalKey);
  });
async function initialize() {
  const stored = localStorage.getItem(journalKey);
  if (stored === null) {
    await page(0);
    return;
  }
  const checkpoint = JSON.parse(stored);
  source.setQuery(checkpoint.query);
  source.restoreMutation(checkpoint);
  offset = Math.floor(checkpoint.positions[0].rowIndex / source.pageSize) * source.pageSize;
  $('order').value = source.query.sort?.direction ?? 'asc';
  $('search').value = source.query.filters?.[0]?.query ?? '';
  mount();
}
await run(initialize);
window.addEventListener('pagehide', (event) => {
  if (!event.persisted) {
    grid?.destroy();
    source.destroy();
  }
});
