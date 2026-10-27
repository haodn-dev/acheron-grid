import { createPagedRemoteDataSource } from '/core/index.js';
import { createGrid } from '/canvas/index.js';
import { createViewportLoader } from './viewport-loader.js';

let total = new URLSearchParams(location.search).get('rows') === '1000000' ? 1000000 : 100000;
const pageSize = 100,
  maxPages = 8;
let requests = 0,
  loader;
const status = document.getElementById('status');
const retry = document.getElementById('retry');
document.getElementById('total').textContent = total.toLocaleString('en');
document.getElementById('count').value = String(total);
const source = createPagedRemoteDataSource({
  datasetId: 'viewport-demo',
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
  container: document.getElementById('grid'),
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
  onViewportChange: (view) => loader.setViewport(view),
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
document.getElementById('data-view').onsubmit = (event) => {
  event.preventDefault();
  const nextTotal = Number(document.getElementById('count').value);
  const direction = document.getElementById('direction').value;
  loader.dispose();
  source.setQuery({ sort: { columnKey: 'title', direction } }, nextTotal);
  grid.resetData();
  total = nextTotal;
  document.getElementById('total').textContent = total.toLocaleString('en');
  loader = createLoader();
  loader.setViewport(grid.getViewport());
};
// These operations stay paired: the coordinator unsubscribes before source abort/disposal.
window.addEventListener(
  'pagehide',
  () => {
    loader.dispose();
    grid.destroy();
    source.destroy();
  },
  { once: true },
);
