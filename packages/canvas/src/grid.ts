import { createGridEngine } from '@acheron-grid/core';
import type { CellUpdate, DataSource, Column, CellSelection, SelectionRange, CellPermission, CellLockTarget, CellFormatTarget, CellFormat, CellFormatPatch, LocalViewOptions, GridEngineOptions, ViewportRegion } from '@acheron-grid/core';

let editorId = 0;
let gridId = 0;

export type { Column, CellSelection, SelectionRange, CellLockTarget, CellFormatTarget, CellFormat, CellFormatPatch } from '@acheron-grid/core';
export interface CellRenderInfo {
  readonly value: unknown;
  readonly format: Readonly<CellFormat>;
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
export type ColumnEditor = { readonly type: 'select'; readonly values: readonly string[] } | { readonly type: 'checkbox' };
export interface GridOptions extends Pick<GridEngineOptions, 'permissions' | 'resolveCellPermission' | 'onEvent' | 'allowLockChanges' | 'frozenRows' | 'frozenColumns'> {
  view?: LocalViewOptions;
  onViewChange?: (view: LocalViewOptions) => void;
  theme?: Partial<GridTheme>;
  imageColumns?: readonly string[];
  columnEditors?: Readonly<Record<string, ColumnEditor>>;
  multilineEditor?: boolean;
  wrapText?: boolean;
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
  openSearch(): void;
  selectColumn(index: number): void;
  selectRow(index: number): void;
  readonly frozenRows: number;
  readonly frozenColumns: number;
  setFrozen(rows: number, columns: number): void;
  isLocked(target: CellLockTarget): boolean;
  canManageLocks(): boolean;
  setLocked(target: CellLockTarget, locked: boolean): void;
  getFormat(rowIndex: number, columnIndex: number): Readonly<CellFormat>;
  canFormat(targets: readonly CellFormatTarget[]): boolean;
  format(targets: readonly CellFormatTarget[], patch: CellFormatPatch | null): void;
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
  const indicatorPolicy = Object.freeze({ ...options.permissions });
  const headerHeight = options.headerHeight ?? 36;
  if (!Number.isFinite(headerHeight) || headerHeight <= 0) throw new RangeError('Grid sizes must be positive finite numbers.');
  const engine = createGridEngine({ columns: options.columns, dataSource,
    ...(options.rowHeight === undefined ? {} : { rowHeight: options.rowHeight }),
    ...(options.columnWidth === undefined ? {} : { columnWidth: options.columnWidth }),
    ...(options.permissions === undefined ? {} : { permissions: options.permissions }),
    ...(options.resolveCellPermission === undefined ? {} : { resolveCellPermission: options.resolveCellPermission }),
    ...(options.onEvent === undefined ? {} : { onEvent: options.onEvent }),
    ...(options.allowLockChanges === undefined ? {} : { allowLockChanges: options.allowLockChanges }),
    ...(options.frozenRows === undefined ? {} : { frozenRows: options.frozenRows }),
    ...(options.frozenColumns === undefined ? {} : { frozenColumns: options.frozenColumns }),
    onInvalidate(change) {
    if (change.type === 'cells') { invalidate(change.cells); if (!searchBar.hidden) refreshSearch(); }
    else if (change.type === 'layout') {
      spacer.style.width = String(columnAxis.position(columns.length)) + 'px';
      spacer.style.height = String(rowAxis.position(rowCount)) + 'px';
      render();
    } else render();
  } });
  const { columns, rowCount, rows: rowAxis, columnsLayout: columnAxis } = engine;
  if (options.imageColumns !== undefined && !Array.isArray(options.imageColumns)) throw new TypeError('Image columns must be column keys.');
  const imageColumns = new Set(options.imageColumns ?? []);
  for (const key of imageColumns) if (!columns.some(column => column.key === key)) throw new TypeError('Unknown image column.');
  const imageCache = new Map<string, { image: HTMLImageElement; state: 'loading' | 'ready' | 'error' }>();
  const visibleImages = new Set<string>();
  const columnEditors = new Map<string, ColumnEditor>();
  for (const [key, config] of Object.entries(options.columnEditors ?? {})) {
    const column = columns.find(column => column.key === key);
    if (!column || !config || !['select', 'checkbox'].includes(config.type)) throw new TypeError('Invalid column editor configuration.');
    if (config.type === 'select') {
      if (!Array.isArray(config.values) || !config.values.length || config.values.some(value => typeof value !== 'string' || !value) || new Set(config.values).size !== config.values.length) throw new TypeError('Select values must be nonempty unique strings.');
      columnEditors.set(key, Object.freeze({ type: 'select', values: Object.freeze([...config.values]) }));
    } else {
      if (column.editable && typeof column.parse !== 'function') throw new TypeError('Checkbox columns require a boolean parser.');
      columnEditors.set(key, Object.freeze({ type: 'checkbox' }));
    }
  }
  const root = doc.createElement('div');
  root.style.cssText = 'position:relative;width:100%;height:100%;overflow:hidden;background:var(--acheron-background)';
  for (const [key, value] of Object.entries(theme)) root.style.setProperty('--acheron-' + key.replace(/[A-Z]/g, letter => '-' + letter.toLowerCase()), value);
  const scroller = doc.createElement('div');
  const viewportLabel = dataSource.setValue && columns.some(column => column.editable) ? 'Data grid viewport' : 'Read-only data grid viewport';
  scroller.style.cssText = `position:absolute;inset:${headerHeight}px 0 0;overflow:auto;overscroll-behavior:contain`;
  scroller.tabIndex = 0;
  scroller.setAttribute('aria-label', viewportLabel);
  scroller.setAttribute('aria-keyshortcuts', 'Shift+F8 Control+f Meta+f');
  scroller.setAttribute('role', 'grid');
  scroller.setAttribute('aria-rowcount', String(rowCount));
  scroller.setAttribute('aria-colcount', String(columns.length));
  scroller.setAttribute('aria-multiselectable', 'true');
  const activeRow = doc.createElement('div');
  activeRow.setAttribute('role', 'row');
  activeRow.style.cssText = 'position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);pointer-events:none';
  activeRow.hidden = true;
  const activeCell = doc.createElement('div');
  activeCell.id = `acheron-active-cell-${++gridId}`;
  activeCell.setAttribute('role', 'gridcell');
  activeCell.setAttribute('aria-selected', 'true');
  activeRow.append(activeCell);
  const spacer = doc.createElement('div');
  spacer.setAttribute('aria-hidden', 'true');
  spacer.style.width = `${columnAxis.position(columns.length)}px`;
  spacer.style.position = 'relative';
  spacer.style.height = `${rowAxis.position(rowCount)}px`;
  scroller.append(spacer, activeRow);
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
  let activeDialog: HTMLDialogElement | null = null;
  let resizing: { pointerId: number; axis: 'column' | 'row'; index: number; start: number; size: number; proposed: number; edge: number } | null = null;
  const resizeGuide = doc.createElement('div');
  resizeGuide.setAttribute('aria-hidden', 'true');
  resizeGuide.setAttribute('data-grid-resize-guide', '');
  resizeGuide.style.cssText = 'display:none;position:absolute;pointer-events:none;z-index:3;background:var(--acheron-selection-color)';
  root.append(resizeGuide);
  const freezeVertical = doc.createElement('div');
  const freezeHorizontal = doc.createElement('div');
  for (const line of [freezeVertical, freezeHorizontal]) {
    line.setAttribute('aria-hidden', 'true'); line.style.cssText = 'position:absolute;pointer-events:none;z-index:2;background:var(--acheron-selection-color);opacity:.7'; root.append(line);
  }
  freezeVertical.dataset.gridFreezeLine = 'column'; freezeHorizontal.dataset.gridFreezeLine = 'row';
  const actionError = doc.createElement('div');
  actionError.setAttribute('role', 'alert');
  actionError.style.cssText = 'display:none;position:absolute;bottom:20px;left:12px;right:24px;z-index:2;padding:10px;background:#fff1f2;color:#9f1239;border:1px solid #fda4af;border-radius:6px;font:13px system-ui';
  root.append(actionError);
  const editorError = doc.createElement('div');
  editorError.id = `acheron-editor-error-${++editorId}`;
  editorError.setAttribute('role', 'alert');
  editorError.style.cssText = 'display:none;position:absolute;pointer-events:none;z-index:3;padding:8px;border:1px solid #fda4af;border-radius:4px;background:#fff1f2;color:#9f1239;font:13px system-ui';
  root.append(editorError);
  const selectionStatus = doc.createElement('div');
  selectionStatus.setAttribute('role', 'status');
  selectionStatus.style.cssText = 'position:absolute;width:1px;height:1px;overflow:hidden;clip-path:inset(50%);white-space:nowrap';
  root.append(selectionStatus);

