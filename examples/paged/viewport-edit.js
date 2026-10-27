import { createPagedRemoteDataSource } from '/core/index.js';
import { createGrid } from '/canvas/index.js';
import { createViewportLoader } from './viewport-loader.js';
import { request } from './transport.js';

const $ = (id) => document.getElementById(id);
const journalKey = 'acheron-viewport-edit-mutation-v1';
const draftKey = 'acheron-viewport-edit-draft-v1';
const maxPages = 8;
let loader,
  busy = false,
  editing = false,
  recoveryBlocked = true,
  disposed = false,
  message = '';
const source = createPagedRemoteDataSource({
  datasetId: 'paged-demo',
  columnKeys: ['title'],
  pageSize: 20,
  maxPages,
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
  persistMutation: (checkpoint) => {
    const body = JSON.stringify({ mutation: checkpoint.writer.mutation, query: checkpoint.query });
    if (new TextEncoder().encode(body).byteLength > 16384)
      throw new Error('The demo request exceeds 16 KiB. Reduce staged edits before saving.');
    localStorage.setItem(journalKey, JSON.stringify(checkpoint));
  },
});
const grid = createGrid({
  container: $('grid'),
  dataSource: { ...source, getValue: (row, key) => source.getValue(row, key) ?? 'Not loaded' },
  columns: [
    {
      key: 'title',
      title: 'Task',
      editable: true,
      validate: (value) =>
        typeof value === 'string' && value.trim() && value.length <= 200
          ? undefined
          : 'Enter nonempty text up to 200 characters.',
    },
  ],
  columnWidth: 360,
  accessibility: 'viewport',
  allowSearch: false,
  viewMode: 'host',
  permissions: { formatting: false },
  allowColumnChanges: false,
  allowMerging: false,
  allowRowGrouping: false,
  allowLockChanges: false,
  canChangeLayout: () => false,
  canChangeVisibility: () => false,
  canChangeStructure: () => false,
  getCellLabel: (_row, _key, value) => String(value),
  resolveCellPermission: ({ rowIndex }) => {
    const loaded = source.getPageState(Math.floor(rowIndex / source.pageSize) * source.pageSize)?.status === 'ready';
    return {
      writable: loaded && !busy && source.status === 'ready',
      pasteable: loaded && !busy && source.status === 'ready',
      copyable: loaded,
    };
  },
  onViewportChange: (view) => loader?.setViewport(view),
  onEvent: (event) => {
    if (event.type === 'cell:change') message = '';
    if (event.type === 'data:rows' && event.droppedHistoryEntries)
      message = `${event.droppedHistoryEntries} local history entries were cleared after row identities changed.`;
    update();
  },
  onEditorMount: ({ rowIndex }) => {
    const editorLoader = loader;
    editing = true;
    editorLoader.pause();
    // With cache > 1 and one incoming page, a ready-page LRU touch protects the active editor.
    void source.loadPage(Math.floor(rowIndex / source.pageSize) * source.pageSize).catch((error) => {
      message = error.message;
      update();
    });
    update();
    return () => {
      editing = false;
      queueMicrotask(() => {
        if (!disposed && !editing && !busy && !recoveryBlocked && source.status === 'ready') editorLoader.resume();
        update();
      });
    };
  },
});

