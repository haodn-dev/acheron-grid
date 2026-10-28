import { createGrid } from '@acheron-grid/canvas';
import { LocalDataSource } from '@acheron-grid/core';

const rows = Array.from({ length: 100 }, (_, id) => ({
  id,
  team: ['Design', 'Engineering', 'Operations', 'Support'][id % 4],
  task: `Task ${id + 1}`,
  amount: (id + 1) * 10,
}));
const source = new LocalDataSource(rows, (row) => row.id);
const status = document.querySelector('#status');
const error = document.querySelector('#error');
const grid = createGrid({
  container: document.querySelector('#grid'),
  dataSource: source,
  accessibility: 'viewport',
  grouping: { columnKey: 'team', sumColumns: ['amount'] },
  columns: [
    { key: 'team', title: 'Team', editable: true },
    { key: 'task', title: 'Task', editable: true },
    { key: 'amount', title: 'Amount', editable: true, parse: Number },
  ],
  onEvent: () => updateStatus(),
});
function updateStatus() {
  status.textContent = `${rows.length} local records · ${grid.rowCount} visible rows including group headers`;
}
function run(action) {
  try {
    action();
    error.hidden = true;
    updateStatus();
  } catch (failure) {
    error.textContent = failure instanceof Error ? failure.message : 'Unable to change the view.';
    error.hidden = false;
  }
}
function expandAll(expanded) {
  const keys = [];
  for (let row = 0; row < grid.rowCount; row++) {
    const metadata = grid.getRowMetadata(row);
    if (metadata.kind === 'group') keys.push(metadata.key);
  }
  for (const key of keys) grid.setDataGroupExpanded(key, expanded);
}
document
  .querySelector('#filter')
  .addEventListener('input', (event) =>
    run(() => grid.setView({ filters: [{ columnKey: 'team', operator: 'contains', query: event.target.value }] })),
  );
document.querySelector('#expand').addEventListener('click', () => run(() => expandAll(true)));
document.querySelector('#collapse').addEventListener('click', () => run(() => expandAll(false)));
document.querySelector('#undo').addEventListener('click', () => run(() => grid.undo()));
document.querySelector('#redo').addEventListener('click', () => run(() => grid.redo()));
window.addEventListener('pagehide', (event) => {
  if (!event.persisted) grid.destroy();
});
window.groupedExample = { grid, source };
expandAll(false);
updateStatus();