  const searchBar = doc.createElement('div');
  searchBar.hidden = true;
  searchBar.setAttribute('role', 'search');
  searchBar.setAttribute('aria-label', 'Find in grid');
  searchBar.style.cssText = 'position:absolute;top:4px;right:20px;max-width:calc(100% - 24px);z-index:4;padding:6px;border:1px solid var(--acheron-grid-line-color);border-radius:6px;background:var(--acheron-background);color:var(--acheron-text-color);font:var(--acheron-font);box-shadow:0 4px 12px #0f172a26';
  const searchInput = doc.createElement('input');
  searchInput.type = 'search';
  searchInput.setAttribute('aria-label', 'Find in grid');
  searchInput.style.cssText = 'width:140px;max-width:35vw;padding:4px;font:inherit';
  const searchStatus = doc.createElement('span');
  searchStatus.setAttribute('role', 'status');
  searchStatus.style.cssText = 'display:inline-block;padding:0 8px';
  const searchPrevious = doc.createElement('button');
  const searchNext = doc.createElement('button');
  const searchClose = doc.createElement('button');
  for (const [button, label, text] of [[searchPrevious, 'Previous match', '↑'], [searchNext, 'Next match', '↓'], [searchClose, 'Close search', '×']] as const) {
    button.type = 'button'; button.textContent = text; button.setAttribute('aria-label', label);
    button.style.cssText = 'padding:4px 8px;margin-left:2px;font:inherit;color:inherit;background:var(--acheron-background);border:1px solid var(--acheron-grid-line-color);border-radius:3px';
  }
  searchBar.append(searchInput, searchStatus, searchPrevious, searchNext, searchClose);
  root.append(searchBar);
  const searchMatches = new Set<number>();
  let searchCurrent = -1;
  let searchTimer: number | undefined;

  function updateSearchStatus(): void {
    let ordinal = 0;
    for (const index of searchMatches) { ordinal++; if (index === searchCurrent) break; }
    searchStatus.textContent = searchMatches.size ? `${ordinal} of ${searchMatches.size}` : searchInput.value ? 'No matches' : 'Find text';
    searchPrevious.disabled = searchNext.disabled = !searchMatches.size;
  }

  function refreshSearch(navigate = false): void {
    if (searchTimer !== undefined) win.clearTimeout(searchTimer);
    searchTimer = undefined;
    if (destroyed || searchBar.hidden) return;
    searchMatches.clear();
    const query = searchInput.value.toLocaleLowerCase();
    try {
      if (query) for (let row = 0; row < rowCount; row++) for (let col = 0; col < columns.length; col++) {
        const value = engine.getValue(row, columns[col]!.key);
        if (value != null && String(value).toLocaleLowerCase().includes(query) && engine.getCellPermission(row, col).selectable) searchMatches.add(row * columns.length + col);
      }
      if (!searchMatches.has(searchCurrent)) searchCurrent = searchMatches.values().next().value ?? -1;
      updateSearchStatus();
      if (navigate && searchCurrent >= 0) select(Math.floor(searchCurrent / columns.length), searchCurrent % columns.length);
    } catch (error) {
      searchMatches.clear(); searchCurrent = -1;
      searchPrevious.disabled = searchNext.disabled = true;
      searchStatus.textContent = error instanceof Error ? error.message : 'Search failed.';
    }
    render();
  }

  function moveSearch(backward = false): void {
    if (!finishEdit(true)) return;
    const pending = searchTimer !== undefined;
    refreshSearch(pending);
    if (!searchMatches.size || (pending && !backward)) return;
    let next = backward ? [...searchMatches].at(-1)! : searchMatches.values().next().value!;
    for (const index of searchMatches) {
      if (backward && index < searchCurrent) next = index;
      if (!backward && index > searchCurrent) { next = index; break; }
    }
    searchCurrent = next;
    select(Math.floor(next / columns.length), next % columns.length);
    updateSearchStatus(); render();
  }

  function openSearch(): void {
    if (destroyed || activeDialog?.open || !finishEdit(true)) return;
    closeMenu(); endResize(); searchBar.hidden = false;
    refreshSearch(); searchInput.focus({ preventScroll: true }); searchInput.select();
  }

  function closeSearch(): void {
    if (searchTimer !== undefined) win.clearTimeout(searchTimer);
    searchTimer = undefined; searchBar.hidden = true; searchMatches.clear(); searchCurrent = -1;
    render(); scroller.focus({ preventScroll: true });
  }

  function searchShortcut(event: KeyboardEvent): void {
    if (!event.isComposing && (event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 'f') {
      event.preventDefault(); event.stopPropagation(); openSearch();
    }
  }
  searchInput.addEventListener('input', () => {
    if (searchTimer !== undefined) win.clearTimeout(searchTimer);
    searchCurrent = -1;
    searchTimer = win.setTimeout(() => refreshSearch(true), 150);
  });
  searchBar.addEventListener('keydown', event => {
    if (event.isComposing) return;
    if (event.key === 'Escape') { event.preventDefault(); closeSearch(); }
    if (event.key === 'Enter') { event.preventDefault(); moveSearch(event.shiftKey); }
    event.stopPropagation();
  });
  searchPrevious.addEventListener('click', () => moveSearch(true));
  searchNext.addEventListener('click', () => moveSearch());
  searchClose.addEventListener('click', closeSearch);

  function announceSelection(): void {
    const selection = engine.getSelection();
    selectionStatus.textContent = `${selection ? `Row ${selection.rowIndex + 1}, ${columns[selection.columnIndex]!.title}. ${getSelectionRanges().length} selected range(s).` : 'Selection cleared.'}${addNextSelection ? ' Next click or navigation adds a range.' : ''}`;
  }

  function openSizeDialog(label: string, current: number, apply: (size: number) => void): void {
    const dialog = doc.createElement('dialog');
    activeDialog?.remove();
    activeDialog = dialog;
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
      if (activeDialog === dialog) activeDialog = null;
      if (!destroyed && !editor) scroller.focus({ preventScroll: true });
    });
    root.append(dialog);
    dialog.showModal();
    input.focus(); input.select();
  }

