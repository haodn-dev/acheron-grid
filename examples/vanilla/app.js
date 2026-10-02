import { createGrid } from '@acheron-grid/canvas';
import { LocalDataSource } from '@acheron-grid/core';

const avatars = ['#0f766e', '#2563eb', '#7c3aed'].map(color => 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="48" height="48"><rect width="48" height="48" rx="10" fill="${color}"/><circle cx="24" cy="17" r="8" fill="white"/><path d="M10 42c0-16 28-16 28 0" fill="white"/></svg>`));

const columns = [{ key: 'id', title: 'Record ID' }, { key: 'name', title: 'Name', editable: true, parse: text => { if (!text.trim()) throw new Error('Name is required.'); return text; } },
  { key: 'status', title: 'Status', editable: true, parse: text => { if (!['Review', 'Active'].includes(text)) throw new Error('Invalid status.'); return text; } },
  { key: 'approved', title: 'Approved', editable: true, parse: text => { if (!['true', 'false'].includes(text)) throw new Error('Invalid boolean.'); return text === 'true'; } },
  { key: 'avatar', title: 'Avatar' },
  ...Array.from({ length: 3 }, (_, index) => ({ key: `metric${index}`, title: `Metric ${index + 1}` }))];
const source = new LocalDataSource(Array.from({ length: 10_000 }, (_, index) => ({
  id: `AG-${String(index + 1).padStart(5, '0')}`, name: `Record ${index + 1}`, status: index % 4 === 0 ? 'Review' : 'Active', approved: index % 3 === 0, avatar: avatars[index % avatars.length],
  ...Object.fromEntries(Array.from({ length: 3 }, (_, metric) => [`metric${metric}`, (index + 1) * (metric + 1)])),
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
    onEvent: event => {
      if (event.type === 'cell:change') activity.textContent = `${event.source}: ${event.changes.length} cell(s) changed. Values stay in this tab.`;
      if (event.type === 'lock:change') activity.textContent = `${event.target.scope} ${event.locked ? 'locked' : 'unlocked'}.`;
            if (event.type === 'freeze:change') {
        frozen.checked = event.rows === 1 && event.columns === 1;
        frozen.indeterminate = !frozen.checked && (event.rows > 0 || event.columns > 0);
        activity.textContent = `Frozen: ${event.rows} row(s), ${event.columns} column(s).`;
      }
    },
    imageColumns: ['avatar'],
    columnEditors: { status: { type: 'select', values: ['Review', 'Active'] }, approved: { type: 'checkbox' } },
    renderCell: (ctx, cell) => {
      if (cell.columnKey !== 'status') return false;
      const review = cell.value === 'Review';
      ctx.fillStyle = review ? '#fef3c7' : '#dcfce7'; ctx.fillRect(cell.x + 10, cell.y + 5, cell.width - 20, cell.height - 10);
      ctx.fillStyle = review ? '#92400e' : '#166534'; ctx.font = '600 12px system-ui'; ctx.textBaseline = 'middle';
      ctx.fillText(String(cell.value), cell.x + 18, cell.y + cell.height / 2); return true;
    },
  });
  grid.setColumnWidth(3, 100); grid.setColumnWidth(4, 80);
}
appearance.addEventListener('change', () => { mount(); activity.textContent = 'View reset. Edited values remain; selection and undo history cleared.'; });
frozen.addEventListener('change', () => {
  try { grid.setFrozen(frozen.checked ? 1 : 0, frozen.checked ? 1 : 0); }
  catch (error) { frozen.checked = grid.frozenRows === 1 && grid.frozenColumns === 1; activity.textContent = error instanceof Error ? error.message : 'Freeze failed.'; }
});
document.querySelector('#reset').addEventListener('click', () => { mount(); activity.textContent = 'View reset. Edited values remain; selection and undo history cleared.'; });
for (const action of ['undo', 'redo']) document.querySelector(`#${action}`).addEventListener('click', () => {
  try { if (!grid[action]()) activity.textContent = `Nothing to ${action}.`; }
  catch (error) { activity.textContent = error instanceof Error ? error.message : 'Action failed.'; }
});
document.querySelector('#find').addEventListener('click', () => grid.openSearch());
mount();
