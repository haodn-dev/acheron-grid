import { createGridEngine } from '@acheron-grid/core';
import type { CellUpdate, DataSource, Column, CellSelection, SelectionRange, CellPermission, GridEngineOptions, ViewportRegion } from '@acheron-grid/core';

export type { Column, CellSelection, SelectionRange } from '@acheron-grid/core';
export interface CellRenderInfo {
  readonly value: unknown;
  readonly rowIndex: number;
  readonly rowId: string | number;
  readonly columnIndex: number;
  readonly columnKey: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}
export type CellRenderer = (context: CanvasRenderingContext2D, cell: CellRenderInfo) => boolean;
export type CellEditor = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
export interface CellEditorInfo extends CellSelection {
  readonly value: unknown;
}
export type CellEditorFactory = (cell: Readonly<CellEditorInfo>, document: Document) => CellEditor | null;
export interface GridTheme {
  background: string;
  textColor: string;
  headerBackground: string;
  headerTextColor: string;
  gridLineColor: string;
  selectionColor: string;
  font: string;
  headerFont: string;
}
export interface GridOptions extends Pick<GridEngineOptions, 'permissions' | 'resolveCellPermission' | 'onEvent' | 'frozenRows' | 'frozenColumns'> {
  theme?: Partial<GridTheme>;
  renderCell?: CellRenderer;
  createEditor?: CellEditorFactory;
  onSelectionChange?: (selection: CellSelection | null) => void;
  onSelectionRangesChange?: (ranges: readonly SelectionRange[]) => void;
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
  getCellPermission(rowIndex: number, columnIndex: number): CellPermission;
  getSelection(): CellSelection | null;
  getSelectionRange(): SelectionRange | null;
  getSelectionRanges(): SelectionRange[];
  copySelection(): string;
  paste(text: string): void;
  setColumnWidth(index: number, width: number): void;
  setRowHeight(index: number, height: number): void;
  destroy(): void;
}

