import type { CellUpdate, DataSource, RowId } from './data-source.js';
import type { Column, CellSelection, SelectionRange } from './types.js';
import { resolvePermissions } from './permissions.js';
import type { CellPermission, CellPermissionPolicy, CellPermissionResolver } from './permissions.js';
import type { GridEvent, GridChangeSource } from './events.js';
import { GridAxis } from './axis.js';
import { createViewport } from './panes.js';
import type { ViewportOptions } from './panes.js';
import { clipboardCellLimit, clipboardTextLimit, decodeTsv, encodeTsv } from './tsv.js';

export type GridInvalidation =
  | { readonly type: 'cells'; readonly cells: readonly { readonly rowIndex: number; readonly columnKey: string }[] }
  | { readonly type: 'selection'; readonly changed: boolean; readonly rangeChanged: boolean }
  | { readonly type: 'layout' };

export interface GridEngineOptions {
  columns: readonly Column[];
  dataSource: DataSource;
  permissions?: CellPermissionPolicy;
  resolveCellPermission?: CellPermissionResolver;
  onEvent?: (event: GridEvent) => void;
  rowHeight?: number;
  columnWidth?: number;
  frozenRows?: number;
  frozenColumns?: number;
  /** Synchronous renderer notification after state and history have committed. */
  onInvalidate?: (change: GridInvalidation) => void;
}