  function format(targets: readonly CellFormatTarget[], patch: CellFormatPatch | null): void {
    if (destroyed) throw new Error('Grid is destroyed.');
    if (editor) throw new Error('Finish editing before changing formatting.');
    engine.format(targets, patch);
  }

  function openFormatDialog(row: number, col: number): void {
    const ranges = getSelectionRanges();
    const dialog = doc.createElement('dialog'); activeDialog?.remove(); activeDialog = dialog;
    dialog.setAttribute('aria-label', 'Format cells');
    dialog.style.cssText = 'padding:20px;border:1px solid var(--acheron-grid-line-color);border-radius:8px;background:var(--acheron-background);color:var(--acheron-text-color);font:var(--acheron-font)';
    const form = doc.createElement('form');
    const scopeLabel = doc.createElement('label'); scopeLabel.textContent = 'Apply to ';
    const scope = doc.createElement('select');
    for (const [value, label] of [['selection', 'Selected cells'], ['row', 'This row'], ['column', 'This column'], ['table', 'Whole table']]) {
      const option = doc.createElement('option'); option.value = value!; option.textContent = label!; scope.append(option);
    }
    scopeLabel.append(scope); form.append(scopeLabel);
    function field(label: string, value: string, checked: boolean) {
      const line = doc.createElement('div'); line.style.cssText = 'display:flex;gap:12px;align-items:center;margin:16px 0';
      const apply = doc.createElement('input'); apply.type = 'checkbox'; apply.checked = checked;
      const applyLabel = doc.createElement('label'); applyLabel.append(apply, ` Change ${label.toLowerCase()}`);
      const color = doc.createElement('input'); color.type = 'color'; color.value = value; color.setAttribute('aria-label', label);
      line.append(applyLabel, color); form.append(line); return { apply, color };
    }
    const background = field('Background color', '#fff4b3', true);
    const text = field('Text color', '#0f172a', false);
    const error = doc.createElement('div'); error.setAttribute('role', 'alert'); error.style.cssText = 'color:#9f1239;margin-bottom:12px'; error.hidden = true;
    const save = doc.createElement('button'); save.type = 'submit'; save.textContent = 'Apply';
    const clear = doc.createElement('button'); clear.type = 'button'; clear.textContent = 'Clear formatting';
    const cancel = doc.createElement('button'); cancel.type = 'button'; cancel.textContent = 'Cancel';
    for (const button of [save, clear, cancel]) button.style.cssText = 'padding:6px 12px;margin-right:8px';
    function targets(): CellFormatTarget[] {
      if (scope.value === 'row') return [{ scope: 'row', rowIndex: row }];
      if (scope.value === 'column') return [{ scope: 'column', columnIndex: col }];
      if (scope.value === 'table') return [{ scope: 'table' }];
      return ranges.map(range => ({ scope: 'range', range }));
    }
    function checkPermission(): void {
      const allowed = engine.canFormat(targets()); save.disabled = clear.disabled = !allowed;
      error.hidden = allowed; error.textContent = allowed ? '' : 'Formatting is not allowed for this selection.';
    }
    function apply(patch: CellFormatPatch): void {
      try { format(targets(), patch); dialog.close(); }
      catch (failure) { error.textContent = failure instanceof Error ? failure.message : 'Formatting failed.'; error.hidden = false; }
    }
    scope.addEventListener('change', checkPermission);
    form.addEventListener('submit', event => {
      event.preventDefault();
      if (!background.apply.checked && !text.apply.checked) { error.textContent = 'Choose a color to change.'; error.hidden = false; return; }
      apply({ ...(background.apply.checked ? { background: background.color.value } : {}), ...(text.apply.checked ? { textColor: text.color.value } : {}) });
    });
    clear.addEventListener('click', () => apply({ background: null, textColor: null }));
    cancel.addEventListener('click', () => dialog.close());
    dialog.addEventListener('close', () => { dialog.remove(); if (activeDialog === dialog) activeDialog = null; if (!destroyed && !editor) scroller.focus({ preventScroll: true }); });
    form.append(error, save, clear, cancel); dialog.append(form); root.append(dialog); checkPermission(); dialog.showModal(); scope.focus();
  }

  function setLocked(target: CellLockTarget, locked: boolean): void {
    if (destroyed) throw new Error('Grid is destroyed.');
    if (editor) throw new Error('Finish editing before changing locks.');
    engine.setLocked(target, locked);
  }