function stopLoader() {
  loader?.dispose();
  loader = undefined;
}
function startLoader() {
  stopLoader();
  if (disposed || source.status !== 'ready') return;
  loader = createViewportLoader({ source, grid, maxPages, onState: update });
  if (busy || editing) loader.pause();
  loader.setViewport(grid.getViewport());
}
function update() {
  if (disposed) return;
  const ready = source.status === 'ready',
    pending = source.pendingCellCount;
  const state = loader?.getState();
  $('grid').inert = busy || recoveryBlocked || !ready;
  $('grid').setAttribute('aria-busy', String(busy));
  $('status').textContent =
    `${editing ? 'Editing' : busy ? 'Working' : state?.loading ? 'Loading pages' : source.status} · ${source.getRowCount()} records · ${pending} pending cells · revision ${source.revision ?? 'none'} · ${state?.cachedPages ?? 0} tracked cached pages / ${maxPages} budget${editing && state?.queuedWindows ? ' · New pages will appear after editing finishes.' : ''}${state?.error ? ' · ' + state.error : ''}${source.lastError ? ' · ' + source.lastError : ''}${message ? ' · ' + message : ''}`;
  for (const id of [
    'save',
    'reload',
    'retry',
    'query',
    'search',
    'order',
    'mode',
    'external',
    'checkpoint',
    'restore',
    'discard',
    'accept',
  ])
    $(id).disabled = busy || editing || recoveryBlocked;
  $('save').disabled ||= !pending || source.status === 'conflict';
  for (const id of ['reload', 'query', 'search', 'order']) $(id).disabled ||= !ready || !!pending;
  $('retry').disabled ||= !ready || !state?.error;
  $('checkpoint').disabled ||= !ready || source.revision === null;
  $('restore').disabled ||= !ready || !!pending;
  $('discard').disabled ||= !ready || !pending;
  $('external').disabled ||= !ready;
  $('accept').disabled ||= source.status !== 'conflict';
  $('recovery').hidden = !recoveryBlocked;
  $('recover').disabled = busy;
  $('conflict').hidden = source.status !== 'conflict';
  if (source.conflict)
    $('review').textContent = JSON.stringify(
      { server: source.conflict.rows, draft: source.getPendingChanges() },
      null,
      2,
    );
  $('drafts').hidden = !pending;
  $('changes').textContent = pending ? JSON.stringify(source.getPendingChanges(), null, 2) : '';
}
async function run(operation) {
  if (busy || editing || disposed) return;
  busy = true;
  message = '';
  loader?.pause();
  update();
  try {
    await operation();
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  } finally {
    busy = false;
    if (!disposed && !recoveryBlocked && source.status === 'ready') loader?.resume();
    update();
  }
}
async function loadQuery(query) {
  stopLoader();
  source.setQuery(query);
  grid.resetData();
  await source.loadPage(0);
  if (disposed) return;
  grid.resetData();
  startLoader();
}
function syncQueryInputs() {
  $('order').value = source.query.sort?.direction ?? 'asc';
  $('search').value = source.query.filters?.[0]?.query ?? '';
}
async function initialize() {
  recoveryBlocked = true;
  const stored = localStorage.getItem(journalKey);
  if (stored === null) {
    recoveryBlocked = false;
    await loadQuery({});
  } else {
    const checkpoint = JSON.parse(stored);
    stopLoader();
    source.setQuery(checkpoint.query);
    source.restoreMutation(checkpoint);
    grid.resetData();
    recoveryBlocked = false;
    syncQueryInputs();
    message = 'Recovered a pending request. Choose Save / retry; no write or old-revision page was requested.';
  }
}
$('recover').onclick = () => void run(initialize);
$('reload').onclick = () => void run(() => loadQuery(source.query));
$('retry').onclick = () => loader?.retry();
$('query-form').onsubmit = (event) => {
  event.preventDefault();
  if ($('query').disabled) return;
  void run(() =>
    loadQuery({
      sort: { columnKey: 'title', direction: $('order').value },
      filters: [{ columnKey: 'title', operator: 'contains', query: $('search').value }],
    }),
  );
};
$('save').onclick = () =>
  void run(async () => {
    if (source.status === 'ready') {
      // Size the fixed demo envelope before the source freezes its real UUID/request.
      const preview = {
        mutation: {
          datasetId: 'paged-demo',
          mutationId: '0'.repeat(36),
          expectedRevision: source.revision,
          changes: source.getPendingChanges(),
        },
        query: source.query,
      };
      if (new TextEncoder().encode(JSON.stringify(preview)).byteLength > 16384)
        throw new Error('The demo request exceeds 16 KiB. Reduce staged edits before saving.');
    }
    stopLoader();
    let failure;
    try {
      await source.commit();
    } catch (error) {
      failure = error;
    }
    if (disposed) return;
    // Read writer status after await; page notices do not report write settlement.
    if (source.status === 'ready') {
      grid.resetData();
      if (!source.pendingCellCount) {
        await loadQuery(source.query);
        localStorage.removeItem(draftKey);
      } else startLoader();
      localStorage.removeItem(journalKey);
    }
    if (failure) throw failure;
  });
$('accept').onclick = () =>
  void run(async () => {
    stopLoader();
    source.acceptServer();
    grid.resetData();
    await loadQuery(source.query);
    localStorage.removeItem(journalKey);
    localStorage.removeItem(draftKey);
  });
$('discard').onclick = () =>
  void run(async () => {
    stopLoader();
    source.discardPending();
    grid.resetData();
    await loadQuery(source.query);
    localStorage.removeItem(journalKey);
    localStorage.removeItem(draftKey);
  });
$('checkpoint').onclick = () => void run(() => localStorage.setItem(draftKey, JSON.stringify(source.exportDrafts())));
$('restore').onclick = () =>
  void run(async () => {
    const stored = localStorage.getItem(draftKey);
    if (stored === null) throw new Error('No saved draft.');
    const checkpoint = JSON.parse(stored);
    stopLoader();
    try {
      await source.restoreDrafts(checkpoint);
    } finally {
      if (!disposed) {
        grid.resetData();
        startLoader();
      }
    }
  });
$('mode').onchange = () => void run(() => request('control', { mode: $('mode').value }));
$('external').onclick = () => void run(() => request('control', { mode: 'external' }));
update();
void run(initialize);
window.addEventListener('pagehide', (event) => {
  if (event.persisted) {
    loader?.pause();
    return;
  }
  disposed = true;
  stopLoader();
  grid.destroy();
  source.destroy();
});
window.addEventListener('pageshow', (event) => {
  if (event.persisted && !busy && !editing && !recoveryBlocked && source.status === 'ready') loader?.resume();
});