/** Domain state and operations. No browser globals or per-cell state allocation. */
export function createGridEngine(options: GridEngineOptions) {
  const { dataSource } = options;
  const columns = Object.freeze(options.columns.map(column => Object.freeze({ ...column, ...(column.permissions ? { permissions: Object.freeze({ ...column.permissions }) } : {}) })));
  const rowHeight = options.rowHeight ?? 32;
  const columnWidth = options.columnWidth ?? 160;
  for (const size of [rowHeight, columnWidth]) {
    if (!Number.isFinite(size) || size <= 0) throw new RangeError('Grid sizes must be positive finite numbers.');
  }
  if (new Set(columns.map(column => column.key)).size !== columns.length) throw new Error('Column keys must be unique.');
  const columnIndices = new Map(columns.map((column, index) => [column.key, index]));
  const rowCount = dataSource.getRowCount();
  if (!Number.isSafeInteger(rowCount) || rowCount < 0) throw new RangeError('Invalid row count.');
  const frozenRows = options.frozenRows ?? 0;
  const frozenColumns = options.frozenColumns ?? 0;
  for (const [count, limit] of [[frozenRows, rowCount], [frozenColumns, columns.length]] as const) {
    if (!Number.isSafeInteger(count) || count < 0 || count > limit) throw new RangeError('Invalid frozen row or column count.');
  }
  if (!Number.isFinite(rowCount * rowHeight) || !Number.isFinite(columns.length * columnWidth)) throw new RangeError('Grid dimensions overflow.');
  const rowAxis = new GridAxis(rowCount, rowHeight);
  const columnAxis = new GridAxis(columns.length, columnWidth);
  const permissions = options.permissions ? Object.freeze({ ...options.permissions }) : undefined;
  let resolver = options.resolveCellPermission;
  let onEvent = options.onEvent;
  let busy = false;
  let destroyed = false;
  let onInvalidate = options.onInvalidate;
  let selection: CellSelection | null = null;
  let anchor: CellSelection | null = null;
  type Change = CellUpdate & { previous: unknown; rowId: RowId };
  const past: Change[][] = [];
  const future: Change[][] = [];

  function assertAlive(): void {
    if (destroyed) throw new Error('Grid is destroyed.');
  }

  function command<T>(run: () => T): T {
    if (busy) throw new Error('Nested grid mutations are not allowed.');
    busy = true;
    try { return run(); } finally { busy = false; }
  }

  function query<T>(run: () => T): T {
    const wasBusy = busy;
    busy = true;
    try { return run(); } finally { busy = wasBusy; }
  }

  function notify(change: GridInvalidation, event: GridEvent): void {
    let failed = false;
    let firstError: unknown;
    try { onInvalidate?.(change); } catch (error) { failed = true; firstError = error; }
    try { onEvent?.(event); } catch (error) { if (!failed) { failed = true; firstError = error; } }
    if (failed) throw firstError;
  }

  function getCellPermission(rowIndex: number, columnIndex: number): CellPermission {
    assertAlive();
    if (!Number.isSafeInteger(rowIndex) || rowIndex < 0 || rowIndex >= rowCount || !Number.isSafeInteger(columnIndex) || columnIndex < 0 || columnIndex >= columns.length) throw new RangeError('Invalid cell position.');
    const column = columns[columnIndex]!;
    return query(() => {
      const cell = Object.freeze({ rowIndex, rowId: dataSource.getRowId(rowIndex), columnIndex, columnKey: column.key });
      return resolvePermissions(column.editable ?? false, permissions, column.permissions, resolver?.(cell));
    });
  }

  function requirePermission(rowIndex: number, columnIndex: number, key: keyof CellPermission): void {
    if (!getCellPermission(rowIndex, columnIndex)[key]) throw new Error(`Cell is read-only or permission denied: ${key}.`);
  }

  function notifyCells(changes: readonly Change[], source: GridChangeSource): void {
    notify({ type: 'cells', cells: changes.map(({ rowIndex, columnKey }) => ({ rowIndex, columnKey })) },
      Object.freeze({ type: 'cell:change', source, changes: Object.freeze(changes.map(change => Object.freeze({ ...change }))) }));
  }

  function write(changes: readonly CellUpdate[]): void {
    if (changes.length === 1 && dataSource.setValue) {
      const change = changes[0]!;
      dataSource.setValue(change.rowIndex, change.columnKey, change.value);
    } else if (dataSource.setValues) dataSource.setValues(changes);
    else throw new Error('An atomic setValues method is required for batch writes.');
  }

  function applyUpdates(updates: readonly CellUpdate[], source: GridChangeSource = 'api'): void {
    assertAlive();
    const unique = new Map<string, CellUpdate>();
    for (const update of updates) {
      if (!Number.isSafeInteger(update.rowIndex) || update.rowIndex < 0 || update.rowIndex >= rowCount) throw new RangeError('Invalid row index.');
      if (!columnIndices.has(update.columnKey)) throw new Error(`Unknown column: ${update.columnKey}`);
      unique.set(JSON.stringify([update.rowIndex, update.columnKey]), { ...update });
    }
    const changes: Change[] = [...unique.values()].map(update => ({ ...update,
      previous: dataSource.getValue(update.rowIndex, update.columnKey), rowId: dataSource.getRowId(update.rowIndex),
    })).filter(change => !Object.is(change.previous, change.value));
    if (!changes.length) return;
    for (const change of changes) requirePermission(change.rowIndex, columnIndices.get(change.columnKey)!, 'writable');
    write(changes);
    past.push(changes);
    // keep the latest 100 commands; large values remain shallow caller-owned references.
    if (past.length > 100) past.shift();
    future.length = 0;
    notifyCells(changes, source);
  }

  function replay(redo: boolean): boolean {
    if (destroyed) return false;
    const from = redo ? future : past;
    const to = redo ? past : future;
    const changes = from.at(-1);
    if (!changes) return false;
    for (const change of changes) {
      if (dataSource.getRowId(change.rowIndex) !== change.rowId || !Object.is(dataSource.getValue(change.rowIndex, change.columnKey), redo ? change.previous : change.value)) {
        throw new Error('History conflicts with external data changes.');
      }
    }
    for (const change of changes) requirePermission(change.rowIndex, columnIndices.get(change.columnKey)!, 'writable');
    const updates = changes.map(change => ({ ...change, previous: redo ? change.previous : change.value, value: redo ? change.value : change.previous }));
    write(updates);
    from.pop();
    to.push(changes);
    notifyCells(updates, redo ? 'redo' : 'undo');
    return true;
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
    assertAlive();
    const range = getSelectionRange();
    if (!range) return '';
    if ((range.endRow - range.startRow + 1) * (range.endColumn - range.startColumn + 1) > clipboardCellLimit) throw new RangeError('Selection has too many cells.');
    const rows: string[][] = [];
    let length = 0;
    for (let row = range.startRow; row <= range.endRow; row++) {
      const values: string[] = [];
      for (let col = range.startColumn; col <= range.endColumn; col++) {
        requirePermission(row, col, 'copyable');
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
    assertAlive();
    const range = getSelectionRange();
    if (!range) return;
    const rows = decodeTsv(text);
    const height = rows.length;
    const width = rows[0]!.length;
    if (range.startRow + height > rowCount || range.startColumn + width > columns.length) throw new RangeError('Paste extends beyond grid bounds.');
    for (let row = 0; row < height; row++) {
      for (let col = 0; col < width; col++) requirePermission(range.startRow + row, range.startColumn + col, 'pasteable');
    }
    const updates: CellUpdate[] = [];
    for (let row = 0; row < height; row++) {
      for (let col = 0; col < width; col++) {
        const column = columns[range.startColumn + col]!;
        const rowIndex = range.startRow + row;
        const current = dataSource.getValue(rowIndex, column.key);
        if (!column.parse && current != null && typeof current !== 'string') throw new Error(`Column requires a parser: ${column.key}`);
        const value = rows[row]![col]!;
        updates.push({ rowIndex, columnKey: column.key, value: column.parse ? column.parse(value) : value });
      }
    }
    applyUpdates(updates, 'paste');
  }

  function select(rowIndex: number, columnIndex: number, extend = false): boolean {
    assertAlive();
    if (!Number.isSafeInteger(rowIndex) || rowIndex < 0 || rowIndex >= rowCount || !Number.isSafeInteger(columnIndex) || columnIndex < 0 || columnIndex >= columns.length) throw new RangeError('Invalid cell position.');
    if (!getCellPermission(rowIndex, columnIndex).selectable) return false;
    const changed = selection?.rowIndex !== rowIndex || selection?.columnIndex !== columnIndex;
    const previousRange = JSON.stringify(getSelectionRange());
    selection = { rowIndex, rowId: dataSource.getRowId(rowIndex), columnIndex, columnKey: columns[columnIndex]!.key };
    if (!extend || !anchor) anchor = { ...selection };
    const rangeChanged = previousRange !== JSON.stringify(getSelectionRange());
    if (changed || rangeChanged) notifySelection(changed, rangeChanged);
    return changed || rangeChanged;
  }

  function notifySelection(changed: boolean, rangeChanged: boolean): void {
    const endpoint = getSelection();
    const range = getSelectionRange();
    notify({ type: 'selection', changed, rangeChanged }, Object.freeze({ type: 'selection:change',
      selection: endpoint ? Object.freeze(endpoint) : null, range: range ? Object.freeze(range) : null }));
  }

  function clearSelection(): void {
    assertAlive();
    if (!selection) return;
    selection = anchor = null;
    notifySelection(true, true);
  }

  function canEdit(rowIndex: number, columnIndex: number): boolean {
    const column = columns[columnIndex];
    if (destroyed || !Number.isSafeInteger(rowIndex) || !Number.isSafeInteger(columnIndex) || !dataSource.setValue || !column || rowIndex < 0 || rowIndex >= rowCount) return false;
    if (!getCellPermission(rowIndex, columnIndex).editable) return false;
    const value = dataSource.getValue(rowIndex, column.key);
    return column.parse !== undefined || value == null || typeof value === 'string';
  }

  function canPaste(): boolean {
    const range = getSelectionRange();
    return !destroyed && !!range && !!(dataSource.setValue || dataSource.setValues) && getCellPermission(range.startRow, range.startColumn).pasteable;
  }

  function editCell(rowIndex: number, columnIndex: number, text: string): void {
    assertAlive();
    if (!canEdit(rowIndex, columnIndex)) throw new Error('Cell cannot be edited.');
    const column = columns[columnIndex]!;
    const previous = dataSource.getValue(rowIndex, column.key);
    if (text !== (previous == null ? '' : String(previous))) {
      applyUpdates([{ rowIndex, columnKey: column.key, value: column.parse ? column.parse(text) : text }], 'edit');
    }
  }

  function resize(axis: GridAxis, index: number, size: number): void {
    assertAlive();
    const previous = axis.size(index);
    axis.setSize(index, size);
    if (previous !== size) notify({ type: 'layout' }, Object.freeze({ type: axis === rowAxis ? 'row:resize' : 'column:resize', index, previous, size }));
  }

  function axisView(axis: GridAxis) {
    return Object.freeze({
      size: (index: number) => axis.size(index),
      position: (index: number) => axis.position(index),
      indexAt: (offset: number) => axis.indexAt(offset),
      range: (offset: number, extent: number) => axis.range(offset, extent),
    });
  }

  return Object.freeze({
    columns, rowCount, frozenRows, frozenColumns,
    getViewport: (viewport: ViewportOptions) => { assertAlive(); return createViewport(rowAxis, columnAxis, frozenRows, frozenColumns, viewport); },
    rows: axisView(rowAxis), columnsLayout: axisView(columnAxis),
    getValue: (row: number, key: string): unknown => dataSource.getValue(row, key),
    getSelection, getSelectionRange, getCellPermission, canEdit, canPaste,
    select: (row: number, col: number, extend = false) => command(() => select(row, col, extend)),
    clearSelection: () => command(clearSelection),
    editCell: (row: number, col: number, text: string) => command(() => editCell(row, col, text)),
    updateCells: (updates: readonly CellUpdate[]) => command(() => applyUpdates(updates)),
    copySelection: () => query(copySelection), paste: (text: string) => command(() => paste(text)),
    undo: () => command(() => replay(false)), redo: () => command(() => replay(true)),
    canUndo: () => !destroyed && past.length > 0,
    canRedo: () => !destroyed && future.length > 0,
    setColumnWidth: (index: number, size: number) => command(() => resize(columnAxis, index, size)),
    setRowHeight: (index: number, size: number) => command(() => resize(rowAxis, index, size)),
    destroy: () => command(() => {
      if (destroyed) return;
      destroyed = true;
      onInvalidate = undefined;
      onEvent = undefined;
      resolver = undefined;
      past.length = future.length = 0;
      selection = anchor = null;
    }),
  });
}

export type GridEngine = ReturnType<typeof createGridEngine>;
