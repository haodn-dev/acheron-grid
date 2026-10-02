import type { CellUpdate, DataSource, RowId } from './data-source.js';
import type { Column, CellSelection, SelectionRange } from './types.js';
import { GridAxis } from './axis.js';
import { clipboardCellLimit, clipboardTextLimit, decodeTsv, encodeTsv } from './tsv.js';

export type GridInvalidation =
  | { readonly type: 'cells'; readonly cells: readonly { readonly rowIndex: number; readonly columnKey: string }[] }
  | { readonly type: 'selection'; readonly changed: boolean; readonly rangeChanged: boolean }
  | { readonly type: 'layout' };

export interface GridEngineOptions {
  columns: readonly Column[];
  dataSource: DataSource;
  rowHeight?: number;
  columnWidth?: number;
  /** Synchronous renderer notification after state and history have committed. */
  onInvalidate?: (change: GridInvalidation) => void;
}

/** Domain state and operations. No browser globals or per-cell state allocation. */
export function createGridEngine(options: GridEngineOptions) {
  const { dataSource } = options;
  const columns = Object.freeze(options.columns.map(column => Object.freeze({ ...column })));
  const rowHeight = options.rowHeight ?? 32;
  const columnWidth = options.columnWidth ?? 160;
  for (const size of [rowHeight, columnWidth]) {
    if (!Number.isFinite(size) || size <= 0) throw new RangeError('Grid sizes must be positive finite numbers.');
  }
  if (new Set(columns.map(column => column.key)).size !== columns.length) throw new Error('Column keys must be unique.');
  const rowCount = dataSource.getRowCount();
  if (!Number.isSafeInteger(rowCount) || rowCount < 0) throw new RangeError('Invalid row count.');
  if (!Number.isFinite(rowCount * rowHeight) || !Number.isFinite(columns.length * columnWidth)) throw new RangeError('Grid dimensions overflow.');
  const rowAxis = new GridAxis(rowCount, rowHeight);
  const columnAxis = new GridAxis(columns.length, columnWidth);
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

  function notify(change: GridInvalidation): void { onInvalidate?.(change); }

  function write(changes: readonly CellUpdate[]): void {
    if (changes.length === 1 && dataSource.setValue) {
      const change = changes[0]!;
      dataSource.setValue(change.rowIndex, change.columnKey, change.value);
    } else if (dataSource.setValues) dataSource.setValues(changes);
    else throw new Error('An atomic setValues method is required for batch writes.');
  }

  function applyUpdates(updates: readonly CellUpdate[]): void {
    assertAlive();
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
    // keep the latest 100 commands; large values remain shallow caller-owned references.
    if (past.length > 100) past.shift();
    future.length = 0;
    notify({ type: 'cells', cells: changes.map(({ rowIndex, columnKey }) => ({ rowIndex, columnKey })) });
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
    const updates = changes.map(change => ({ ...change, value: redo ? change.value : change.previous }));
    write(updates);
    from.pop();
    to.push(changes);
    notify({ type: 'cells', cells: updates.map(({ rowIndex, columnKey }) => ({ rowIndex, columnKey })) });
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

  function select(rowIndex: number, columnIndex: number, extend = false): void {
    assertAlive();
    if (!Number.isSafeInteger(rowIndex) || rowIndex < 0 || rowIndex >= rowCount || !Number.isSafeInteger(columnIndex) || columnIndex < 0 || columnIndex >= columns.length) throw new RangeError('Invalid cell position.');
    const changed = selection?.rowIndex !== rowIndex || selection?.columnIndex !== columnIndex;
    const previousRange = JSON.stringify(getSelectionRange());
    selection = { rowIndex, rowId: dataSource.getRowId(rowIndex), columnIndex, columnKey: columns[columnIndex]!.key };
    if (!extend || !anchor) anchor = { ...selection };
    const rangeChanged = previousRange !== JSON.stringify(getSelectionRange());
    if (changed || rangeChanged) notify({ type: 'selection', changed, rangeChanged });
  }

  function clearSelection(): void {
    assertAlive();
    if (!selection) return;
    selection = anchor = null;
    notify({ type: 'selection', changed: true, rangeChanged: true });
  }

  function canEdit(rowIndex: number, columnIndex: number): boolean {
    const column = columns[columnIndex];
    if (destroyed || !Number.isSafeInteger(rowIndex) || !Number.isSafeInteger(columnIndex) || !dataSource.setValue || !column?.editable || rowIndex < 0 || rowIndex >= rowCount) return false;
    const value = dataSource.getValue(rowIndex, column.key);
    return column.parse !== undefined || value == null || typeof value === 'string';
  }

  function canPaste(): boolean {
    const range = getSelectionRange();
    return !destroyed && !!range && !!(dataSource.setValue || dataSource.setValues) && !!columns[range.startColumn]!.editable;
  }

  function editCell(rowIndex: number, columnIndex: number, text: string): void {
    assertAlive();
    if (!canEdit(rowIndex, columnIndex)) throw new Error('Cell cannot be edited.');
    const column = columns[columnIndex]!;
    const previous = dataSource.getValue(rowIndex, column.key);
    if (text !== (previous == null ? '' : String(previous))) {
      applyUpdates([{ rowIndex, columnKey: column.key, value: column.parse ? column.parse(text) : text }]);
    }
  }

  function resize(axis: GridAxis, index: number, size: number): void {
    assertAlive();
    axis.setSize(index, size);
    notify({ type: 'layout' });
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
    columns, rowCount,
    rows: axisView(rowAxis), columnsLayout: axisView(columnAxis),
    getValue: (row: number, key: string): unknown => dataSource.getValue(row, key),
    getSelection, getSelectionRange, select, clearSelection, canEdit, canPaste, editCell,
    updateCells: applyUpdates, copySelection, paste,
    undo: () => replay(false), redo: () => replay(true),
    canUndo: () => !destroyed && past.length > 0,
    canRedo: () => !destroyed && future.length > 0,
    setColumnWidth: (index: number, size: number) => resize(columnAxis, index, size),
    setRowHeight: (index: number, size: number) => resize(rowAxis, index, size),
    destroy() {
      if (destroyed) return;
      destroyed = true;
      onInvalidate = undefined;
      past.length = future.length = 0;
      selection = anchor = null;
    },
  });
}

export type GridEngine = ReturnType<typeof createGridEngine>;