/** Mount a grid. The caller owns the container and its dimensions. */
export function createGrid(options: GridOptions): Grid {
  const { container, dataSource } = options;
  const doc = container.ownerDocument;
  const win = doc.defaultView!;
  const theme = Object.freeze({ background: '#ffffff', textColor: '#0f172a', headerBackground: '#edf2f7',
    headerTextColor: '#334155', gridLineColor: '#e2e8f0', selectionColor: '#2563eb',
    font: '400 13px system-ui, sans-serif', headerFont: '600 13px system-ui, sans-serif', ...options.theme });
  for (const [key, value] of Object.entries(theme)) {
    const property = key === 'font' || key === 'headerFont' ? 'font' : 'color';
    if (typeof value !== 'string' || /var\(|currentcolor|^(inherit|initial|unset|revert)/i.test(value.trim()) || !win.CSS.supports(property, value)) {
      throw new TypeError(`Invalid grid theme ${key}. Use a concrete CSS ${property} value.`);
    }
  }
  const headerHeight = options.headerHeight ?? 36;
  if (!Number.isFinite(headerHeight) || headerHeight <= 0) throw new RangeError('Grid sizes must be positive finite numbers.');
  const engine = createGridEngine({ columns: options.columns, dataSource,
    ...(options.rowHeight === undefined ? {} : { rowHeight: options.rowHeight }),
    ...(options.columnWidth === undefined ? {} : { columnWidth: options.columnWidth }),
    ...(options.permissions === undefined ? {} : { permissions: options.permissions }),
    ...(options.resolveCellPermission === undefined ? {} : { resolveCellPermission: options.resolveCellPermission }),
    ...(options.onEvent === undefined ? {} : { onEvent: options.onEvent }),
    ...(options.frozenRows === undefined ? {} : { frozenRows: options.frozenRows }),
    ...(options.frozenColumns === undefined ? {} : { frozenColumns: options.frozenColumns }),
    onInvalidate(change) {
    if (change.type === 'cells') invalidate(change.cells);
    else if (change.type === 'layout') {
      spacer.style.width = String(columnAxis.position(columns.length)) + 'px';
      spacer.style.height = String(rowAxis.position(rowCount)) + 'px';
      render();
    } else render();
  } });
  const { columns, rowCount, rows: rowAxis, columnsLayout: columnAxis } = engine;
  const root = doc.createElement('div');
  root.style.cssText = 'position:relative;width:100%;height:100%;overflow:hidden;background:var(--acheron-background)';
  for (const [key, value] of Object.entries(theme)) root.style.setProperty('--acheron-' + key.replace(/[A-Z]/g, letter => '-' + letter.toLowerCase()), value);
  const scroller = doc.createElement('div');
  const viewportLabel = dataSource.setValue && columns.some(column => column.editable) ? 'Data grid viewport' : 'Read-only data grid viewport';
  scroller.style.cssText = `position:absolute;inset:${headerHeight}px 0 0;overflow:auto;overscroll-behavior:contain`;
  scroller.tabIndex = 0;
  scroller.setAttribute('aria-label', viewportLabel);
  scroller.setAttribute('aria-keyshortcuts', 'Shift+F8');
  const spacer = doc.createElement('div');
  spacer.style.width = `${columnAxis.position(columns.length)}px`;
  spacer.style.position = 'relative';
  spacer.style.height = `${rowAxis.position(rowCount)}px`;
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
  let dragPointer: number | null = null;
  let addNextSelection = false;
  let editor: CellEditor | null = null;
  const editorPane = doc.createElement('div');
  editorPane.style.cssText = 'position:absolute;overflow:hidden;pointer-events:none;z-index:1';
  root.append(editorPane);
  let fullDraw = true;
  const dirty = new Map<string, { rowIndex: number; columnKey: string }>();
  let menu: HTMLDivElement | null = null;
  let sizeDialog: HTMLDialogElement | null = null;
  let resizing: { pointerId: number; column: number; x: number; width: number } | null = null;
  const actionError = doc.createElement('div');
  actionError.setAttribute('role', 'alert');
  actionError.style.cssText = 'display:none;position:absolute;bottom:20px;left:12px;right:24px;z-index:2;padding:10px;background:#fff1f2;color:#9f1239;border:1px solid #fda4af;border-radius:6px;font:13px system-ui';
  root.append(actionError);
  const selectionStatus = doc.createElement('div');
  selectionStatus.setAttribute('role', 'status');
  selectionStatus.style.cssText = 'position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap';
  root.append(selectionStatus);

  function announceSelection(): void {
    const selection = engine.getSelection();
    selectionStatus.textContent = `${selection ? `Row ${selection.rowIndex + 1}, ${columns[selection.columnIndex]!.title}. ${getSelectionRanges().length} selected range(s).` : 'Selection cleared.'}${addNextSelection ? ' Next click or navigation adds a range.' : ''}`;
  }

  function openSizeDialog(label: string, current: number, apply: (size: number) => void): void {
    const dialog = doc.createElement('dialog');
    sizeDialog?.remove();
    sizeDialog = dialog;
    dialog.setAttribute('aria-label', label);
    dialog.style.cssText = 'padding:20px;border:1px solid var(--acheron-grid-line-color);border-radius:8px;box-shadow:0 8px 24px #0f172a26;background:var(--acheron-background);color:var(--acheron-text-color);font:var(--acheron-font)';
    const form = doc.createElement('form');
    const fieldLabel = doc.createElement('label');
    fieldLabel.textContent = `${label} (px) `;
    const input = doc.createElement('input');
    input.type = 'number'; input.min = '1'; input.step = 'any'; input.required = true;
    input.value = String(current);
    input.style.cssText = 'width:100px;padding:6px;margin:0 0 16px 8px';
    fieldLabel.append(input);
    const save = doc.createElement('button');
    save.type = 'submit'; save.textContent = 'Apply';
    const cancel = doc.createElement('button');
    cancel.type = 'button'; cancel.textContent = 'Cancel';
    for (const button of [save, cancel]) button.style.cssText = 'padding:6px 14px;margin-right:8px';
    cancel.addEventListener('click', () => dialog.close());
    input.addEventListener('input', () => input.setCustomValidity(''));
    form.addEventListener('submit', event => {
      event.preventDefault();
      try { apply(input.valueAsNumber); dialog.close(); }
      catch (error) { input.setCustomValidity(error instanceof Error ? error.message : 'Invalid size.'); input.reportValidity(); }
    });
    form.append(fieldLabel, doc.createElement('br'), save, cancel);
    dialog.append(form);
    dialog.addEventListener('close', () => {
      dialog.remove();
      if (sizeDialog === dialog) sizeDialog = null;
      if (!destroyed && !editor) scroller.focus({ preventScroll: true });
    });
    root.append(dialog);
    dialog.showModal();
    input.focus(); input.select();
  }

  function resizeAxis(axis: typeof rowAxis, index: number, size: number): void {
    if (destroyed) throw new Error('Grid is destroyed.');
    if (editor) throw new Error('Finish editing before resizing cells.');
    if (axis === rowAxis) engine.setRowHeight(index, size);
    else engine.setColumnWidth(index, size);
  }

  function closeMenu(focus = false): void {
    menu?.remove();
    menu = null;
    if (focus && !destroyed) scroller.focus({ preventScroll: true });
  }

  function openMenu(row: number, col: number, x: number, y: number): void {
    closeMenu();
    const range = getSelectionRange();
    if (!range || row < range.startRow || row > range.endRow || col < range.startColumn || col > range.endColumn) select(row, col, false, false);
    if (destroyed || !engine.getCellPermission(row, col).selectable) return;
    const selection = engine.getSelection();
    if (!selection) return;
    const popup = doc.createElement('div');
    menu = popup;
    popup.popover = 'auto';
    popup.setAttribute('role', 'menu');
    popup.setAttribute('aria-label', 'Cell actions');
    popup.className = 'acheron-context-menu';
    popup.style.cssText = 'position:fixed;margin:0;padding:6px;min-width:200px;max-width:calc(100vw - 16px);max-height:calc(100vh - 16px);overflow:auto;border:1px solid var(--acheron-grid-line-color);border-radius:8px;box-shadow:0 8px 24px #0f172a26;background:var(--acheron-background);color:var(--acheron-text-color);font:var(--acheron-font)';
    const style = doc.createElement('style');
    style.textContent = '.acheron-context-menu button{display:block;width:100%;padding:8px 10px;border:0;border-radius:4px;background:transparent;text-align:left;color:inherit;font:inherit;cursor:pointer}.acheron-context-menu button:hover:not(:disabled),.acheron-context-menu button:focus-visible{background:var(--acheron-header-background);outline:2px solid var(--acheron-selection-color)}.acheron-context-menu button:disabled{opacity:.45;cursor:default}';
    popup.append(style);
    const fingerprint = JSON.stringify(getSelectionRanges());
    function item(label: string, enabled: boolean, action: () => void | Promise<void>): void {
      const button = doc.createElement('button');
      button.type = 'button';
      button.textContent = label;
      button.setAttribute('role', 'menuitem');
      button.disabled = !enabled;
      button.addEventListener('click', async () => {
        closeMenu(true);
        actionError.style.display = 'none';
        try { await action(); }
        catch (error) {
          if (!destroyed) {
            actionError.textContent = `${error instanceof Error ? error.message : 'Action failed.'}${label === 'Copy' || label === 'Paste' ? ' Use Ctrl/Cmd+C or Ctrl/Cmd+V if the browser blocks menu clipboard access.' : ''}`;
            actionError.style.display = 'block';
          }
        }
      });
      popup.append(button);
    }
    item('Copy', getSelectionRanges().length === 1 && engine.getCellPermission(selection.rowIndex, selection.columnIndex).copyable && !!win.navigator.clipboard?.writeText, () => win.navigator.clipboard.writeText(copySelection()));
    item('Paste', !!win.navigator.clipboard?.readText && engine.canPaste(), async () => {
      const text = await win.navigator.clipboard.readText();
      if (destroyed || fingerprint !== JSON.stringify(getSelectionRanges())) throw new Error('Selection changed before paste. Try again.');
      paste(text);
    });
    item('Edit cell', engine.canEdit(selection.rowIndex, selection.columnIndex), beginEdit);
    item('Undo', engine.canUndo(), () => { replay(false); });
    item('Redo', engine.canRedo(), () => { replay(true); });
    item('Resize column…', true, () => openSizeDialog('Column width', columnAxis.size(col), size => resizeAxis(columnAxis, col, size)));
    item('Resize row…', true, () => openSizeDialog('Row height', rowAxis.size(row), size => resizeAxis(rowAxis, row, size)));
    popup.addEventListener('keydown', event => {
      const buttons = Array.from(popup.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
      const index = buttons.indexOf(doc.activeElement as HTMLButtonElement);
      if (event.key === 'Escape' || event.key === 'Tab') { event.preventDefault(); closeMenu(true); }
      else if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault();
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
        buttons[next]?.focus();
      }
      event.stopPropagation();
    });
    root.append(popup);
    popup.showPopover();
    popup.style.left = `${Math.max(8, Math.min(x, win.innerWidth - popup.offsetWidth - 8))}px`;
    popup.style.top = `${Math.max(8, Math.min(y, win.innerHeight - popup.offsetHeight - 8))}px`;
    popup.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
  }

  function onContextMenu(event: MouseEvent): void {
    if (event.target === editor) return;
    const cell = pointerCell(event);
    if (!cell) return;
    event.preventDefault();
    if (!finishEdit(true)) return;
    openMenu(cell.row, cell.col, event.clientX, event.clientY);
  }

  function columnEdge(event: PointerEvent): number | null {
    const bounds = root.getBoundingClientRect();
    const x = event.clientX - bounds.left;
    const y = event.clientY - bounds.top;
    if (x < 0 || x >= scroller.clientWidth || y < 0 || y >= headerHeight || !columns.length) return null;
    const view = viewport();
    if (engine.frozenColumns > 0 && Math.abs(columnAxis.position(engine.frozenColumns) - x) <= 5 && x <= view.width) return engine.frozenColumns - 1;
    const offset = x + (x < view.frozenWidth ? 0 : view.scrollLeft);
    const col = columnAxis.indexAt(offset);
    const first = x < view.frozenWidth ? 0 : engine.frozenColumns;
    const limit = x < view.frozenWidth ? engine.frozenColumns : columns.length;
    if (col < limit && col >= first && Math.abs(columnAxis.position(col + 1) - offset) <= 5) return col;
    if (col > first && Math.abs(columnAxis.position(col) - offset) <= 5) return col - 1;
    return null;
  }

  function onHeaderPointerDown(event: PointerEvent): void {
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) return;
    const column = columnEdge(event);
    if (column === null) return;
    event.preventDefault();
    if (!finishEdit(true)) return;
    closeMenu();
    resizing = { pointerId: event.pointerId, column, x: event.clientX, width: columnAxis.size(column) };
    root.setPointerCapture(event.pointerId);
  }

  function onHeaderPointerMove(event: PointerEvent): void {
    root.style.cursor = resizing || columnEdge(event) !== null ? 'col-resize' : '';
    if (resizing?.pointerId === event.pointerId) resizeAxis(columnAxis, resizing.column, Math.max(24, Math.min(1000, resizing.width + event.clientX - resizing.x)));
  }

  function endResize(): void { resizing = null; root.style.cursor = ''; }

  function invalidate(changes: readonly { rowIndex: number; columnKey: string }[]): void {
    const selection = engine.getSelection();
    for (const change of changes) dirty.set(JSON.stringify([change.rowIndex, change.columnKey]), change);
    if (selection) {
      const column = columns[selection.columnIndex]!;
      const value = engine.getValue(selection.rowIndex, column.key);
      scroller.setAttribute('aria-label', `${viewportLabel}: row ${selection.rowIndex + 1}, ${column.title}, ${value == null ? '' : String(value)}`);
    }
    schedule();
  }

  function updateCells(updates: readonly CellUpdate[]): void {
    if (destroyed) throw new Error('Grid is destroyed.');
    if (editor) throw new Error('Finish editing before updating cells.');
    engine.updateCells(updates);
  }

  function replay(redo: boolean): boolean {
    if (destroyed || editor) return false;
    return redo ? engine.redo() : engine.undo();
  }

  function finishEdit(commit: boolean): boolean {
    const selection = engine.getSelection();
    if (!editor || !selection) return true;
    if (commit) {
      try {
        if (!editor.checkValidity()) throw new Error(editor.validationMessage);
        engine.editCell(selection.rowIndex, selection.columnIndex, editor.value);
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
    editorPane.style.width = editorPane.style.height = '0px';
    select(selection.rowIndex, selection.columnIndex, true);
    return true;
  }

  function beginEdit(): void {
    const selection = engine.getSelection();
    if (destroyed || editor || !selection || !engine.canEdit(selection.rowIndex, selection.columnIndex)) return;
    const column = columns[selection.columnIndex]!;
    const value = engine.getValue(selection.rowIndex, column.key);
    try {
      const custom = options.createEditor?.(Object.freeze({ ...selection, value }), doc) ?? null;
      if (custom && (custom.ownerDocument !== doc || custom.parentNode || !['INPUT', 'SELECT', 'TEXTAREA'].includes(custom.tagName))) {
        throw new Error('Cell editor must be a detached input, select or textarea from the grid document.');
      }
      editor = custom ?? doc.createElement('input');
      if (!custom) editor.value = value == null ? '' : String(value);
    } catch (error) {
      actionError.textContent = error instanceof Error ? error.message : 'Unable to create cell editor.';
      actionError.style.display = 'block';
      return;
    }
    actionError.style.display = 'none';
    editor.setAttribute('aria-label', `Edit row ${selection.rowIndex + 1}, ${column.title}`);
    editor.style.cssText = 'position:absolute;box-sizing:border-box;pointer-events:auto;border:2px solid var(--acheron-selection-color);background:var(--acheron-background);color:var(--acheron-text-color);font:var(--acheron-font);padding:0 8px';
    const clearValidation = () => {
      editor?.setCustomValidity('');
      editor?.removeAttribute('aria-invalid');
    };
    editor.addEventListener('input', clearValidation);
    editor.addEventListener('change', clearValidation);
    editor.addEventListener('keydown', event => {
      if (!(event instanceof win.KeyboardEvent)) return;
      event.stopPropagation();
      if (event.isComposing || event.keyCode === 229) return;
      if (event.key === 'Enter' || event.key === 'Escape') {
        event.preventDefault();
        if (finishEdit(event.key === 'Enter')) scroller.focus({ preventScroll: true });
      } else if (event.key === 'Tab' && !finishEdit(true)) event.preventDefault();
    });
    editor.addEventListener('blur', () => finishEdit(true));
    editorPane.append(editor);
    positionEditor();
    editor.focus({ preventScroll: true });
    if (editor.tagName !== 'SELECT' && 'select' in editor) editor.select();
  }

  const getSelection = engine.getSelection;
  const getSelectionRange = engine.getSelectionRange;
  const getSelectionRanges = engine.getSelectionRanges;

  function copySelection(): string {
    if (destroyed) throw new Error('Grid is destroyed.');
    if (editor) throw new Error('Finish editing before copying cells.');
    return engine.copySelection();
  }

  function paste(text: string): void {
    if (destroyed) throw new Error('Grid is destroyed.');
    if (editor) throw new Error('Finish editing before pasting cells.');
    engine.paste(text);
  }

  function onCopy(event: ClipboardEvent): void {
    const selection = engine.getSelection();
    if (event.target === editor || !selection || !event.clipboardData) return;
    event.preventDefault();
    try { event.clipboardData.setData('text/plain', copySelection()); }
    catch (error) { win.alert(error instanceof Error ? error.message : 'Unable to copy cells.'); }
  }

  function onPaste(event: ClipboardEvent): void {
    const selection = engine.getSelection();
    if (event.target === editor || !selection || !event.clipboardData?.types.includes('text/plain')) return;
    event.preventDefault();
    try { paste(event.clipboardData.getData('text/plain')); }
    catch (error) { win.alert(error instanceof Error ? error.message : 'Unable to paste cells.'); }
  }

  function select(rowIndex: number, columnIndex: number, extend = false, reveal = true, add = false): void {
    if (destroyed || rowCount === 0 || columns.length === 0) return;
    const previous = engine.getSelection();
    const changed = previous?.rowIndex !== rowIndex || previous?.columnIndex !== columnIndex;
    const previousRange = JSON.stringify(getSelectionRange());
    const previousRanges = JSON.stringify(getSelectionRanges());
    if (!(add ? engine.addSelection(rowIndex, columnIndex) : engine.select(rowIndex, columnIndex, extend))) return;
    const selection = engine.getSelection()!;
    if (add) addNextSelection = false;
    announceSelection();
    const rangeChanged = previousRange !== JSON.stringify(getSelectionRange());
    if (reveal) {
      const view = viewport();
      const left = columnAxis.position(columnIndex);
      const top = rowAxis.position(rowIndex);
      if (columnIndex >= engine.frozenColumns && view.width > view.frozenWidth) {
        if (left < view.scrollLeft + view.frozenWidth || columnAxis.size(columnIndex) > view.width - view.frozenWidth) scroller.scrollLeft = left - view.frozenWidth;
        else if (left + columnAxis.size(columnIndex) > view.scrollLeft + view.width) scroller.scrollLeft = left + columnAxis.size(columnIndex) - view.width;
      }
      if (rowIndex >= engine.frozenRows && view.height > view.frozenHeight) {
        if (top < view.scrollTop + view.frozenHeight || rowAxis.size(rowIndex) > view.height - view.frozenHeight) scroller.scrollTop = top - view.frozenHeight;
        else if (top + rowAxis.size(rowIndex) > view.scrollTop + view.height) scroller.scrollTop = top + rowAxis.size(rowIndex) - view.height;
      }
    }
    const value = engine.getValue(rowIndex, selection.columnKey);
    scroller.setAttribute('aria-label', `${viewportLabel}: row ${rowIndex + 1}, ${columns[columnIndex]!.title}, ${value == null ? '' : String(value)}`);
    if (changed) options.onSelectionChange?.(getSelection());
    if (rangeChanged) options.onSelectionRangeChange?.(getSelectionRange());
    if (previousRanges !== JSON.stringify(getSelectionRanges())) options.onSelectionRangesChange?.(getSelectionRanges());
  }

  function pointerCell(event: MouseEvent, clamp = false): { row: number; col: number } | null {
    if (!rowCount || !columns.length) return null;
    const bounds = scroller.getBoundingClientRect();
    let x = event.clientX - bounds.left;
    let y = event.clientY - bounds.top;
    if (clamp) { x = Math.max(0, Math.min(scroller.clientWidth - 1, x)); y = Math.max(0, Math.min(scroller.clientHeight - 1, y)); }
    if (x < 0 || y < 0 || x >= scroller.clientWidth || y >= scroller.clientHeight) return null;
    const hit = viewport().hitTest(x, y);
    if (hit || !clamp) return hit;
    const view = viewport();
    const row = Math.min(rowCount - 1, rowAxis.indexAt(y + (y < view.frozenHeight ? 0 : view.scrollTop)));
    const col = Math.min(columns.length - 1, columnAxis.indexAt(x + (x < view.frozenWidth ? 0 : view.scrollLeft)));
    return { row, col };
  }

  function onPointerDown(event: PointerEvent): void {
    if (event.target === editor || event.button !== 0 || event.altKey) return;
    const cell = pointerCell(event);
    if (!cell) return;
    event.preventDefault();
    if (!finishEdit(true)) return;
    if (!engine.getCellPermission(cell.row, cell.col).selectable) return;
    scroller.focus({ preventScroll: true });
    try { select(cell.row, cell.col, event.shiftKey, true, !event.shiftKey && (event.ctrlKey || event.metaKey || addNextSelection)); }
    catch (error) {
      actionError.textContent = error instanceof Error ? error.message : 'Unable to add selection.';
      actionError.style.display = 'block';
      return;
    }
    if (event.pointerType !== 'touch') {
      dragPointer = event.pointerId;
      scroller.setPointerCapture(event.pointerId);
    }
  }

  function onPointerMove(event: PointerEvent): void {
    // drag extends on pointer movement; a frame loop would enable stationary edge auto-scroll.
    if (event.pointerId !== dragPointer) return;
    const cell = pointerCell(event, true);
    if (cell) select(cell.row, cell.col, true);
  }

  function onPointerEnd(): void { dragPointer = null; }

  function onKeyDown(event: KeyboardEvent): void {
    const selection = engine.getSelection();
    if ((event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey)) && selection) {
      event.preventDefault();
      const bounds = scroller.getBoundingClientRect();
      const rect = viewport().cellRect(selection.rowIndex, selection.columnIndex);
      openMenu(selection.rowIndex, selection.columnIndex, bounds.left + Math.max(rect.clip.x, rect.x),
        bounds.top + Math.min(rect.clip.y + rect.clip.height, rect.y + rect.height));
      return;
    }
    if (event.isComposing || event.altKey) return;
    const control = event.ctrlKey || event.metaKey;
    if (event.key === 'F8' && event.shiftKey && !control) {
      event.preventDefault();
      addNextSelection = !addNextSelection;
      announceSelection();
      return;
    }
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
      addNextSelection = false;
      if (selection) {
        event.preventDefault();
        engine.clearSelection();
        scroller.setAttribute('aria-label', viewportLabel);
        options.onSelectionChange?.(null);
        options.onSelectionRangeChange?.(null);
        options.onSelectionRangesChange?.([]);
      }
      announceSelection();
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
    try { select(Math.max(0, Math.min(rowCount - 1, row)), Math.max(0, Math.min(columns.length - 1, col)), event.shiftKey, true, addNextSelection && !event.shiftKey); }
    catch (error) {
      actionError.textContent = error instanceof Error ? error.message : 'Unable to add selection.';
      actionError.style.display = 'block';
    }
  }

  function cell(value: unknown, x: number, y: number, width: number, height: number, header: boolean, rowIndex = 0, columnIndex = 0): void {
    const ctx = context!;
    ctx.clearRect(x, y, width, height);
    ctx.fillStyle = header ? theme.headerBackground : theme.background;
    ctx.fillRect(x, y, width, height);
    ctx.strokeStyle = theme.gridLineColor;
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, width, height);
    if (!header && options.renderCell) {
      let handled = false;
      ctx.save();
      try {
        ctx.beginPath();
        ctx.rect(x + 1, y + 1, Math.max(0, width - 2), Math.max(0, height - 2));
        ctx.clip();
        handled = options.renderCell(ctx, Object.freeze({ value, rowIndex, rowId: dataSource.getRowId(rowIndex),
          columnIndex, columnKey: columns[columnIndex]!.key, x, y, width, height }));
      } catch (error) {
        win.console.error('Cell renderer failed.', error);
      } finally {
        ctx.restore();
        ctx.beginPath();
      }
      if (handled) return;
      ctx.clearRect(x + 1, y + 1, Math.max(0, width - 2), Math.max(0, height - 2));
      ctx.fillStyle = theme.background;
      ctx.fillRect(x + 1, y + 1, Math.max(0, width - 2), Math.max(0, height - 2));
    }
    ctx.save();
    ctx.beginPath();
    ctx.rect(x + 8, y, Math.max(0, width - 16), height);
    ctx.clip();
    ctx.fillStyle = header ? theme.headerTextColor : theme.textColor;
    ctx.font = header ? theme.headerFont : theme.font;
    ctx.textBaseline = 'middle';
    ctx.fillText(value == null ? '' : String(value), x + 10, y + height / 2);
    ctx.restore();
  }

  function viewport() {
    return engine.getViewport({ width: scroller.clientWidth, height: scroller.clientHeight, scrollLeft: scroller.scrollLeft, scrollTop: scroller.scrollTop });
  }

  function positionEditor(): void {
    const selection = engine.getSelection();
    if (!editor || !selection) return;
    const rect = viewport().cellRect(selection.rowIndex, selection.columnIndex);
    const clip = rect.clip;
    editorPane.style.left = `${clip.x}px`;
    editorPane.style.top = `${headerHeight + clip.y}px`;
    editorPane.style.width = `${clip.width}px`;
    editorPane.style.height = `${clip.height}px`;
    editor.style.left = `${rect.x - clip.x}px`;
    editor.style.top = `${rect.y - clip.y}px`;
    editor.style.width = `${rect.width}px`;
    editor.style.height = `${rect.height}px`;
  }

  function clipRegion(region: ViewportRegion): void {
    const clip = region.clip;
    context!.beginPath();
    context!.rect(clip.x, headerHeight + clip.y, clip.width, clip.height);
    context!.clip();
  }

  function draw(): void {
    frame = undefined;
    if (destroyed) return;
    const view = viewport();
    if (!fullDraw) {
      for (const change of dirty.values()) {
        const col = columns.findIndex(column => column.key === change.columnKey);
        const rect = view.cellRect(change.rowIndex, col);
        const clip = rect.clip;
        if (rect.x >= clip.x + clip.width || rect.x + rect.width <= clip.x || rect.y >= clip.y + clip.height || rect.y + rect.height <= clip.y || clip.width <= 0 || clip.height <= 0) continue;
        context!.save();
        context!.beginPath();
        context!.rect(clip.x, headerHeight + clip.y, clip.width, clip.height);
        context!.clip();
        context!.beginPath();
        context!.rect(rect.x, headerHeight + rect.y, rect.width, rect.height);
        context!.clip();
        const value = engine.getValue(change.rowIndex, change.columnKey);
        cell(value, rect.x, headerHeight + rect.y, rect.width, rect.height, false, change.rowIndex, col);
        drawSelection(view.regions);
        context!.restore();
      }
      dirty.clear();
      return;
    }
    fullDraw = false;
    dirty.clear();
    const ratio = win.devicePixelRatio || 1;
    const height = Math.min(root.clientHeight, view.height + headerHeight);
    canvas.width = Math.max(0, Math.round(view.width * ratio));
    canvas.height = Math.max(0, Math.round(height * ratio));
    canvas.style.width = `${view.width}px`;
    canvas.style.height = `${height}px`;
    context!.setTransform(ratio, 0, 0, ratio, 0, 0);
    context!.clearRect(0, 0, view.width, height);
    for (const region of view.regions) {
      context!.save();
      clipRegion(region);
      for (let row = region.rows.start; row < region.rows.end; row++) {
        for (let col = region.columns.start; col < region.columns.end; col++) {
          const value = engine.getValue(row, columns[col]!.key);
          cell(value, columnAxis.position(col) + region.offsetX,
            headerHeight + rowAxis.position(row) + region.offsetY, columnAxis.size(col), rowAxis.size(row), false, row, col);
        }
      }
      context!.restore();
    }
    drawSelection(view.regions);
    const fixed = columnAxis.range(0, view.frozenWidth);
    const moving = columnAxis.range(columnAxis.position(engine.frozenColumns) + view.scrollLeft, view.width - view.frozenWidth);
    for (const band of [
      { start: 0, end: Math.min(engine.frozenColumns, fixed.end), x: 0, width: view.frozenWidth, offset: 0 },
      { start: Math.max(engine.frozenColumns, moving.start), end: moving.end, x: view.frozenWidth, width: view.width - view.frozenWidth, offset: -view.scrollLeft },
    ]) {
      if (band.width <= 0) continue;
      context!.save();
      context!.beginPath();
      context!.rect(band.x, 0, band.width, headerHeight);
      context!.clip();
      for (let col = band.start; col < band.end; col++) cell(columns[col]!.title, columnAxis.position(col) + band.offset, 0, columnAxis.size(col), headerHeight, true);
      context!.restore();
    }
  }

  function drawSelection(regions: readonly ViewportRegion[]): void {
    const selection = engine.getSelection();
    const ranges = getSelectionRanges();
    if (!selection || !ranges.length) return;
    for (const region of regions) {
      context!.save();
      clipRegion(region);
      context!.strokeStyle = theme.selectionColor;
      context!.lineWidth = 2;
      for (const range of ranges) context!.strokeRect(columnAxis.position(range.startColumn) + region.offsetX + 1,
        headerHeight + rowAxis.position(range.startRow) + region.offsetY + 1,
        Math.max(0, columnAxis.position(range.endColumn + 1) - columnAxis.position(range.startColumn) - 2),
        Math.max(0, rowAxis.position(range.endRow + 1) - rowAxis.position(range.startRow) - 2));
      if (ranges.length > 1 || ranges[0]!.startRow !== ranges[0]!.endRow || ranges[0]!.startColumn !== ranges[0]!.endColumn) {
        // The active cell belongs to only one pane; never project it into another.
        if (selection.rowIndex >= region.rows.start && selection.rowIndex < region.rows.end && selection.columnIndex >= region.columns.start && selection.columnIndex < region.columns.end) {
          context!.strokeRect(columnAxis.position(selection.columnIndex) + region.offsetX + 1,
            headerHeight + rowAxis.position(selection.rowIndex) + region.offsetY + 1,
            Math.max(0, columnAxis.size(selection.columnIndex) - 2), Math.max(0, rowAxis.size(selection.rowIndex) - 2));
        }
      }
      context!.restore();
    }
  }

  function render(): void {
    positionEditor();
    closeMenu();
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
  scroller.addEventListener('contextmenu', onContextMenu);
  root.addEventListener('pointerdown', onHeaderPointerDown);
  root.addEventListener('pointermove', onHeaderPointerMove);
  root.addEventListener('pointerup', endResize);
  root.addEventListener('pointercancel', endResize);
  root.addEventListener('lostpointercapture', endResize);
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
    const cell = pointerCell(event);
    const selection = engine.getSelection();
    if (event.target !== editor && cell && selection?.rowIndex === cell.row && selection.columnIndex === cell.col && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) beginEdit();
  }
  return {
    render,
    updateCells,
    undo: () => replay(false),
    redo: () => replay(true),
    getCellPermission: engine.getCellPermission,
    getSelection,
    getSelectionRange,
    getSelectionRanges,
    copySelection,
    paste,
    setColumnWidth: (index, width) => resizeAxis(columnAxis, index, width),
    setRowHeight: (index, height) => resizeAxis(rowAxis, index, height),
    destroy() {
      if (destroyed) return;
      engine.destroy();
      destroyed = true;
      closeMenu();
      sizeDialog?.remove();
      sizeDialog = null;
      endResize();
      root.removeEventListener('pointerdown', onHeaderPointerDown);
      root.removeEventListener('pointermove', onHeaderPointerMove);
      root.removeEventListener('pointerup', endResize);
      root.removeEventListener('pointercancel', endResize);
      root.removeEventListener('lostpointercapture', endResize);
      scroller.removeEventListener('contextmenu', onContextMenu);
      dirty.clear();
      const input = editor;
      editor = null;
      input?.remove();
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
