import { createGrid } from '@acheron-grid/canvas';
import { LocalDataSource } from '@acheron-grid/core';

const rows = ['Website', 'Documentation', 'Integrations', 'Release'].flatMap((name, id) => [
  { id, parent: null, name, estimate: 0 },
  { id: `${id}-phase`, parent: id, name: 'Delivery', estimate: 0 },
  ...['Plan', 'Build', 'Review'].map((task, index) => ({
    id: `${id}-${index}`,
    parent: `${id}-phase`,
    name: task,
    estimate: index + 1,
  })),
]);
const source = new LocalDataSource(rows, (row) => row.id);
const status = document.querySelector('#status');
const error = document.querySelector('#error');
const grid = createGrid({
  container: document.querySelector('#grid'),
  dataSource: source,
  accessibility: 'viewport',
  tree: { parentColumnKey: 'parent' },
  columns: [
    { key: 'name', title: 'Task', editable: true },
    { key: 'estimate', title: 'Estimate', editable: true, parse: Number },
    { key: 'parent', title: 'Parent ID', editable: true },
  ],
  columnWidths: { name: 300, estimate: 130, parent: 160 },
  onEvent: () => updateStatus(),
});
function updateStatus() {
  status.textContent = `${rows.length} local records · ${grid.rowCount} visible records`;
}
function run(action) {
  try {
    action();
    error.hidden = true;
    updateStatus();
  } catch (failure) {
    error.textContent = failure instanceof Error ? failure.message : 'Unable to change the tree.';
    error.hidden = false;
  }
}
document.querySelector('#expand').addEventListener('click', () =>
  run(() => {
    for (let row = 0; row < grid.rowCount; row++) {
      const node = grid.getTreeRowMetadata(row);
      if (node.hasChildren && !node.expanded) grid.setTreeExpanded(node.rowId, true);
    }
  }),
);
document.querySelector('#collapse').addEventListener('click', () =>
  run(() => {
    for (let row = grid.rowCount - 1; row >= 0; row--) {
      const node = grid.getTreeRowMetadata(row);
      if (node.level === 1 && node.hasChildren && node.expanded) grid.setTreeExpanded(node.rowId, false);
    }
  }),
);
document
  .querySelector('#filter')
  .addEventListener('input', (event) =>
    run(() => grid.setView({ filters: [{ columnKey: 'name', operator: 'contains', query: event.target.value }] })),
  );
document.querySelector('#undo').addEventListener('click', () => run(() => grid.undo()));
document.querySelector('#redo').addEventListener('click', () => run(() => grid.redo()));
grid.restoreTreeState({ version: 1, tree: grid.tree, collapsedIds: [1, 2, 3] });
window.addEventListener('pagehide', (event) => {
  if (!event.persisted) grid.destroy();
});
window.treeExample = { grid, source };
updateStatus();