  function setFrozen(rows: number, columns: number): void {
    if (destroyed) throw new Error('Grid is destroyed.');
    if (editor) throw new Error('Finish editing before changing frozen panes.');
    engine.setFrozen(rows, columns);
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

  function openMenu(row: number, col: number, x: number, y: number, header = false): void {
    closeMenu();
    const range = getSelectionRange();
    if (rowCount && (!range || row < range.startRow || row > range.endRow || col < range.startColumn || col > range.endColumn)) select(row, col, false, false);
    if (destroyed || (rowCount > 0 && !engine.getCellPermission(row, col).selectable)) return;
    const selection = engine.getSelection() ?? (header ? { rowIndex: 0, columnIndex: col, columnKey: columns[col]!.key, rowId: 0 } : null);
    if (!selection) return;
    const popup = doc.createElement('div');
    menu = popup;
    popup.popover = 'auto';
    popup.setAttribute('role', 'menu');
    popup.setAttribute('aria-label', header ? 'Column actions' : 'Cell actions');
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
    item('Copy', rowCount > 0 && getSelectionRanges().length === 1 && engine.getCellPermission(selection.rowIndex, selection.columnIndex).copyable && !!win.navigator.clipboard?.writeText, () => win.navigator.clipboard.writeText(copySelection()));
    item('Paste', !!win.navigator.clipboard?.readText && engine.canPaste(), async () => {
      const text = await win.navigator.clipboard.readText();
      if (destroyed || fingerprint !== JSON.stringify(getSelectionRanges())) throw new Error('Selection changed before paste. Try again.');
      paste(text);
    });
    if (header) {
      item('Select column', true, () => selectColumn(col));
      item('Sort ascending…', !!options.onViewChange, () => openViewDialog(col, 'asc'));
      item('Sort descending…', !!options.onViewChange, () => openViewDialog(col, 'desc'));
      item('Filter column…', !!options.onViewChange, () => openViewDialog(col));
      item('Clear sort and filters…', !!options.onViewChange, () => openViewDialog(col, 'clear'));
    } else {
      item('Select row', true, () => selectRow(row));
      item('Select column', true, () => selectColumn(col));
    }
    item('Edit cell', rowCount > 0 && engine.canEdit(selection.rowIndex, selection.columnIndex), beginEdit);
    item('Undo', engine.canUndo(), () => { replay(false); });
    item('Redo', engine.canRedo(), () => { replay(true); });
    item('Format cells…', rowCount > 0 && engine.canFormat(getSelectionRanges().map(range => ({ scope: 'range', range }))), () => openFormatDialog(row, col));
    for (const [label, target] of [
      ['cell', { scope: 'cell', rowIndex: row, columnIndex: col }],
      ['row', { scope: 'row', rowIndex: row }],
      ['column', { scope: 'column', columnIndex: col }],
      ['table', { scope: 'table' }],
    ] as const) {
      if (!rowCount && (target.scope === 'row' || target.scope === 'cell')) continue;
      const locked = engine.isLocked(target);
      item(`${locked ? 'Unlock' : 'Lock'} ${label}`, engine.canManageLocks(), () => setLocked(target, !locked));
    }
    if (rowCount > 0 && !engine.getCellPermission(row, col).writable) item('Cell is read-only', false, () => {});
    const rowsFit = rowCount > 0 && rowAxis.position(row + 1) < scroller.clientHeight;
    const columnsFit = columnAxis.position(col + 1) < scroller.clientWidth;
    item('Freeze rows through this row', rowsFit && engine.frozenRows !== row + 1, () => setFrozen(row + 1, engine.frozenColumns));
    item('Freeze columns through this column', columnsFit && engine.frozenColumns !== col + 1, () => setFrozen(engine.frozenRows, col + 1));
    item('Freeze through this cell', rowsFit && columnsFit && (engine.frozenRows !== row + 1 || engine.frozenColumns !== col + 1), () => setFrozen(row + 1, col + 1));
    item('Unfreeze rows', engine.frozenRows > 0, () => setFrozen(0, engine.frozenColumns));
    item('Unfreeze columns', engine.frozenColumns > 0, () => setFrozen(engine.frozenRows, 0));
    item('Unfreeze table', engine.frozenRows > 0 || engine.frozenColumns > 0, () => setFrozen(0, 0));
    item('Resize column…', true, () => openSizeDialog('Column width', columnAxis.size(col), size => resizeAxis(columnAxis, col, size)));
    item('Resize row…', rowCount > 0, () => openSizeDialog('Row height', rowAxis.size(row), size => resizeAxis(rowAxis, row, size)));
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

  function headerColumn(event: MouseEvent): number | null {
    const bounds = root.getBoundingClientRect(); const x = event.clientX - bounds.left; const y = event.clientY - bounds.top;
    if (x < 0 || x >= scroller.clientWidth || y < 0 || y >= headerHeight || !columns.length) return null;
    const col = columnAxis.indexAt(x + (x < viewport().frozenWidth ? 0 : scroller.scrollLeft));
    return col < columns.length ? col : null;
  }

  function onHeaderContextMenu(event: MouseEvent): void {
    const bounds = root.getBoundingClientRect();
    if (event.clientY < bounds.top || event.clientY >= bounds.top + headerHeight) return;
    event.preventDefault(); event.stopPropagation();
    const col = headerColumn(event);
    if (col === null || !finishEdit(true)) return;
    selectColumn(col);
    const selection = engine.getSelection();
    if (!rowCount || selection?.columnIndex === col) openMenu(selection?.rowIndex ?? 0, col, event.clientX, event.clientY, true);
  }

  function openViewDialog(col: number, sort?: 'asc' | 'desc' | 'clear'): void {
    if (!options.onViewChange || activeDialog?.open) return;
    const dialog = doc.createElement('dialog'); activeDialog = dialog;
    dialog.setAttribute('aria-label', sort ? 'Change row view' : 'Filter column');
    dialog.style.cssText = 'max-width:380px;padding:20px;border:1px solid var(--acheron-grid-line-color);border-radius:8px;background:var(--acheron-background);color:var(--acheron-text-color);font:var(--acheron-font)';
    const title = doc.createElement('p'); title.textContent = sort === 'clear' ? 'Show all rows in source order' : `${sort ? `Sort ${sort === 'asc' ? 'ascending' : 'descending'}` : 'Filter'}: ${columns[col]!.title}`;
    const note = doc.createElement('p'); note.textContent = 'Values stay. Changing the view resets selection, undo history, custom colors, user locks and custom sizing. Admin permissions still apply.';
    const input = doc.createElement('input'); input.type = 'search'; input.setAttribute('aria-label', 'Contains text');
    input.placeholder = 'Contains text (empty removes this filter)'; input.style.width = '100%'; input.value = options.view?.filters?.find(filter => filter.columnKey === columns[col]!.key)?.query ?? '';
    const condition = doc.createElement('select'); condition.setAttribute('aria-label', 'Filter condition');
    for (const [value, label] of [['contains', 'Contains text'], ['equals', 'Equals text'], ['not-empty', 'Has a value'], ['empty', 'Is empty']]) {
      const option = doc.createElement('option'); option.value = value!; option.textContent = label!; condition.append(option);
    }
    condition.value = options.view?.filters?.find(filter => filter.columnKey === columns[col]!.key)?.operator ?? 'contains';
    const updateInput = () => { input.disabled = condition.value === 'empty' || condition.value === 'not-empty'; };
    condition.addEventListener('change', updateInput); updateInput();
    const status = doc.createElement('p'); status.setAttribute('role', 'alert');
    const apply = doc.createElement('button'); apply.type = 'button'; apply.textContent = 'Apply view';
    const cancel = doc.createElement('button'); cancel.type = 'button'; cancel.textContent = 'Cancel'; cancel.addEventListener('click', () => dialog.close());
    const commit = () => {
      const key = columns[col]!.key;
      const filters = (options.view?.filters ?? []).filter(filter => filter.columnKey !== key);
      if (!sort && (input.value || condition.value === 'empty' || condition.value === 'not-empty')) {
        const operator = condition.value as 'contains' | 'equals' | 'not-empty' | 'empty';
        filters.push({ columnKey: key, query: input.value, operator });
      }
      const view: LocalViewOptions = sort === 'clear' ? {} : sort ? { ...options.view, sort: { columnKey: key, direction: sort } }
        : { ...options.view, filters };
      try { options.onViewChange!(view); if (dialog.isConnected) dialog.close(); }
      catch (error) { status.textContent = error instanceof Error ? error.message : 'Unable to change view.'; }
    };
    apply.addEventListener('click', commit); input.addEventListener('keydown', event => { if (event.key === 'Enter' && !event.isComposing) { event.preventDefault(); commit(); } });
    dialog.append(title, note); if (!sort) dialog.append(condition, input); dialog.append(status, apply, cancel); root.append(dialog);
    dialog.addEventListener('close', () => { dialog.remove(); if (activeDialog === dialog) activeDialog = null; if (!destroyed && !editor) scroller.focus({ preventScroll: true }); });
    dialog.showModal(); (sort ? apply : input).focus();
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
    if (engine.frozenColumns > 0 && Math.abs(columnAxis.position(engine.frozenColumns) - x) <= 8 && x <= view.width) return engine.frozenColumns - 1;
    const offset = x + (x < view.frozenWidth ? 0 : view.scrollLeft);
    const col = columnAxis.indexAt(offset);
    const first = x < view.frozenWidth ? 0 : engine.frozenColumns;
    const limit = x < view.frozenWidth ? engine.frozenColumns : columns.length;
    if (col < limit && col >= first && Math.abs(columnAxis.position(col + 1) - offset) <= 8) return col;
    if (col > first && Math.abs(columnAxis.position(col) - offset) <= 8) return col - 1;
    return null;
  }

  function rowEdge(event: PointerEvent): number | null {
    const bounds = scroller.getBoundingClientRect();
    const x = event.clientX - bounds.left;
    const y = event.clientY - bounds.top;
    if (x < 0 || x > (engine.frozenColumns ? Math.min(columnAxis.size(0), scroller.clientWidth) : 10) || y < 0 || y >= scroller.clientHeight || !rowCount || !columns.length) return null;
    const tolerance = x <= 10 ? 8 : 3;
    const view = viewport();
    if (engine.frozenRows > 0 && Math.abs(rowAxis.position(engine.frozenRows) - y) <= tolerance) return engine.frozenRows - 1;
    const offset = y + (y < view.frozenHeight ? 0 : view.scrollTop);
    const row = rowAxis.indexAt(offset);
    const first = y < view.frozenHeight ? 0 : engine.frozenRows;
    const limit = y < view.frozenHeight ? engine.frozenRows : rowCount;
    if (row < limit && row >= first && Math.abs(rowAxis.position(row + 1) - offset) <= tolerance) return row;
    if (row > first && Math.abs(rowAxis.position(row) - offset) <= tolerance) return row - 1;
    return null;
  }

  function showResizeGuide(): void {
    if (!resizing) return;
    const view = viewport();
    const position = resizing.edge + resizing.proposed - resizing.size;
    resizeGuide.dataset.axis = resizing.axis;
    resizeGuide.style.display = 'block';
    resizeGuide.style.left = resizing.axis === 'column' ? `${Math.max(0, Math.min(view.width - 2, position))}px` : '0px';
    resizeGuide.style.top = resizing.axis === 'row' ? `${Math.max(headerHeight, Math.min(headerHeight + view.height - 2, position))}px` : '0px';
    resizeGuide.style.width = resizing.axis === 'column' ? '2px' : `${view.width}px`;
    resizeGuide.style.height = resizing.axis === 'row' ? '2px' : `${headerHeight + view.height}px`;
  }

  function onHeaderPointerDown(event: PointerEvent): void {
    if (resizing) { event.preventDefault(); return; }
    if (event.button !== 0 || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || (event.target !== root && !(event.target instanceof win.Node && scroller.contains(event.target)))) return;
    const column = columnEdge(event);
    const row = column === null ? rowEdge(event) : null;
    if (column === null && row === null) {
      const col = headerColumn(event);
      if (col !== null && rowCount && finishEdit(true)) { event.preventDefault(); selectColumn(col); scroller.focus({ preventScroll: true }); }
      return;
    }
    event.preventDefault();
    if (!finishEdit(true)) return;
    closeMenu();
    const axis = column === null ? 'row' : 'column';
    const index = column ?? row!;
    const size = axis === 'column' ? columnAxis.size(index) : rowAxis.size(index);
    const view = viewport();
    const edge = axis === 'column' ? columnAxis.position(index + 1) - (index < engine.frozenColumns ? 0 : view.scrollLeft)
      : headerHeight + rowAxis.position(index + 1) - (index < engine.frozenRows ? 0 : view.scrollTop);
    resizing = { pointerId: event.pointerId, axis, index, size, proposed: size,
      start: axis === 'column' ? event.clientX : event.clientY,
      edge };
    scroller.focus({ preventScroll: true });
    root.setPointerCapture(event.pointerId);
    root.style.cursor = axis === 'column' ? 'col-resize' : 'row-resize';
    showResizeGuide();
  }

  function onHeaderPointerMove(event: PointerEvent): void {
    root.style.cursor = resizing ? (resizing.axis === 'column' ? 'col-resize' : 'row-resize')
      : columnEdge(event) !== null ? 'col-resize' : rowEdge(event) !== null ? 'row-resize' : '';
    const column = columnEdge(event);
    const cell = pointerCell(event);
    const bounds = root.getBoundingClientRect();
    const headerColumn = columnAxis.indexAt(event.clientX - bounds.left + (event.clientX - bounds.left < viewport().frozenWidth ? 0 : scroller.scrollLeft));
    root.title = root.style.cursor === 'row-resize' ? 'Drag the row boundary to resize height'
      : column !== null ? 'Drag the column boundary to resize width'
      : event.clientY - bounds.top < headerHeight && headerColumn >= 0 && headerColumn < columns.length ? stateLabels(null, headerColumn).join('; ')
      : cell ? stateLabels(cell.row, cell.col).join('; ') : '';
    if (resizing?.pointerId === event.pointerId) {
      resizing.proposed = Math.max(24, Math.min(1000, resizing.size + (resizing.axis === 'column' ? event.clientX : event.clientY) - resizing.start));
      showResizeGuide();
    }
  }

  function endResize(): void {
    const pointerId = resizing?.pointerId;
    resizing = null;
    resizeGuide.style.display = 'none';
    root.style.cursor = '';
    root.title = '';
    if (pointerId !== undefined && root.hasPointerCapture(pointerId)) root.releasePointerCapture(pointerId);
  }

  function commitResize(event: PointerEvent): void {
    if (resizing?.pointerId !== event.pointerId) return;
    const draft = resizing;
    endResize();
    try { resizeAxis(draft.axis === 'column' ? columnAxis : rowAxis, draft.index, draft.proposed); }
    catch (error) {
      actionError.textContent = error instanceof Error ? error.message : 'Unable to resize.';
      actionError.style.display = 'block';
    }
  }

  function cancelResizeKey(event: KeyboardEvent): void {
    if (resizing && event.key === 'Escape') {
      event.preventDefault(); event.stopPropagation(); endResize();
    }
  }

  function invalidate(changes: readonly { rowIndex: number; columnKey: string }[]): void {
    const selection = engine.getSelection();
    for (const change of changes) { dirty.set(JSON.stringify([change.rowIndex, change.columnKey]), change); if (imageColumns.has(change.columnKey)) fullDraw = true; }
    if (selection && changes.some(change => change.rowIndex === selection.rowIndex && change.columnKey === selection.columnKey)) syncAccessibleCell();
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
        engine.editCell(selection.rowIndex, selection.columnIndex, editor instanceof win.HTMLInputElement && editor.type === 'checkbox' ? String(editor.checked) : editor.value);
      } catch (error) {
        editor.setCustomValidity(error instanceof Error ? error.message : 'Unable to save cell.');
        editor.setAttribute('aria-invalid', 'true');
        editorError.textContent = error instanceof Error ? error.message : 'Unable to save cell.';
        editorError.style.display = 'block';
        positionEditor();
        editor.focus({ preventScroll: true });
        return false;
      }
    }
    const input = editor;
    editor = null;
    input.remove();
    editorError.style.display = 'none';
    editorError.textContent = '';
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
      const configured = columnEditors.get(column.key);
      if (!custom && configured?.type === 'select') {
        const select = doc.createElement('select');
        for (const value of configured.values) { const option = doc.createElement('option'); option.value = option.textContent = value; select.append(option); }
        select.required = true; editor = select;
      } else if (!custom && configured?.type === 'checkbox') {
        if (typeof value !== 'boolean') throw new TypeError('Checkbox cells require boolean values.');
        const checkbox = doc.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = value; editor = checkbox;
      } else editor = custom ?? doc.createElement(options.multilineEditor ? 'textarea' : 'input');
      if (!custom) editor.value = value == null ? '' : String(value);
    } catch (error) {
      actionError.textContent = error instanceof Error ? error.message : 'Unable to create cell editor.';
      actionError.style.display = 'block';
      return;
    }
    actionError.style.display = 'none';
    editor.setAttribute('aria-label', `Edit row ${selection.rowIndex + 1}, ${column.title}`);
    editor.setAttribute('aria-errormessage', editorError.id);
    editor.style.cssText = 'position:absolute;box-sizing:border-box;pointer-events:auto;border:2px solid var(--acheron-selection-color);background:var(--acheron-background);color:var(--acheron-text-color);font:var(--acheron-font);padding:0 8px';
    const cellFormat = engine.getFormat(selection.rowIndex, selection.columnIndex);
    if (cellFormat.background) editor.style.background = cellFormat.background;
    if (cellFormat.textColor) editor.style.color = cellFormat.textColor;
    if (editor instanceof win.HTMLTextAreaElement) editor.style.resize = 'none';
    const clearValidation = () => {
      editor?.setCustomValidity('');
      editor?.removeAttribute('aria-invalid');
      editorError.style.display = 'none';
      positionEditor();
    };
    editor.addEventListener('input', clearValidation);
    editor.addEventListener('change', clearValidation);
    editor.addEventListener('keydown', event => {
      if (!(event instanceof win.KeyboardEvent)) return;
      event.stopPropagation();
      if (event.isComposing || event.keyCode === 229) return;
      if (editor instanceof win.HTMLTextAreaElement && event.key === 'Enter' && (event.altKey || event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        editor.setRangeText('\n', editor.selectionStart, editor.selectionEnd, 'end');
        editor.dispatchEvent(new win.Event('input', { bubbles: true }));
        return;
      }
      if (editor instanceof win.HTMLTextAreaElement && event.key === 'Tab') {
        event.preventDefault();
        const current = engine.getSelection()!;
        if (finishEdit(true)) {
          const position = Math.max(0, Math.min(rowCount * columns.length - 1, current.rowIndex * columns.length + current.columnIndex + (event.shiftKey ? -1 : 1)));
          select(Math.floor(position / columns.length), position % columns.length);
          scroller.focus({ preventScroll: true });
        }
        return;
      }
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
    if (changed) options.onSelectionChange?.(getSelection());
    if (rangeChanged) options.onSelectionRangeChange?.(getSelectionRange());
    if (previousRanges !== JSON.stringify(getSelectionRanges())) options.onSelectionRangesChange?.(getSelectionRanges());
  }

  function selectScope(range: SelectionRange): void {
    if (destroyed) throw new Error('Grid is destroyed.');
    if (!finishEdit(true)) return;
    const previous = engine.getSelection();
    if (!engine.selectRange(range)) return;
    addNextSelection = false; announceSelection();
    const selection = engine.getSelection();
    if (previous?.rowIndex !== selection?.rowIndex || previous?.columnIndex !== selection?.columnIndex) options.onSelectionChange?.(selection);
    options.onSelectionRangeChange?.(getSelectionRange()); options.onSelectionRangesChange?.(getSelectionRanges());
  }
  function selectColumn(index: number): void {
    if (!Number.isSafeInteger(index) || index < 0 || index >= columns.length) throw new RangeError('Invalid column index.');
    if (rowCount) selectScope({ startRow: 0, endRow: rowCount - 1, startColumn: index, endColumn: index });
  }
  function selectRow(index: number): void {
    if (!Number.isSafeInteger(index) || index < 0 || index >= rowCount) throw new RangeError('Invalid row index.');
    if (columns.length) selectScope({ startRow: index, endRow: index, startColumn: 0, endColumn: columns.length - 1 });
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
    if (event.defaultPrevented || event.target === editor || event.button !== 0 || event.altKey) return;
    const cell = pointerCell(event);
    if (!cell) return;
    event.preventDefault();
    if (!finishEdit(true)) return;
    if (!engine.getCellPermission(cell.row, cell.col).selectable) return;
    scroller.focus({ preventScroll: true });
    if (event.clientX - scroller.getBoundingClientRect().left < 10) { selectRow(cell.row); return; }
    try { select(cell.row, cell.col, event.shiftKey, true, !event.shiftKey && (event.ctrlKey || event.metaKey || addNextSelection)); }
    catch (error) {
      actionError.textContent = error instanceof Error ? error.message : 'Unable to add selection.';
      actionError.style.display = 'block';
      return;
    }
    if (!event.ctrlKey && !event.metaKey && !event.shiftKey && columnEditors.get(columns[cell.col]!.key)?.type === 'checkbox') {
      const rect = viewport().cellRect(cell.row, cell.col); const bounds = scroller.getBoundingClientRect();
      const x = event.clientX - bounds.left - rect.x; const y = event.clientY - bounds.top - rect.y;
      if (x >= 8 && x <= 28 && Math.abs(y - rect.height / 2) <= 10 && engine.canEdit(cell.row, cell.col)) {
        beginEdit();
        if (editor instanceof win.HTMLInputElement && editor.type === 'checkbox') { editor.checked = !editor.checked; if (finishEdit(true)) scroller.focus({ preventScroll: true }); }
        return;
      }
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
    if (event.key === ' ' && selection && (control || event.shiftKey)) {
      event.preventDefault(); control ? selectColumn(selection.columnIndex) : selectRow(selection.rowIndex); return;
    }
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
    if (!selection && event.key === 'End') { col = columns.length - 1; if (control) row = rowCount - 1; }
    try { select(Math.max(0, Math.min(rowCount - 1, row)), Math.max(0, Math.min(columns.length - 1, col)), event.shiftKey, true, addNextSelection && !event.shiftKey); }
    catch (error) {
      actionError.textContent = error instanceof Error ? error.message : 'Unable to add selection.';
      actionError.style.display = 'block';
    }
  }

  function stateLabels(row: number | null, col: number): string[] {
    const labels: string[] = [];
    if (engine.isLocked({ scope: 'table' })) labels.push('Table locked');
    if (engine.isLocked({ scope: 'column', columnIndex: col })) labels.push('Column locked');
    if (col < engine.frozenColumns) labels.push('Column frozen');
    if (row === null) {
      const sort = options.view?.sort;
      if (sort?.columnKey === columns[col]!.key) labels.push(`Sorted ${sort.direction === 'asc' ? 'ascending' : 'descending'}`);
      const filter = options.view?.filters?.find(filter => filter.columnKey === columns[col]!.key);
      if (filter) labels.push(`Filtered: ${filter.operator ?? 'contains'} ${filter.query}`.trim());
      const policy = columns[col]!.permissions;
      if ([indicatorPolicy, policy].some(scope => scope?.writable === false || scope?.selectable === false || scope?.editable === false)) labels.push('Column disabled by permissions');
    } else {
      if (engine.isLocked({ scope: 'row', rowIndex: row })) labels.push('Row locked');
      if (engine.isLocked({ scope: 'cell', rowIndex: row, columnIndex: col })) labels.push('Cell locked');
      if (row < engine.frozenRows) labels.push('Row frozen');
      const permission = engine.getCellPermission(row, col);
      if (!permission.selectable || (!permission.writable && !labels.some(label => label.endsWith('locked'))) || (columns[col]!.editable && !permission.editable && permission.writable)) labels.push('Cell disabled by permissions');
    }
    return labels;
  }

  function cell(value: unknown, x: number, y: number, width: number, height: number, header: boolean, rowIndex = 0, columnIndex = 0): void {
    paintCell(value, x, y, width, height, header, rowIndex, columnIndex);
    const labels = stateLabels(header ? null : rowIndex, columnIndex);
    const ctx = context!;
    ctx.save(); ctx.beginPath(); ctx.rect(x + 1, y + 1, Math.max(0, width - 2), Math.max(0, height - 2)); ctx.clip();
    const range = getSelectionRange();
    if (!header && range && rowIndex >= range.startRow && rowIndex <= range.endRow && columnIndex >= range.startColumn && columnIndex <= range.endColumn &&
      ((range.startRow === 0 && range.endRow === rowCount - 1) || (range.startColumn === 0 && range.endColumn === columns.length - 1))) {
      ctx.globalAlpha = .1; ctx.fillStyle = theme.selectionColor; ctx.fillRect(x, y, width, height); ctx.globalAlpha = 1;
    }
    if (header) {
      ctx.fillStyle = theme.headerTextColor; ctx.strokeStyle = theme.headerTextColor; ctx.lineWidth = 1.2;
      if (options.view?.sort?.columnKey === columns[columnIndex]!.key) {
        const top = options.view.sort.direction === 'asc' ? y + 10 : y + 16; const base = options.view.sort.direction === 'asc' ? y + 16 : y + 10;
        ctx.beginPath(); ctx.moveTo(x + width - 28, top); ctx.lineTo(x + width - 32, base); ctx.lineTo(x + width - 24, base); ctx.closePath(); ctx.fill();
      }
      if (options.view?.filters?.some(filter => filter.columnKey === columns[columnIndex]!.key)) {
        const left = x + width - 45; ctx.beginPath(); ctx.moveTo(left, y + 10); ctx.lineTo(left + 9, y + 10); ctx.lineTo(left + 6, y + 15); ctx.lineTo(left + 6, y + 20); ctx.lineTo(left + 3, y + 18); ctx.lineTo(left + 3, y + 15); ctx.closePath(); ctx.stroke();
      }
    }
    if (labels.some(label => label.includes('disabled'))) {
      ctx.globalAlpha = .22; ctx.fillStyle = theme.background; ctx.fillRect(x, y, width, height);
      ctx.globalAlpha = .07; ctx.fillStyle = '#64748b'; ctx.fillRect(x, y, width, height); ctx.globalAlpha = 1;
    }
    const leading = columnIndex === 0 || (x <= 0 && x + width > 0);
    const locked = header ? labels.some(label => label.endsWith('locked'))
      : engine.isLocked({ scope: 'cell', rowIndex, columnIndex }) || (leading && labels.includes('Row locked'));
    if (locked && width >= 24 && height >= 20) {
      const left = x + width - 15; const top = y + 4;
      ctx.fillStyle = theme.background; ctx.fillRect(left - 2, top - 1, 14, 15);
      ctx.strokeStyle = theme.headerTextColor; ctx.lineWidth = 1.2;
      ctx.strokeRect(left, top + 6, 9, 7); ctx.beginPath(); ctx.arc(left + 4.5, top + 6, 3, Math.PI, 0); ctx.stroke();
    }
    ctx.restore();
  }

  function paintCell(value: unknown, x: number, y: number, width: number, height: number, header: boolean, rowIndex = 0, columnIndex = 0): void {
    const ctx = context!;
    ctx.clearRect(x, y, width, height);
    const format = header ? null : engine.getFormat(rowIndex, columnIndex);
    const background = format?.background ?? theme.background;
    const textColor = format?.textColor ?? theme.textColor;
    ctx.fillStyle = header ? theme.headerBackground : background;
    ctx.fillRect(x, y, width, height);
    const range = getSelectionRange();
    const wholeColumn = range && range.startRow === 0 && range.endRow === rowCount - 1 && columnIndex >= range.startColumn && columnIndex <= range.endColumn;
    if (header && wholeColumn) {
      ctx.save(); ctx.globalAlpha = .12; ctx.fillStyle = theme.selectionColor; ctx.fillRect(x, y, width, height); ctx.restore();
    }
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
        handled = options.renderCell(ctx, Object.freeze({ value, format: format!, rowIndex, rowId: dataSource.getRowId(rowIndex),
          columnIndex, columnKey: columns[columnIndex]!.key, x, y, width, height }));
      } catch (error) {
        win.console.error('Cell renderer failed.', error);
      } finally {
        ctx.restore();
        ctx.beginPath();
      }
      if (handled) { highlightSearch(x, y, width, height, rowIndex, columnIndex); return; }
      ctx.clearRect(x + 1, y + 1, Math.max(0, width - 2), Math.max(0, height - 2));
      ctx.fillStyle = background;
      ctx.fillRect(x + 1, y + 1, Math.max(0, width - 2), Math.max(0, height - 2));
    }
    if (!header && imageColumns.has(columns[columnIndex]!.key)) { imageCell(value, x, y, width, height, textColor); highlightSearch(x, y, width, height, rowIndex, columnIndex); return; }
    if (!header && columnEditors.get(columns[columnIndex]!.key)?.type === 'checkbox' && typeof value === 'boolean') {
      const size = Math.max(0, Math.min(16, width - 20, height - 8)); const left = x + 10; const top = y + (height - size) / 2;
      ctx.save(); ctx.strokeStyle = textColor; ctx.lineWidth = 1;
      if (size > 0) {
        ctx.strokeRect(left + .5, top + .5, size - 1, size - 1);
        if (value) { ctx.beginPath(); ctx.moveTo(left + size * .2, top + size * .5); ctx.lineTo(left + size * .45, top + size * .75); ctx.lineTo(left + size * .8, top + size * .25); ctx.lineWidth = 2; ctx.stroke(); }
      }
      ctx.restore(); highlightSearch(x, y, width, height, rowIndex, columnIndex); return;
    }
    ctx.save();
    ctx.beginPath();
    ctx.rect(x + 8, y, Math.max(0, width - 16), height);
    ctx.clip();
    ctx.fillStyle = header ? theme.headerTextColor : textColor;
    ctx.font = header ? theme.headerFont : theme.font;
    ctx.textBaseline = 'middle';
    const text = value == null ? '' : String(value);
    if (!header && options.wrapText) {
      ctx.textBaseline = 'top';
      const metrics = ctx.measureText('M');
      const lineHeight = Math.ceil(metrics.fontBoundingBoxAscent + metrics.fontBoundingBoxDescent) || 18;
      let line = ''; let top = y + 4;
      for (const character of text) {
        if (top + lineHeight > y + height) break;
        if (character === '\n' || (line && ctx.measureText(line + character).width > Math.max(0, width - 20))) {
          ctx.fillText(line, x + 10, top); top += lineHeight; line = '';
        }
        if (character !== '\n') line += character;
      }
      if (top + lineHeight <= y + height) ctx.fillText(line, x + 10, top);
    } else ctx.fillText(text, x + 10, y + height / 2);
    ctx.restore();
    if (!header) highlightSearch(x, y, width, height, rowIndex, columnIndex);
  }

  function imageCell(value: unknown, x: number, y: number, width: number, height: number, textColor: string): void {
    if (value == null || value === '') return;
    let item: { image: HTMLImageElement; state: 'loading' | 'ready' | 'error' } | undefined;
    try {
      if (typeof value !== 'string') throw new TypeError('Image URL must be a string.');
      const url = new win.URL(value, doc.baseURI);
      if (!['http:', 'https:', 'blob:', 'data:'].includes(url.protocol) || (url.protocol === 'data:' && !/^data:image\//i.test(value))) throw new TypeError('Unsupported image URL.');
      const src = url.href;
      visibleImages.add(src); item = imageCache.get(src);
      if (!item) {
        const image = doc.createElement('img');
        const record = { image, state: 'loading' as 'loading' | 'ready' | 'error' };
        imageCache.set(src, record); item = record;
        image.crossOrigin = 'anonymous'; image.referrerPolicy = 'no-referrer'; image.decoding = 'async';
        const loaded = (state: 'ready' | 'error') => {
          if (destroyed || imageCache.get(src) !== record) return;
          record.state = state; fullDraw = true; schedule();
        };
        image.onload = () => loaded(image.naturalWidth && image.naturalHeight ? 'ready' : 'error');
        image.onerror = () => loaded('error');
        image.src = src;
      }
    } catch { /* Invalid URLs use the same unavailable state as failed image loads. */ }
    const ctx = context!;
    ctx.save(); ctx.beginPath(); ctx.rect(x + 1, y + 1, Math.max(0, width - 2), Math.max(0, height - 2)); ctx.clip();
    if (item?.state === 'ready') {
      const image = item.image;
      const ratio = Math.max(0, Math.min((width - 16) / image.naturalWidth, (height - 8) / image.naturalHeight));
      const w = image.naturalWidth * ratio; const h = image.naturalHeight * ratio;
      if (ratio > 0) ctx.drawImage(image, x + (width - w) / 2, y + (height - h) / 2, w, h);
    } else {
      ctx.font = theme.font; ctx.fillStyle = textColor; ctx.textBaseline = 'middle';
      ctx.fillText(item?.state === 'loading' ? 'Loading…' : 'Image unavailable', x + 8, y + height / 2);
    }
    ctx.restore(); ctx.beginPath();
  }

  function highlightSearch(x: number, y: number, width: number, height: number, row: number, col: number): void {
    if (!searchMatches.has(row * columns.length + col)) return;
    context!.save(); context!.strokeStyle = '#d97706'; context!.lineWidth = 2;
    context!.strokeRect(x + 3, y + 3, Math.max(0, width - 6), Math.max(0, height - 6)); context!.restore();
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
    const hidden = rect.x + rect.width <= clip.x || rect.x >= clip.x + clip.width || rect.y + rect.height <= clip.y || rect.y >= clip.y + clip.height;
    editorPane.style.clipPath = hidden ? 'inset(100%)' : '';
    if (editor instanceof win.HTMLTextAreaElement) {
      context!.save(); context!.font = theme.font;
      let width = rect.width;
      for (const line of editor.value.split('\n')) width = Math.max(width, context!.measureText(line).width + 24);
      context!.restore();
      editor.style.width = `${Math.min(width, Math.max(1, clip.width - Math.max(0, rect.x - clip.x)))}px`;
      editor.style.height = '0px';
      editor.style.height = `${Math.min(Math.max(rect.height, editor.scrollHeight + 4), Math.max(1, clip.height - Math.max(0, rect.y - clip.y)))}px`;
    }
    if (editorError.style.display !== 'none') {
      editorError.style.maxWidth = `${clip.width}px`;
      editorError.style.visibility = hidden ? 'hidden' : 'visible';
      editorError.style.left = `${Math.max(clip.x, Math.min(rect.x, clip.x + clip.width - editorError.offsetWidth))}px`;
      editorError.style.top = `${headerHeight + Math.max(clip.y, Math.min(rect.y + editor.offsetHeight + 4, clip.y + clip.height - editorError.offsetHeight))}px`;
    }
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
    visibleImages.clear();
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
      for (let col = band.start; col < band.end; col++) cell(columns[col]!.title, columnAxis.position(col) + band.offset, 0, columnAxis.size(col), headerHeight, true, 0, col);
      context!.restore();
    }
    releaseUnusedImages();
  }

  function releaseUnusedImages(): void {
    for (const [src, record] of imageCache) if (!visibleImages.has(src)) {
      record.image.onload = record.image.onerror = null; imageCache.delete(src);
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

  function syncAccessibleCell(): void {
    const selection = engine.getSelection();
    activeRow.hidden = !selection;
    if (!selection) {
      activeCell.textContent = '';
      activeRow.removeAttribute('aria-rowindex');
      activeCell.removeAttribute('aria-colindex');
      activeCell.removeAttribute('aria-readonly');
      scroller.removeAttribute('aria-activedescendant');
      scroller.setAttribute('aria-label', viewportLabel);
      return;
    }
    const value = engine.getValue(selection.rowIndex, selection.columnKey);
    const text = value == null ? '' : String(value);
    const title = columns[selection.columnIndex]!.title;
    activeRow.setAttribute('aria-rowindex', String(selection.rowIndex + 1));
    activeCell.setAttribute('aria-colindex', String(selection.columnIndex + 1));
    activeCell.setAttribute('aria-readonly', String(!engine.canEdit(selection.rowIndex, selection.columnIndex)));
    const content = `${title}: ${text}`;
    activeCell.setAttribute('aria-description', stateLabels(selection.rowIndex, selection.columnIndex).join('; '));
    if (activeCell.textContent !== content) activeCell.textContent = content;
    scroller.setAttribute('aria-activedescendant', activeCell.id);
    scroller.setAttribute('aria-label', `${viewportLabel}: row ${selection.rowIndex + 1}, ${title}, ${text}`);
  }

  function render(): void {
    if (destroyed) return;
    syncAccessibleCell();
    const view = viewport();
    freezeVertical.hidden = !engine.frozenColumns || view.frozenWidth >= view.width;
    freezeVertical.style.left = `${Math.max(0, view.frozenWidth - 1)}px`; freezeVertical.style.top = '0px'; freezeVertical.style.width = '2px'; freezeVertical.style.height = `${headerHeight + view.height}px`;
    freezeHorizontal.hidden = !engine.frozenRows || view.frozenHeight >= view.height;
    freezeHorizontal.style.top = `${headerHeight + Math.max(0, view.frozenHeight - 1)}px`; freezeHorizontal.style.left = '0px'; freezeHorizontal.style.height = '2px'; freezeHorizontal.style.width = `${view.width}px`;
    endResize();
    positionEditor();
    closeMenu();
    fullDraw = true;
    schedule();
  }
  function schedule(): void {
    if (!destroyed && frame === undefined) frame = win.requestAnimationFrame(draw);
  }
  let observedWidth = root.clientWidth; let observedHeight = root.clientHeight;
  const observer = new ResizeObserver(() => {
    const width = root.clientWidth; const height = root.clientHeight;
    if (width === observedWidth && height === observedHeight) return;
    observedWidth = width; observedHeight = height; render();
  });
  observer.observe(root);
  scroller.addEventListener('scroll', render, { passive: true });
  scroller.addEventListener('pointerdown', onPointerDown);
  scroller.addEventListener('contextmenu', onContextMenu);
  root.addEventListener('contextmenu', onHeaderContextMenu);
  root.addEventListener('keydown', searchShortcut, true);
  root.addEventListener('pointerdown', onHeaderPointerDown, true);
  root.addEventListener('keydown', cancelResizeKey, true);
  root.addEventListener('pointermove', onHeaderPointerMove);
  root.addEventListener('pointerup', commitResize);
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
    if (cell && columnEditors.get(columns[cell.col]!.key)?.type === 'checkbox') return;
    if (event.target !== editor && cell && selection?.rowIndex === cell.row && selection.columnIndex === cell.col && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) beginEdit();
  }
  return {
    render: () => { if (!searchBar.hidden) refreshSearch(); else render(); },
    openSearch,
    selectColumn, selectRow,
    get frozenRows() { return engine.frozenRows; },
    get frozenColumns() { return engine.frozenColumns; },
    setFrozen,
    isLocked: engine.isLocked,
    canManageLocks: engine.canManageLocks,
    setLocked,
    getFormat: engine.getFormat,
    canFormat: engine.canFormat,
    format,
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
      if (searchTimer !== undefined) win.clearTimeout(searchTimer);
      searchMatches.clear();
      visibleImages.clear(); releaseUnusedImages();
      root.removeEventListener('contextmenu', onHeaderContextMenu);
      root.removeEventListener('keydown', searchShortcut, true);
      activeDialog?.remove();
      activeDialog = null;
      endResize();
      root.removeEventListener('pointerdown', onHeaderPointerDown, true);
      root.removeEventListener('keydown', cancelResizeKey, true);
      root.removeEventListener('pointermove', onHeaderPointerMove);
      root.removeEventListener('pointerup', commitResize);
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
