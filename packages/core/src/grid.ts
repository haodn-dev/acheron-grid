import type { DataSource, RowId } from './data-source.js';
import { visibleRange } from './viewport.js';

export interface Column { key: string; title: string; }
export interface CellSelection { rowIndex: number; rowId: RowId; columnIndex: number; columnKey: string; }
export interface GridOptions {
  onSelectionChange?: (selection: CellSelection | null) => void;
  container: HTMLElement;
  columns: readonly Column[];
  dataSource: DataSource;
  rowHeight?: number;
  columnWidth?: number;
  headerHeight?: number;
}
export interface Grid { render(): void; getSelection(): CellSelection | null; destroy(): void; }

/** Mount a read-only grid. The caller owns the container and its dimensions. */
export function createGrid(options: GridOptions): Grid {
  const { container, dataSource } = options;
  const columns = options.columns.map(column => ({ ...column }));
  const rowHeight = options.rowHeight ?? 32;
  const columnWidth = options.columnWidth ?? 160;
  const headerHeight = options.headerHeight ?? 36;
  for (const size of [rowHeight, columnWidth, headerHeight]) {
    if (!Number.isFinite(size) || size <= 0) throw new RangeError('Grid sizes must be positive finite numbers.');
  }
  if (new Set(columns.map(column => column.key)).size !== columns.length) throw new Error('Column keys must be unique.');
  const rowCount = dataSource.getRowCount();
  if (!Number.isSafeInteger(rowCount) || rowCount < 0) throw new RangeError('Invalid row count.');
  if (!Number.isFinite(rowCount * rowHeight) || !Number.isFinite(columns.length * columnWidth)) throw new RangeError('Grid dimensions overflow.');
  const doc = container.ownerDocument;
  const win = doc.defaultView!;
  const root = doc.createElement('div');
  root.style.cssText = 'position:relative;width:100%;height:100%;overflow:hidden;background:#fff';
  const scroller = doc.createElement('div');
  scroller.style.cssText = `position:absolute;inset:${headerHeight}px 0 0;overflow:auto;overscroll-behavior:contain`;
  scroller.tabIndex = 0;
  scroller.setAttribute('aria-label', 'Read-only data grid viewport');
  const spacer = doc.createElement('div');
  spacer.style.width = `${columns.length * columnWidth}px`;
  spacer.style.height = `${rowCount * rowHeight}px`;
  scroller.append(spacer);
  const canvas = doc.createElement('canvas');
  canvas.style.cssText = 'position:absolute;left:0;top:0;pointer-events:none';
  canvas.setAttribute('aria-hidden', 'true');
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas 2D is unavailable.');
  root.append(scroller, canvas);
  container.append(root);
  let frame: number | undefined;
  let destroyed = false;
  let selection: CellSelection | null = null;

  function getSelection(): CellSelection | null {
    return selection ? { ...selection } : null;
  }

  function select(rowIndex: number, columnIndex: number): void {
    if (destroyed || rowCount === 0 || columns.length === 0) return;
    const changed = selection?.rowIndex !== rowIndex || selection?.columnIndex !== columnIndex;
    selection = { rowIndex, rowId: dataSource.getRowId(rowIndex), columnIndex, columnKey: columns[columnIndex]!.key };
    const left = columnIndex * columnWidth;
    const top = rowIndex * rowHeight;
    if (left < scroller.scrollLeft || columnWidth > scroller.clientWidth) scroller.scrollLeft = left;
    else if (left + columnWidth > scroller.scrollLeft + scroller.clientWidth) scroller.scrollLeft = left + columnWidth - scroller.clientWidth;
    if (top < scroller.scrollTop || rowHeight > scroller.clientHeight) scroller.scrollTop = top;
    else if (top + rowHeight > scroller.scrollTop + scroller.clientHeight) scroller.scrollTop = top + rowHeight - scroller.clientHeight;
    const value = dataSource.getValue(rowIndex, selection.columnKey);
    scroller.setAttribute('aria-label', `Read-only data grid viewport: row ${rowIndex + 1}, ${columns[columnIndex]!.title}, ${value == null ? '' : String(value)}`);
    render();
    if (changed) options.onSelectionChange?.(getSelection());
  }

  function onPointerDown(event: PointerEvent): void {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
    const bounds = scroller.getBoundingClientRect();
    const x = event.clientX - bounds.left;
    const y = event.clientY - bounds.top;
    if (x < 0 || y < 0 || x >= scroller.clientWidth || y >= scroller.clientHeight) return;
    const row = Math.floor((y + scroller.scrollTop) / rowHeight);
    const col = Math.floor((x + scroller.scrollLeft) / columnWidth);
    if (row >= rowCount || col >= columns.length) return;
    event.preventDefault();
    scroller.focus({ preventScroll: true });
    select(row, col);
  }

  function onKeyDown(event: KeyboardEvent): void {
    if (event.isComposing || event.altKey || event.shiftKey) return;
    const control = event.ctrlKey || event.metaKey;
    if (control && event.key !== 'Home' && event.key !== 'End') return;
    if (event.key === 'Escape') {
      if (selection) {
        event.preventDefault();
        selection = null;
        scroller.setAttribute('aria-label', 'Read-only data grid viewport');
        render();
        options.onSelectionChange?.(null);
      }
      return;
    }
    if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key) || !rowCount || !columns.length) return;
    event.preventDefault();
    let row = selection?.rowIndex ?? 0;
    let col = selection?.columnIndex ?? 0;
    if (selection) {
      if (event.key === 'ArrowUp') row--;
      if (event.key === 'ArrowDown') row++;
      if (event.key === 'ArrowLeft') col--;
      if (event.key === 'ArrowRight') col++;
      if (event.key === 'Home') { col = 0; if (control) row = 0; }
      if (event.key === 'End') { col = columns.length - 1; if (control) row = rowCount - 1; }
    }
    select(Math.max(0, Math.min(rowCount - 1, row)), Math.max(0, Math.min(columns.length - 1, col)));
  }

  function cell(text: string, x: number, y: number, width: number, height: number, header: boolean): void {
    const ctx = context!;
    ctx.fillStyle = header ? '#edf2f7' : '#ffffff';
    ctx.fillRect(x, y, width, height);
    ctx.strokeStyle = '#e2e8f0';
    ctx.strokeRect(x + 0.5, y + 0.5, width, height);
    ctx.save();
    ctx.beginPath();
    ctx.rect(x + 8, y, Math.max(0, width - 16), height);
    ctx.clip();
    ctx.fillStyle = header ? '#334155' : '#0f172a';
    ctx.font = `${header ? '600' : '400'} 13px system-ui, sans-serif`;
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x + 10, y + height / 2);
    ctx.restore();
  }

  function draw(): void {
    frame = undefined;
    if (destroyed) return;
    const width = scroller.clientWidth;
    const bodyHeight = scroller.clientHeight;
    const height = Math.min(root.clientHeight, bodyHeight + headerHeight);
    const ratio = win.devicePixelRatio || 1;
    canvas.width = Math.max(0, Math.round(width * ratio));
    canvas.height = Math.max(0, Math.round(height * ratio));
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    context!.setTransform(ratio, 0, 0, ratio, 0, 0);
    context!.clearRect(0, 0, width, height);
    const rows = visibleRange(rowCount, rowHeight, scroller.scrollTop, bodyHeight);
    const cols = visibleRange(columns.length, columnWidth, scroller.scrollLeft, width);
    context!.save();
    context!.beginPath();
    context!.rect(0, headerHeight, width, Math.max(0, height - headerHeight));
    context!.clip();
    for (let row = rows.start; row < rows.end; row++) {
      for (let col = cols.start; col < cols.end; col++) {
        const value = dataSource.getValue(row, columns[col]!.key);
        cell(value == null ? '' : String(value), col * columnWidth - scroller.scrollLeft,
          headerHeight + row * rowHeight - scroller.scrollTop, columnWidth, rowHeight, false);
      }
    }
    if (selection) {
      context!.strokeStyle = '#2563eb';
      context!.lineWidth = 2;
      context!.strokeRect(selection.columnIndex * columnWidth - scroller.scrollLeft + 1,
        headerHeight + selection.rowIndex * rowHeight - scroller.scrollTop + 1,
        Math.max(0, columnWidth - 2), Math.max(0, rowHeight - 2));
    }
    context!.restore();
    for (let col = cols.start; col < cols.end; col++) {
      cell(columns[col]!.title, col * columnWidth - scroller.scrollLeft, 0, columnWidth, headerHeight, true);
    }
  }

  function render(): void {
    if (!destroyed && frame === undefined) frame = win.requestAnimationFrame(draw);
  }
  const observer = new ResizeObserver(render);
  observer.observe(root);
  scroller.addEventListener('scroll', render, { passive: true });
  scroller.addEventListener('pointerdown', onPointerDown);
  scroller.addEventListener('keydown', onKeyDown);
  win.addEventListener('resize', render);
  render();
  return {
    render,
    getSelection,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      selection = null;
      scroller.removeEventListener('pointerdown', onPointerDown);
      scroller.removeEventListener('keydown', onKeyDown);
      if (frame !== undefined) win.cancelAnimationFrame(frame);
      observer.disconnect();
      scroller.removeEventListener('scroll', render);
      win.removeEventListener('resize', render);
      root.remove();
    },
  };
}
