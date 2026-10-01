import type { CellUpdate, DataSource, RowId } from './data-source.js';
import { visibleRange } from './viewport.js';
import { clipboardCellLimit, clipboardTextLimit, decodeTsv, encodeTsv } from './tsv.js';

export interface Column { key: string; title: string; editable?: boolean; parse?: (text: string) => unknown; }
export interface CellSelection { rowIndex: number; rowId: RowId; columnIndex: number; columnKey: string; }
export interface SelectionRange { startRow: number; endRow: number; startColumn: number; endColumn: number; }
export interface GridOptions {
  onSelectionChange?: (selection: CellSelection | null) => void;
  onSelectionRangeChange?: (range: SelectionRange | null) => void;
  container: HTMLElement;
  columns: readonly Column[];
  dataSource: DataSource;
  rowHeight?: number;
  columnWidth?: number;
  headerHeight?: number;
}
export interface Grid {
  render(): void;
  updateCells(updates: readonly CellUpdate[]): void;
  undo(): boolean;
  redo(): boolean;
  getSelection(): CellSelection | null;
  getSelectionRange(): SelectionRange | null;
  copySelection(): string;
  paste(text: string): void;
  destroy(): void;
}

/** Mount a grid. The caller owns the container and its dimensions. */
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
  const viewportLabel = dataSource.setValue && columns.some(column => column.editable) ? 'Data grid viewport' : 'Read-only data grid viewport';
  scroller.style.cssText = `position:absolute;inset:${headerHeight}px 0 0;overflow:auto;overscroll-behavior:contain`;
  scroller.tabIndex = 0;
  scroller.setAttribute('aria-label', viewportLabel);
  const spacer = doc.createElement('div');
  spacer.style.width = `${columns.length * columnWidth}px`;
  spacer.style.position = 'relative';
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
  let anchor: CellSelection | null = null;
  let dragPointer: number | null = null;
  let editor: HTMLInputElement | null = null;
  let fullDraw = true;
  const dirty = new Map<string, CellUpdate>();
  type Change = CellUpdate & { previous: unknown; rowId: RowId };
  const past: Change[][] = [];
  const future: Change[][] = [];

  function write(changes: readonly CellUpdate[]): void {
    if (changes.length === 1 && dataSource.setValue) {
      const change = changes[0]!;
      dataSource.setValue(change.rowIndex, change.columnKey, change.value);
    } else if (dataSource.setValues) dataSource.setValues(changes);
    else throw new Error('An atomic setValues method is required for batch writes.');
  }

  function invalidate(changes: readonly CellUpdate[]): void {
    for (const change of changes) dirty.set(JSON.stringify([change.rowIndex, change.columnKey]), change);
    if (selection) {
      const column = columns[selection.columnIndex]!;
      const value = dataSource.getValue(selection.rowIndex, column.key);
      scroller.setAttribute('aria-label', `${viewportLabel}: row ${selection.rowIndex + 1}, ${column.title}, ${value == null ? '' : String(value)}`);
    }
    schedule();
  }

  function updateCells(updates: readonly CellUpdate[]): void {
    if (destroyed) throw new Error('Grid is destroyed.');
    if (editor) throw new Error('Finish editing before updating cells.');
    applyUpdates(updates);
  }

  function applyUpdates(updates: readonly CellUpdate[]): void {
    const unique = new Map<string, CellUpdate>();
    for (const update of updates) {
      if (!Number.isSafeInteger(update.rowIndex) || update.rowIndex < 0 || update.rowIndex >= rowCount) throw new RangeError('Invalid row index.');
      if (!columns.some(column => column.key === update.columnKey)) throw new Error(`Unknown column: ${update.columnKey}`);
      unique.set(JSON.stringify([update.rowIndex, update.columnKey]), { ...update });
    }
    const changes: Change[] = [...unique.values()].map(update => ({ ...update,
      previous: dataSource.getValue(update.rowIndex, update.columnKey), rowId: dataSource.getRowId(update.rowIndex),
    })).filter(change => !Object.is(change.previous, change.value));
    if (!changes.length) return;
    write(changes);
    past.push(changes);
    // ponytail: keep the latest 100 commands; large values remain shallow caller-owned references.
    if (past.length > 100) past.shift();
    future.length = 0;
    invalidate(changes);
  }

  function replay(redo: boolean): boolean {
    if (destroyed || editor) return false;
    const from = redo ? future : past;
    const to = redo ? past : future;
    const changes = from.at(-1);
    if (!changes) return false;
    for (const change of changes) {
      if (dataSource.getRowId(change.rowIndex) !== change.rowId || !Object.is(dataSource.getValue(change.rowIndex, change.columnKey), redo ? change.previous : change.value)) {
        throw new Error('History conflicts with external data changes.');
      }
    }
    const updates = changes.map(change => ({ ...change, value: redo ? change.value : change.previous }));
    write(updates);
    from.pop();
    to.push(changes);
    invalidate(updates);
    return true;
  }

  function finishEdit(commit: boolean): boolean {
    if (!editor || !selection) return true;
    if (commit) {
      try {
        const column = columns[selection.columnIndex]!;
        const previous = dataSource.getValue(selection.rowIndex, column.key);
        if (editor.value !== (previous == null ? '' : String(previous))) {
          applyUpdates([{ rowIndex: selection.rowIndex, columnKey: column.key, value: column.parse ? column.parse(editor.value) : editor.value }]);
        }
      } catch (error) {
        editor.setCustomValidity(error instanceof Error ? error.message : 'Unable to save cell.');
        editor.setAttribute('aria-invalid', 'true');
        editor.reportValidity();
        editor.focus({ preventScroll: true });
        return false;
      }
    }
    const input = editor;
    editor = null;
    input.remove();
    select(selection.rowIndex, selection.columnIndex, true);
    return true;
  }

  function beginEdit(): void {
    if (destroyed || editor || !selection || !dataSource.setValue) return;
    const column = columns[selection.columnIndex]!;
    if (!column.editable) return;
    const value = dataSource.getValue(selection.rowIndex, column.key);
    // ponytail: text values by default; typed columns provide a parser.
    if (!column.parse && value != null && typeof value !== 'string') return;
    editor = doc.createElement('input');
    editor.type = 'text';
    editor.value = value == null ? '' : String(value);
    editor.setAttribute('aria-label', `Edit row ${selection.rowIndex + 1}, ${column.title}`);
    editor.style.cssText = `position:absolute;box-sizing:border-box;z-index:1;border:2px solid #2563eb;background:white;font:13px system-ui;padding:0 8px;left:${selection.columnIndex * columnWidth}px;top:${selection.rowIndex * rowHeight}px;width:${columnWidth}px;height:${rowHeight}px`;
    editor.addEventListener('input', () => {
      editor?.setCustomValidity('');
      editor?.removeAttribute('aria-invalid');
    });
    editor.addEventListener('keydown', event => {
      event.stopPropagation();
      if (event.isComposing || event.keyCode === 229) return;
      if (event.key === 'Enter' || event.key === 'Escape') {
        event.preventDefault();
        if (finishEdit(event.key === 'Enter')) scroller.focus({ preventScroll: true });
      } else if (event.key === 'Tab' && !finishEdit(true)) event.preventDefault();
    });
    editor.addEventListener('blur', () => finishEdit(true));
    spacer.append(editor);
    editor.focus({ preventScroll: true });
    editor.select();
  }

  function getSelection(): CellSelection | null {
    return selection ? { ...selection } : null;
  }

  function getSelectionRange(): SelectionRange | null {
    if (!selection || !anchor) return null;
    return { startRow: Math.min(anchor.rowIndex, selection.rowIndex), endRow: Math.max(anchor.rowIndex, selection.rowIndex),
      startColumn: Math.min(anchor.columnIndex, selection.columnIndex), endColumn: Math.max(anchor.columnIndex, selection.columnIndex) };
  }

  function copySelection(): string {
    if (destroyed) throw new Error('Grid is destroyed.');
    if (editor) throw new Error('Finish editing before copying cells.');
    const range = getSelectionRange();
    if (!range) return '';
    if ((range.endRow - range.startRow + 1) * (range.endColumn - range.startColumn + 1) > clipboardCellLimit) throw new RangeError('Selection has too many cells.');
    const rows: string[][] = [];
    let length = 0;
    for (let row = range.startRow; row <= range.endRow; row++) {
      const values: string[] = [];
      for (let col = range.startColumn; col <= range.endColumn; col++) {
        const value = dataSource.getValue(row, columns[col]!.key);
        const text = value == null ? '' : String(value);
        length += text.length;
        if (length > clipboardTextLimit) throw new RangeError('Selection text is too large.');
        values.push(text);
      }
      rows.push(values);
    }
    const text = encodeTsv(rows);
    if (text.length > clipboardTextLimit) throw new RangeError('Selection text is too large.');
    return text;
  }

  function paste(text: string): void {
    if (destroyed) throw new Error('Grid is destroyed.');
    if (editor) throw new Error('Finish editing before pasting cells.');
    const range = getSelectionRange();
    if (!range) return;
    const rows = decodeTsv(text);
    const height = rows.length;
    const width = rows[0]!.length;
    if (range.startRow + height > rowCount || range.startColumn + width > columns.length) throw new RangeError('Paste extends beyond grid bounds.');
    const updates: CellUpdate[] = [];
    for (let row = 0; row < height; row++) {
      for (let col = 0; col < width; col++) {
        const column = columns[range.startColumn + col]!;
        const rowIndex = range.startRow + row;
        if (!column.editable) throw new Error(`Column is read-only: ${column.key}`);
        const current = dataSource.getValue(rowIndex, column.key);
        if (!column.parse && current != null && typeof current !== 'string') throw new Error(`Column requires a parser: ${column.key}`);
        const value = rows[row]![col]!;
        updates.push({ rowIndex, columnKey: column.key, value: column.parse ? column.parse(value) : value });
      }
    }
    applyUpdates(updates);
  }

  function onCopy(event: ClipboardEvent): void {
    if (event.target === editor || !selection || !event.clipboardData) return;
    event.preventDefault();
    try { event.clipboardData.setData('text/plain', copySelection()); }
    catch (error) { win.alert(error instanceof Error ? error.message : 'Unable to copy cells.'); }
  }

  function onPaste(event: ClipboardEvent): void {
    if (event.target === editor || !selection || !event.clipboardData?.types.includes('text/plain')) return;
    event.preventDefault();
    try { paste(event.clipboardData.getData('text/plain')); }
    catch (error) { win.alert(error instanceof Error ? error.message : 'Unable to paste cells.'); }
  }

  function select(rowIndex: number, columnIndex: number, extend = false): void {
    if (destroyed || rowCount === 0 || columns.length === 0) return;
    const changed = selection?.rowIndex !== rowIndex || selection?.columnIndex !== columnIndex;
    const previousRange = JSON.stringify(getSelectionRange());
    selection = { rowIndex, rowId: dataSource.getRowId(rowIndex), columnIndex, columnKey: columns[columnIndex]!.key };
    if (!extend || !anchor) anchor = { ...selection };
    const rangeChanged = previousRange !== JSON.stringify(getSelectionRange());
    const left = columnIndex * columnWidth;
    const top = rowIndex * rowHeight;
    if (left < scroller.scrollLeft || columnWidth > scroller.clientWidth) scroller.scrollLeft = left;
    else if (left + columnWidth > scroller.scrollLeft + scroller.clientWidth) scroller.scrollLeft = left + columnWidth - scroller.clientWidth;
    if (top < scroller.scrollTop || rowHeight > scroller.clientHeight) scroller.scrollTop = top;
    else if (top + rowHeight > scroller.scrollTop + scroller.clientHeight) scroller.scrollTop = top + rowHeight - scroller.clientHeight;
    const value = dataSource.getValue(rowIndex, selection.columnKey);
    scroller.setAttribute('aria-label', `${viewportLabel}: row ${rowIndex + 1}, ${columns[columnIndex]!.title}, ${value == null ? '' : String(value)}`);
    if (changed || rangeChanged) render();
    if (changed) options.onSelectionChange?.(getSelection());
    if (rangeChanged) options.onSelectionRangeChange?.(getSelectionRange());
  }

  function pointerCell(event: MouseEvent, clamp = false): { row: number; col: number } | null {
    if (!rowCount || !columns.length) return null;
    const bounds = scroller.getBoundingClientRect();
    let x = event.clientX - bounds.left;
    let y = event.clientY - bounds.top;
    if (clamp) { x = Math.max(0, Math.min(scroller.clientWidth - 1, x)); y = Math.max(0, Math.min(scroller.clientHeight - 1, y)); }
    if (x < 0 || y < 0 || x >= scroller.clientWidth || y >= scroller.clientHeight) return null;
    const row = Math.floor((y + scroller.scrollTop) / rowHeight);
    const col = Math.floor((x + scroller.scrollLeft) / columnWidth);
    if (!clamp && (row >= rowCount || col >= columns.length)) return null;
    return { row: Math.min(rowCount - 1, row), col: Math.min(columns.length - 1, col) };
  }

  function onPointerDown(event: PointerEvent): void {
    if (event.target === editor || event.button !== 0 || event.ctrlKey || event.metaKey || event.altKey) return;
    const cell = pointerCell(event);
    if (!cell) return;
    event.preventDefault();
    if (!finishEdit(true)) return;
    scroller.focus({ preventScroll: true });
    select(cell.row, cell.col, event.shiftKey);
    if (event.pointerType !== 'touch') {
      dragPointer = event.pointerId;
      scroller.setPointerCapture(event.pointerId);
    }
  }

  function onPointerMove(event: PointerEvent): void {
    // ponytail: drag extends on pointer movement; a frame loop would enable stationary edge auto-scroll.
    if (event.pointerId !== dragPointer) return;
    const cell = pointerCell(event, true);
    if (cell) select(cell.row, cell.col, true);
  }

  function onPointerEnd(): void { dragPointer = null; }

  function onKeyDown(event: KeyboardEvent): void {
    if (event.isComposing || event.altKey) return;
    const control = event.ctrlKey || event.metaKey;
    if (control && (event.key.toLowerCase() === 'z' || (event.key.toLowerCase() === 'y' && !event.shiftKey))) {
      event.preventDefault();
      try { replay(event.shiftKey || event.key.toLowerCase() === 'y'); }
      catch (error) { win.alert(error instanceof Error ? error.message : 'Unable to replay history.'); }
      return;
    }
    if (event.shiftKey && !['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    if (control && event.key !== 'Home' && event.key !== 'End') return;
    if (event.key === 'Enter' || event.key === 'F2') {
      beginEdit();
      if (editor) event.preventDefault();
      return;
    }
    if (event.key === 'Escape') {
      if (selection) {
        event.preventDefault();
        selection = null;
        anchor = null;
        scroller.setAttribute('aria-label', viewportLabel);
        render();
        options.onSelectionChange?.(null);
        options.onSelectionRangeChange?.(null);
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
    select(Math.max(0, Math.min(rowCount - 1, row)), Math.max(0, Math.min(columns.length - 1, col)), event.shiftKey);
  }

  function cell(text: string, x: number, y: number, width: number, height: number, header: boolean): void {
    const ctx = context!;
    ctx.fillStyle = header ? '#edf2f7' : '#ffffff';
    ctx.fillRect(x, y, width, height);
    ctx.strokeStyle = '#e2e8f0';
    ctx.lineWidth = 1;
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
    if (!fullDraw) {
      context!.save();
      context!.beginPath();
      context!.rect(0, headerHeight, width, Math.max(0, height - headerHeight));
      context!.clip();
      for (const change of dirty.values()) {
        const col = columns.findIndex(column => column.key === change.columnKey);
        const x = col * columnWidth - scroller.scrollLeft;
        const y = headerHeight + change.rowIndex * rowHeight - scroller.scrollTop;
        if (x >= width || x + columnWidth <= 0 || y >= height || y + rowHeight <= headerHeight) continue;
        context!.save();
        context!.beginPath();
        context!.rect(x, y, columnWidth, rowHeight);
        context!.clip();
        const value = dataSource.getValue(change.rowIndex, change.columnKey);
        cell(value == null ? '' : String(value), x, y, columnWidth, rowHeight, false);
        context!.restore();
      }
      drawSelection();
      context!.restore();
      dirty.clear();
      return;
    }
    fullDraw = false;
    dirty.clear();
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
    drawSelection();
    context!.restore();
    context!.save();
    context!.beginPath();
    context!.rect(0, 0, width, headerHeight);
    context!.clip();
    for (let col = cols.start; col < cols.end; col++) {
      cell(columns[col]!.title, col * columnWidth - scroller.scrollLeft, 0, columnWidth, headerHeight, true);
    }
    context!.restore();
  }

  function drawSelection(): void {
    if (selection) {
      const range = getSelectionRange()!;
      context!.strokeStyle = '#2563eb';
      context!.lineWidth = 2;
      context!.strokeRect(range.startColumn * columnWidth - scroller.scrollLeft + 1,
        headerHeight + range.startRow * rowHeight - scroller.scrollTop + 1,
        Math.max(0, (range.endColumn - range.startColumn + 1) * columnWidth - 2),
        Math.max(0, (range.endRow - range.startRow + 1) * rowHeight - 2));
      if (range.startRow === range.endRow && range.startColumn === range.endColumn) return;
      context!.strokeRect(selection.columnIndex * columnWidth - scroller.scrollLeft + 1,
        headerHeight + selection.rowIndex * rowHeight - scroller.scrollTop + 1,
        Math.max(0, columnWidth - 2), Math.max(0, rowHeight - 2));
    }
  }

  function render(): void {
    fullDraw = true;
    schedule();
  }
  function schedule(): void {
    if (!destroyed && frame === undefined) frame = win.requestAnimationFrame(draw);
  }
  const observer = new ResizeObserver(render);
  observer.observe(root);
  scroller.addEventListener('scroll', render, { passive: true });
  scroller.addEventListener('pointerdown', onPointerDown);
  scroller.addEventListener('pointermove', onPointerMove);
  scroller.addEventListener('pointerup', onPointerEnd);
  scroller.addEventListener('pointercancel', onPointerEnd);
  scroller.addEventListener('lostpointercapture', onPointerEnd);
  scroller.addEventListener('copy', onCopy);
  scroller.addEventListener('paste', onPaste);
  scroller.addEventListener('keydown', onKeyDown);
  scroller.addEventListener('dblclick', onDoubleClick);
  win.addEventListener('resize', render);
  render();
  function onDoubleClick(event: MouseEvent): void {
    if (event.target !== editor && pointerCell(event) && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) beginEdit();
  }
  return {
    render,
    updateCells,
    undo: () => replay(false),
    redo: () => replay(true),
    getSelection,
    getSelectionRange,
    copySelection,
    paste,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      dirty.clear();
      past.length = future.length = 0;
      const input = editor;
      editor = null;
      input?.remove();
      selection = null;
      anchor = null;
      dragPointer = null;
      scroller.removeEventListener('pointermove', onPointerMove);
      scroller.removeEventListener('pointerup', onPointerEnd);
      scroller.removeEventListener('pointercancel', onPointerEnd);
      scroller.removeEventListener('lostpointercapture', onPointerEnd);
      scroller.removeEventListener('copy', onCopy);
      scroller.removeEventListener('paste', onPaste);
      scroller.removeEventListener('dblclick', onDoubleClick);
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
