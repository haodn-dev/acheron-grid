import { createPagedRemoteDataSource } from '/core/index.js';
import { createGrid } from '/canvas/index.js';
import { createViewportLoader } from './viewport-loader.js';

let total = new URLSearchParams(location.search).get('rows') === '1000000' ? 1000000 : 100000;
const pageSize = 100,
  maxPages = 8,
  datasetId = 'viewport-demo';
let requests = 0,
  loader,
  migration,
  pendingAnchor;
const status = document.getElementById('status');
const retry = document.getElementById('retry');
const anchorStatus = document.getElementById('anchor-status');
const keepTask = document.getElementById('keep-task');
const container = document.getElementById('grid');
document.getElementById('total').textContent = total.toLocaleString('en');
document.getElementById('count').value = String(total);
const source = createPagedRemoteDataSource({
  datasetId,
  columnKeys: ['title'],
  rowCount: total,
  pageSize,
  maxPages,
  createAbortController: () => new AbortController(),
  createMutationId: () => crypto.randomUUID(),
  load: async ({ offset, limit, signal, query }) => {
    requests++;
    const response = await fetch(
      '/paged/api/viewport?' + new URLSearchParams({ offset, limit, total, order: query.sort?.direction ?? 'asc' }),
      { signal },
    );
    if (!response.ok)
      throw new Error('Page request failed (HTTP ' + response.status + '). Choose Retry visible pages.');
    return response.json();
  },
  write: async () => {
    throw new Error('This example is read-only.');
  },
});
const grid = createGrid({
  container,
  dataSource: {
    getRowCount: source.getRowCount,
    getRowId: source.getRowId,
    getValue: (row, key) => source.getValue(row, key) ?? 'Not loaded',
  },
  columns: [{ key: 'title', title: 'Task' }],
  columnWidth: 360,
  accessibility: 'viewport',
  allowSearch: false,
  permissions: { writable: false, pasteable: false, editable: false, formatting: false },
  viewMode: 'host',
  allowColumnChanges: false,
  allowMerging: false,
  allowRowGrouping: false,
  allowLockChanges: false,
  canChangeLayout: () => false,
  canChangeVisibility: () => false,
  canChangeStructure: () => false,
  onViewportChange: (view) => loader?.setViewport(view),
  getCellLabel: (_row, _key, value) => (value === undefined ? 'Not loaded' : String(value)),
  resolveCellPermission: ({ rowIndex }) => ({
    writable: false,
    pasteable: false,
    copyable: source.getPageState(Math.floor(rowIndex / pageSize) * pageSize)?.status === 'ready',
  }),
});
function createLoader() {
  return createViewportLoader({
    source,
    grid,
    maxPages,
    onState: (state) => {
      status.textContent = `${state.loading ? 'Loading visible pages' : 'Ready'} · ${total.toLocaleString('en')} records · ${source.query.sort?.direction === 'desc' ? 'highest ID first' : 'lowest ID first'} · ${state.cachedPages} / ${maxPages} cached pages · ${requests} requests${state.error ? ' · ' + state.error : ''}`;
      retry.disabled = !state.error;
    },
  });
}
loader = createLoader();
retry.onclick = () => loader.retry();
document.getElementById('data-view').onsubmit = async (event) => {
  event.preventDefault();
  const nextTotal = Number(document.getElementById('count').value);
  const direction = document.getElementById('direction').value;
  const selection = grid.getSelection(),
    range = grid.getSelectionRange();
  const loaded =
    selection &&
    range &&
    range.startRow === range.endRow &&
    range.startColumn === range.endColumn &&
    grid.getSelectionRanges().length === 1 &&
    source.getPageState(Math.floor(selection.rowIndex / pageSize) * pageSize)?.status === 'ready' &&
    source.getRowId(selection.rowIndex) === selection.rowId;
  const anchor = keepTask.checked
    ? loaded
      ? { rowId: selection.rowId, column: selection.columnIndex, revision: source.revision }
      : pendingAnchor
    : null;
  migration?.abort();
  const controller = new AbortController();
  migration = controller;
  pendingAnchor = anchor;
  loader?.dispose();
  loader = undefined;
  container.inert = true;
  retry.disabled = true;
  anchorStatus.textContent = anchor ? 'Locating selected task…' : '';
  source.setQuery({ sort: { columnKey: 'title', direction } }, nextTotal);
  grid.resetData();
  total = nextTotal;
  document.getElementById('total').textContent = total.toLocaleString('en');
  try {
    if (anchor) {
      const response = await fetch(
        '/paged/api/locate?' +
          new URLSearchParams({ rowId: anchor.rowId, revision: anchor.revision, total: nextTotal, order: direction }),
        { signal: controller.signal },
      );
      if (controller.signal.aborted) return;
      if (!response.ok) throw new Error('Task lookup failed (HTTP ' + response.status + ').');
      const located = await response.json();
      if (controller.signal.aborted) return;
      if (
        !located ||
        located.datasetId !== datasetId ||
        located.revision !== anchor.revision ||
        located.rowId !== anchor.rowId ||
        located.total !== nextTotal ||
        located.order !== direction ||
        (located.index !== null &&
          (!Number.isSafeInteger(located.index) || located.index < 0 || located.index >= nextTotal))
      )
        throw new Error('Task lookup did not match the requested view.');
      if (located.index === null)
        anchorStatus.textContent = 'Selected task is not in this view. Returned to the first row.';
      else {
        const offset = Math.floor(located.index / pageSize) * pageSize;
        await source.loadPage(offset);
        if (controller.signal.aborted) return;
        if (
          source.revision !== anchor.revision ||
          source.getPageState(offset)?.status !== 'ready' ||
          source.getRowId(located.index) !== anchor.rowId
        )
          throw new Error('Loaded task did not match the located identity.');
        grid.refreshRows(offset, Math.min(nextTotal - 1, offset + pageSize - 1));
        grid.selectCell(located.index, anchor.column);
        if (
          grid.getSelection()?.rowId !== anchor.rowId ||
          !grid.getViewport().regions.some(({ rows }) => rows.start <= located.index && located.index < rows.end)
        )
          throw new Error('Selected task is outside the browser scroll range.');
        anchorStatus.textContent = `Kept Task ${anchor.rowId} in the new view.`;
      }
    }
  } catch (failure) {
    if (controller.signal.aborted) return;
    grid.resetData();
    anchorStatus.textContent = `${failure.message} Selection cleared; returned to the first row.`;
  } finally {
    if (!controller.signal.aborted) {
      pendingAnchor = null;
      container.inert = false;
      loader = createLoader();
      loader.setViewport(grid.getViewport());
    }
  }
};
// These operations stay paired: the coordinator unsubscribes before source abort/disposal.
window.addEventListener(
  'pagehide',
  () => {
    migration?.abort();
    loader?.dispose();
    grid.destroy();
    source.destroy();
  },
  { once: true },
);
