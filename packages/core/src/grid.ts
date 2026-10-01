import type { DataSource } from './data-source.js';
import { visibleRange } from './viewport.js';

export interface Column { key: string; title: string; }
export interface GridOptions {
  container: HTMLElement;
  columns: readonly Column[];
  dataSource: DataSource;
  rowHeight?: number;
  columnWidth?: number;
  headerHeight?: number;
}
export interface Grid { render(): void; destroy(): void; }

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
  win.addEventListener('resize', render);
  render();
  return {
    render,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      if (frame !== undefined) win.cancelAnimationFrame(frame);
      observer.disconnect();
      scroller.removeEventListener('scroll', render);
      win.removeEventListener('resize', render);
      root.remove();
    },
  };
}
