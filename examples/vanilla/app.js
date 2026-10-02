import { createGrid } from '@acheron-grid/canvas';
import { LocalDataSource } from '@acheron-grid/core';

const columns = [{ key: 'id', title: 'Record ID' }, { key: 'name', title: 'Name', editable: true, parse: text => { if (!text.trim()) throw new Error('Name is required.'); return text; } },
  { key: 'status', title: 'Status', editable: true },
  ...Array.from({ length: 5 }, (_, index) => ({ key: `metric${index}`, title: `Metric ${index + 1}` }))];
const source = new LocalDataSource(Array.from({ length: 10_000 }, (_, index) => ({
  id: `AG-${String(index + 1).padStart(5, '0')}`, name: `Record ${index + 1}`, status: index % 4 === 0 ? 'Review' : 'Active',
  ...Object.fromEntries(Array.from({ length: 5 }, (_, metric) => [`metric${metric}`, (index + 1) * (metric + 1)])),
})), row => row.id);
const activity = document.querySelector('#activity');
const appearance = document.querySelector('#appearance');
const frozen = document.querySelector('#frozen');
let grid;

function mount() {
  grid?.destroy();
  document.querySelector('#range-count').textContent = '0 ranges selected';
  grid = createGrid({ container: document.querySelector('#grid'), columns, dataSource: source, multilineEditor: true, wrapText: true,
    frozenRows: frozen.checked ? 1 : 0, frozenColumns: frozen.checked ? 1 : 0,
    theme: appearance.value === 'teal' ? { headerBackground: '#e0f2f1', headerTextColor: '#115e59', selectionColor: '#0f766e' } : {},
    onSelectionRangesChange: ranges => { document.querySelector('#range-count').textContent = `${ranges.length} ranges selected`; },
    onEvent: event => { if (event.type === 'cell:change') activity.textContent = `${event.source}: ${event.changes.length} cell(s) changed. Values stay in this tab.`; },
    createEditor: (cell, doc) => {
      if (cell.columnKey !== 'status') return null;
      const select = doc.createElement('select');
      for (const value of ['Review', 'Active']) {
        const option = doc.createElement('option'); option.value = option.textContent = value; select.append(option);
      }
      select.value = String(cell.value); select.required = true; return select;
    },
    renderCell: (ctx, cell) => {
      if (cell.columnKey !== 'status') return false;
      const review = cell.value === 'Review';
      ctx.fillStyle = review ? '#fef3c7' : '#dcfce7'; ctx.fillRect(cell.x + 10, cell.y + 5, cell.width - 20, cell.height - 10);
      ctx.fillStyle = review ? '#92400e' : '#166534'; ctx.font = '600 12px system-ui'; ctx.textBaseline = 'middle';
      ctx.fillText(String(cell.value), cell.x + 18, cell.y + cell.height / 2); return true;
    },
  });
}
for (const control of [appearance, frozen]) control.addEventListener('change', () => { mount(); activity.textContent = 'View reset. Edited values remain; selection and undo history cleared.'; });
document.querySelector('#reset').addEventListener('click', () => { mount(); activity.textContent = 'View reset. Edited values remain; selection and undo history cleared.'; });
for (const action of ['undo', 'redo']) document.querySelector(`#${action}`).addEventListener('click', () => {
  try { if (!grid[action]()) activity.textContent = `Nothing to ${action}.`; }
  catch (error) { activity.textContent = error instanceof Error ? error.message : 'Action failed.'; }
});
document.querySelector('#find').addEventListener('click', () => grid.openSearch());
mount();
