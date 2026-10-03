import { reorderedIndices } from './structure.js';
import type { StructureRequest } from './structure.js';
import type { CellUpdate, DataSource, RowId, DataRow, RowSplice } from './data-source.js';
import type { Column, CellSelection, SelectionRange, CellLockTarget, CellFormatTarget, CellFormat, CellFormatPatch } from './types.js';
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
  | { readonly type: 'layout' }
  | { readonly type: 'structure'; readonly rowMap: readonly number[]; readonly columnMap: readonly number[] };

export interface GridEngineOptions {
  columns: readonly Column[];
  canChangeStructure?: (request: Readonly<StructureRequest>) => boolean;
  dataSource: DataSource;
  permissions?: CellPermissionPolicy;
  resolveCellPermission?: CellPermissionResolver;
  onEvent?: (event: GridEvent) => void;
  rowHeight?: number;
  columnWidth?: number;
  columnWidths?: Readonly<Record<string, number>>;
  allowLockChanges?: boolean;
  frozenRows?: number;
  frozenColumns?: number;
  /** Synchronous renderer notification after state and history have committed. */
  onInvalidate?: (change: GridInvalidation) => void;
}

/** Domain state and operations. No browser globals or per-cell state allocation. */
export function createGridEngine(options: GridEngineOptions) {
  const { dataSource } = options;
  let columns = Object.freeze(options.columns.map(column => Object.freeze({ ...column, ...(column.permissions ? { permissions: Object.freeze({ ...column.permissions }) } : {}) })));
  const rowHeight = options.rowHeight ?? 32;
  const columnWidth = options.columnWidth ?? 160;
  for (const size of [rowHeight, columnWidth]) {
    if (!Number.isFinite(size) || size <= 0) throw new RangeError('Grid sizes must be positive finite numbers.');
  }
  if (new Set(columns.map(column => column.key)).size !== columns.length) throw new Error('Column keys must be unique.');
  const columnIndices = new Map(columns.map((column, index) => [column.key, index]));
  let rowCount = dataSource.getRowCount();
  if (!Number.isSafeInteger(rowCount) || rowCount < 0) throw new RangeError('Invalid row count.');
  let frozenRows = options.frozenRows ?? 0;
  let frozenColumns = options.frozenColumns ?? 0;
  for (const [count, limit] of [[frozenRows, rowCount], [frozenColumns, columns.length]] as const) {
    if (!Number.isSafeInteger(count) || count < 0 || count > limit) throw new RangeError('Invalid frozen row or column count.');
  }
  if (!Number.isFinite(rowCount * rowHeight) || !Number.isFinite(columns.length * columnWidth)) throw new RangeError('Grid dimensions overflow.');
  const rowAxis = new GridAxis(rowCount, rowHeight);
  const columnAxis = new GridAxis(columns.length, columnWidth);
  for (const [key,size] of Object.entries(options.columnWidths ?? {})) {
    const index=columnIndices.get(key); if(index===undefined)throw new Error('Unknown initial column width.');
    columnAxis.setSize(index,size);
  }
  const permissions = options.permissions ? Object.freeze({ ...options.permissions }) : undefined;
  let resolver = options.resolveCellPermission;
  let onEvent = options.onEvent;
  const allowLockChanges = options.allowLockChanges ?? true;
  if (typeof allowLockChanges !== 'boolean') throw new TypeError('allowLockChanges must be boolean.');
  let tableLocked = false;
  const manualRows=new Set<number>();
  const lockedRows = new Set<number>();
  const lockedColumns = new Set<number>();
  const lockedCells = new Set<string>();
  let busy = false;
  let destroyed = false;
  let onInvalidate = options.onInvalidate;
  let selection: CellSelection | null = null;
  let anchor: CellSelection | null = null;
  const retainedRanges: SelectionRange[] = [];
  type Change = CellUpdate & { previous: unknown; rowId: RowId };
  type FormatEntry = { target: Readonly<CellFormatTarget>; bounds: Readonly<SelectionRange>; patch: Readonly<CellFormatPatch>; orders: Readonly<{ background?: number; textColor?: number }>; order: number };
  type FormatChange = { key: string; previous: FormatEntry | undefined; value: FormatEntry | undefined };
  type StructureState = {
    columns: typeof columns; rowCount: number; rowIds: readonly RowId[]; rows: ReturnType<GridAxis['snapshot']>; widths: ReturnType<GridAxis['snapshot']>;
    selection: CellSelection | null; anchor: CellSelection | null; ranges: SelectionRange[];
    manualRows:number[]; lockedRows: number[]; lockedColumns: number[]; lockedCells: string[]; formats: Map<string, FormatEntry>;
    frozenRows: number; frozenColumns: number;
  };
  type HistoryCommand = { kind: 'values'; changes: Change[] } | { kind: 'format'; changes: FormatChange[] }
    | { kind: 'resize'; axis: 'row' | 'column'; index: number; previous: number; size: number; previousManual:boolean }
    | { kind: 'freeze'; previousRows: number; previousColumns: number; rows: number; columns: number }
    | { kind: 'structure'; request: Readonly<StructureRequest>; reverseRequest: Readonly<StructureRequest>; before: StructureState; after: StructureState; forward: readonly RowSplice[]; backward: readonly RowSplice[]; rowMap: readonly number[]; columnMap: readonly number[] };
  const past: HistoryCommand[] = [];
  const future: HistoryCommand[] = [];
  const formats = new Map<string, FormatEntry>();
  let orderedFormats: FormatEntry[] = [];
  let formatOrder = 0;
  const emptyFormat: Readonly<CellFormat> = Object.freeze({});

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
      return resolvePermissions(column.editable ?? false, permissions, column.permissions, resolver?.(cell), tableLocked || lockedRows.has(rowIndex) || lockedColumns.has(columnIndex) || lockedCells.has(`${rowIndex}:${columnIndex}`) ? { writable: false } : undefined);
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
    past.push({ kind: 'values', changes });
    // keep the latest 100 commands; large values remain shallow caller-owned references.
    if (past.length > 100) past.shift();
    future.length = 0;
    notifyCells(changes, source);
  }

  function replay(redo: boolean): boolean {
    if (destroyed) return false;
    const from = redo ? future : past;
    const to = redo ? past : future;
    const entry = from.at(-1);
    if (!entry) return false;
    if (entry.kind === 'structure') {
      replayStructure(entry, redo);
      from.pop(); to.push(entry);
      notifyStructure(entry, redo, redo ? 'redo' : 'undo');
      return true;
    }
    if (entry.kind === 'resize') {
      const axis = entry.axis === 'row' ? rowAxis : columnAxis;
      if ((entry.axis!=='row'||manualRows.has(entry.index)) && axis.size(entry.index) !== (redo ? entry.previous : entry.size)) throw new Error('Layout history conflicts with external changes.');
      axis.setSize(entry.index, redo ? entry.size : entry.previous);
      if(entry.axis==='row'){if(redo||entry.previousManual)manualRows.add(entry.index);else manualRows.delete(entry.index);}
      from.pop(); to.push(entry);
      notify({type:'layout'}, Object.freeze({type:entry.axis === 'row' ? 'row:resize' : 'column:resize', index:entry.index, previous:redo ? entry.previous : entry.size, size:redo ? entry.size : entry.previous}));
      return true;
    }
    if (entry.kind === 'freeze') {
      if (frozenRows !== (redo ? entry.previousRows : entry.rows) || frozenColumns !== (redo ? entry.previousColumns : entry.columns)) throw new Error('Frozen history conflicts with external changes.');
      const previousRows=frozenRows, previousColumns=frozenColumns;
      frozenRows=redo ? entry.rows : entry.previousRows; frozenColumns=redo ? entry.columns : entry.previousColumns;
      from.pop(); to.push(entry);
      notify({type:'layout'}, Object.freeze({type:'freeze:change', previousRows, previousColumns, rows:frozenRows, columns:frozenColumns}));
      return true;
    }
    if (entry.kind === 'format') {
      for (const change of entry.changes) {
        if (formats.get(change.key) !== (redo ? change.previous : change.value)) throw new Error('Formatting history conflicts with external changes.');
        requireFormatPermission((change.value ?? change.previous)!.bounds);
      }
      const changes = entry.changes.map(change => ({ ...change, previous: redo ? change.previous : change.value, value: redo ? change.value : change.previous }));
      writeFormats(changes); from.pop(); to.push(entry); notifyFormats(changes, redo ? 'redo' : 'undo'); return true;
    }
    const changes = entry.changes;
    for (const change of changes) {
      if (dataSource.getRowId(change.rowIndex) !== change.rowId || !Object.is(dataSource.getValue(change.rowIndex, change.columnKey), redo ? change.previous : change.value)) {
        throw new Error('History conflicts with external data changes.');
      }
    }
    for (const change of changes) requirePermission(change.rowIndex, columnIndices.get(change.columnKey)!, 'writable');
    const updates = changes.map(change => ({ ...change, previous: redo ? change.previous : change.value, value: redo ? change.value : change.previous }));
    write(updates);
    from.pop();
    to.push(entry);
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

  function getSelectionRanges(): SelectionRange[] {
    const range = getSelectionRange();
    return range ? [...retainedRanges.map(range => ({ ...range })), range] : [];
  }

  function requireSingleRange(): void {
    if (retainedRanges.length) throw new Error('Copy and paste require a single selection range.');
  }

  function copySelection(): string {
    assertAlive();
    const range = getSelectionRange();
    if (!range) return '';
    requireSingleRange();
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
    requireSingleRange();
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

  function select(rowIndex: number, columnIndex: number, extend = false, add = false): boolean {
    assertAlive();
    if (!Number.isSafeInteger(rowIndex) || rowIndex < 0 || rowIndex >= rowCount || !Number.isSafeInteger(columnIndex) || columnIndex < 0 || columnIndex >= columns.length) throw new RangeError('Invalid cell position.');
    if (!getCellPermission(rowIndex, columnIndex).selectable) return false;
    if (add && extend) throw new Error('Adding and extending a selection are separate operations.');
    if (add && selection && retainedRanges.length >= 127) throw new RangeError('Selection supports at most 128 ranges.');
    const nextSelection = { rowIndex, rowId: dataSource.getRowId(rowIndex), columnIndex, columnKey: columns[columnIndex]!.key };
    const previousRanges = JSON.stringify(getSelectionRanges());
    const previous = getSelectionRange();
    if (add && previous) retainedRanges.push(previous);
    else if (!extend) retainedRanges.length = 0;
    const changed = selection?.rowIndex !== rowIndex || selection?.columnIndex !== columnIndex;
    const previousRange = JSON.stringify(getSelectionRange());
    selection = nextSelection;
    if (!extend || !anchor) anchor = { ...selection };
    const rangeChanged = previousRange !== JSON.stringify(getSelectionRange());
    const rangesChanged = previousRanges !== JSON.stringify(getSelectionRanges());
    if (changed || rangeChanged || rangesChanged) notifySelection(changed, rangeChanged || rangesChanged);
    return changed || rangeChanged || rangesChanged;
  }

  function selectRange(range: SelectionRange, mode: 'replace' | 'add' | 'extend' = 'replace'): boolean {
    assertAlive();
    const { startRow, endRow, startColumn, endColumn } = range;
    for (const [value, limit] of [[startRow, rowCount], [endRow, rowCount], [startColumn, columns.length], [endColumn, columns.length]]) {
      if (!Number.isSafeInteger(value) || value! < 0 || value! >= limit!) throw new RangeError('Invalid selection range.');
    }
    if (startRow > endRow || startColumn > endColumn) throw new RangeError('Invalid selection range order.');
    if (!getCellPermission(startRow, startColumn).selectable || !getCellPermission(endRow, endColumn).selectable) return false;
    if (mode !== 'replace' && mode !== 'add' && mode !== 'extend') throw new TypeError('Invalid selection mode.');
    if (mode === 'add' && selection && retainedRanges.length >= 127) throw new RangeError('Selection supports at most 128 ranges.');
    const previous = JSON.stringify(getSelectionRanges());
    const previousRange = getSelectionRange();
    if (mode === 'add' && previousRange) retainedRanges.push(previousRange);
    else if (mode === 'replace') retainedRanges.length = 0;
    const changed = selection?.rowIndex !== startRow || selection?.columnIndex !== startColumn;
    selection = { rowIndex: startRow, rowId: dataSource.getRowId(startRow), columnIndex: startColumn, columnKey: columns[startColumn]!.key };
    anchor = { rowIndex: endRow, rowId: dataSource.getRowId(endRow), columnIndex: endColumn, columnKey: columns[endColumn]!.key };
    const rangeChanged = previous !== JSON.stringify(getSelectionRanges());
    if (changed || rangeChanged) notifySelection(changed, rangeChanged);
    return changed || rangeChanged;
  }

  function notifySelection(changed: boolean, rangeChanged: boolean): void {
    const endpoint = getSelection();
    const range = getSelectionRange();
    notify({ type: 'selection', changed, rangeChanged }, Object.freeze({ type: 'selection:change',
      selection: endpoint ? Object.freeze(endpoint) : null, range: range ? Object.freeze(range) : null,
      ranges: Object.freeze(getSelectionRanges().map(range => Object.freeze(range))) }));
  }

  function clearSelection(): void {
    assertAlive();
    if (!selection) return;
    selection = anchor = null;
    retainedRanges.length = 0;
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
    return !destroyed && !retainedRanges.length && !!range && !!(dataSource.setValue || dataSource.setValues) && getCellPermission(range.startRow, range.startColumn).pasteable;
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

  function resize(axis: GridAxis, index: number, size: number, history = true): void {
    assertAlive();
    if(!history&&manualRows.has(index))return;
    const previous = axis.size(index), previousManual=axis===rowAxis&&manualRows.has(index);
    axis.setSize(index, size);
    if (previous !== size && history) { if(axis===rowAxis)manualRows.add(index); past.push({kind:'resize', axis:axis === rowAxis ? 'row' : 'column', index, previous, size, previousManual}); if (past.length > 100) past.shift(); future.length=0; }
    if (previous !== size) notify({ type: 'layout' }, Object.freeze({ type: axis === rowAxis ? 'row:resize' : 'column:resize', index, previous, size }));
  }

  function formatBounds(target: CellFormatTarget): SelectionRange {
    if (target.scope !== 'range') {
      validateLockTarget(target);
      return { startRow: target.scope === 'row' || target.scope === 'cell' ? target.rowIndex : 0,
        endRow: target.scope === 'row' || target.scope === 'cell' ? target.rowIndex : rowCount - 1,
        startColumn: target.scope === 'column' || target.scope === 'cell' ? target.columnIndex : 0,
        endColumn: target.scope === 'column' || target.scope === 'cell' ? target.columnIndex : columns.length - 1 };
    }
    const range = target.range;
    if (!range || ![range.startRow, range.endRow, range.startColumn, range.endColumn].every(Number.isSafeInteger) || range.startRow < 0 || range.endRow < range.startRow || range.endRow >= rowCount || range.startColumn < 0 || range.endColumn < range.startColumn || range.endColumn >= columns.length) throw new RangeError('Invalid formatting range.');
    return { startRow: range.startRow, endRow: range.endRow, startColumn: range.startColumn, endColumn: range.endColumn };
  }

  function requireFormatPermission(bounds: SelectionRange): void {
    if (permissions?.formatting === false) throw new Error('Cell does not permit formatting.');
    if (!resolver) {
      for (let col = bounds.startColumn; col <= bounds.endColumn; col++) if (!resolvePermissions(columns[col]!.editable ?? false, permissions, columns[col]!.permissions).formatting) throw new Error('Cell does not permit formatting.');
    } else for (let row = bounds.startRow; row <= bounds.endRow; row++) for (let col = bounds.startColumn; col <= bounds.endColumn; col++) requirePermission(row, col, 'formatting');
  }

  function canFormat(targets: readonly CellFormatTarget[]): boolean {
    if (destroyed) return false;
    const bounds = targets.map(formatBounds);
    try { for (const range of bounds) requireFormatPermission(range); return bounds.length > 0; } catch { return false; }
  }

  function getFormat(rowIndex: number, columnIndex: number): Readonly<CellFormat> {
    assertAlive(); validateLockTarget({ scope: 'cell', rowIndex, columnIndex });
    if (!orderedFormats.length) return emptyFormat;
    const result: { background?: string; textColor?: string } = {};
    const orders = { background: 0, textColor: 0 };
    // Scan sparse overlays; index regions if large formatting sets become costly.
    for (const entry of orderedFormats) {
      const range = entry.bounds;
      if (rowIndex < range.startRow || rowIndex > range.endRow || columnIndex < range.startColumn || columnIndex > range.endColumn) continue;
      for (const key of ['background', 'textColor'] as const) {
        if ((entry.orders[key] ?? 0) <= orders[key]) continue;
        orders[key] = entry.orders[key]!;
        const value = entry.patch[key];
        if (value === null) delete result[key]; else if (value !== undefined) result[key] = value;
      }
    }
    return Object.freeze(result);
  }

  function writeFormats(changes: readonly FormatChange[]): void {
    for (const change of changes) { if (change.value) formats.set(change.key, change.value); else formats.delete(change.key); }
    orderedFormats = [...formats.values()].sort((a, b) => a.order - b.order);
  }

  function notifyFormats(changes: readonly FormatChange[], source: 'api' | 'undo' | 'redo'): void {
    notify({ type: 'layout' }, Object.freeze({ type: 'format:change', source, changes: Object.freeze(changes.map(change => Object.freeze({ target: (change.value ?? change.previous)!.target, previous: change.previous?.patch ?? null, value: change.value?.patch ?? null }))) }));
  }

  function format(targets: readonly CellFormatTarget[], patch: CellFormatPatch | null): void {
    assertAlive();
    if (patch !== null) {
      if (!patch || typeof patch !== 'object') throw new TypeError('Invalid formatting patch.');
      patch = Object.freeze({ ...patch });
      for (const [key, value] of Object.entries(patch)) if (!['background', 'textColor'].includes(key) || (value !== null && (typeof value !== 'string' || !/^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i.test(value)))) throw new TypeError('Formatting colors must be hex colors or null.');
      if (!Object.keys(patch).length) return;
    }
    const unique = new Map<string, { target: CellFormatTarget; bounds: SelectionRange }>();
    for (const target of targets) {
      const bounds = formatBounds(target);
      if (bounds.endRow < bounds.startRow || bounds.endColumn < bounds.startColumn) continue;
      const snapshot = Object.freeze(target.scope === 'range' ? { scope: 'range' as const, range: Object.freeze({ ...bounds }) } : { ...target });
      unique.set(JSON.stringify([target.scope, bounds.startRow, bounds.endRow, bounds.startColumn, bounds.endColumn]), { target: snapshot, bounds });
    }
    for (const entry of unique.values()) requireFormatPermission(entry.bounds);
    const changes: FormatChange[] = [];
    for (const [key, entry] of unique) {
      const previous = formats.get(key);
      const nextPatch = patch === null ? undefined : Object.freeze({ ...previous?.patch, ...patch });
      if ((!previous && !nextPatch) || (previous && previous === orderedFormats.at(-1) && JSON.stringify(previous.patch) === JSON.stringify(nextPatch))) continue;
      const orders = { ...previous?.orders };
      if (patch) for (const key of ['background', 'textColor'] as const) if (patch[key] !== undefined) orders[key] = ++formatOrder;
      changes.push({ key, previous, value: nextPatch ? { ...entry, bounds: Object.freeze(entry.bounds), patch: nextPatch, orders: Object.freeze(orders), order: formatOrder } : undefined });
    }
    if (!changes.length) return;
    writeFormats(changes); past.push({ kind: 'format', changes }); if (past.length > 100) past.shift(); future.length = 0;
    notifyFormats(changes, 'api');
  }

  function validateLockTarget(target: CellLockTarget): void {
    if (!target || !['table', 'row', 'column', 'cell'].includes(target.scope)) throw new TypeError('Invalid lock scope.');
    if ((target.scope === 'row' || target.scope === 'cell') && (!Number.isSafeInteger(target.rowIndex) || target.rowIndex < 0 || target.rowIndex >= rowCount)) throw new RangeError('Invalid lock row.');
    if ((target.scope === 'column' || target.scope === 'cell') && (!Number.isSafeInteger(target.columnIndex) || target.columnIndex < 0 || target.columnIndex >= columns.length)) throw new RangeError('Invalid lock column.');
  }

  function isLocked(target: CellLockTarget): boolean {
    assertAlive(); validateLockTarget(target);
    if (target.scope === 'table') return tableLocked;
    if (target.scope === 'row') return lockedRows.has(target.rowIndex);
    if (target.scope === 'column') return lockedColumns.has(target.columnIndex);
    return lockedCells.has(`${target.rowIndex}:${target.columnIndex}`);
  }

  function setLocked(target: CellLockTarget, locked: boolean): void {
    assertAlive();
    if (!allowLockChanges) throw new Error('Lock management is disabled.');
    if (typeof locked !== 'boolean') throw new TypeError('Lock state must be boolean.');
    if (isLocked(target) === locked) return;
    if (target.scope === 'table') tableLocked = locked;
    else if (target.scope === 'row') { if (locked) lockedRows.add(target.rowIndex); else lockedRows.delete(target.rowIndex); }
    else if (target.scope === 'column') { if (locked) lockedColumns.add(target.columnIndex); else lockedColumns.delete(target.columnIndex); }
    else { const key = `${target.rowIndex}:${target.columnIndex}`; if (locked) lockedCells.add(key); else lockedCells.delete(key); }
    notify({ type: 'layout' }, Object.freeze({ type: 'lock:change', target: Object.freeze({ ...target }), locked }));
  }

  function setFrozen(rows: number, columnCount: number): void {
    assertAlive();
    if (!Number.isSafeInteger(rows) || rows < 0 || rows > rowCount || !Number.isSafeInteger(columnCount) || columnCount < 0 || columnCount > columns.length) throw new RangeError('Invalid frozen row or column count.');
    if (rows === frozenRows && columnCount === frozenColumns) return;
    const previousRows = frozenRows; const previousColumns = frozenColumns;
    frozenRows = rows; frozenColumns = columnCount;
    past.push({kind:'freeze', previousRows, previousColumns, rows, columns:columnCount}); if (past.length > 100) past.shift(); future.length=0;
    notify({ type: 'layout' }, Object.freeze({ type: 'freeze:change', previousRows, previousColumns, rows, columns: columnCount }));
  }


  function snapshotStructure(): StructureState {
    return {columns, rowCount, rowIds:Array.from({length:rowCount},(_,i)=>dataSource.getRowId(i)), rows:rowAxis.snapshot(), widths:columnAxis.snapshot(), selection:getSelection(), anchor:anchor ? {...anchor} : null,
      ranges:retainedRanges.map(range=>({...range})), manualRows:[...manualRows], lockedRows:[...lockedRows], lockedColumns:[...lockedColumns], lockedCells:[...lockedCells],
      formats:new Map(formats), frozenRows, frozenColumns};
  }
  function restoreStructure(state: StructureState): void {
    columns=state.columns; rowCount=state.rowCount; columnIndices.clear(); columns.forEach((column,i)=>columnIndices.set(column.key,i));
    rowAxis.replace(rowCount,state.rows); columnAxis.replace(columns.length,state.widths);
    selection=state.selection ? {...state.selection} : null; anchor=state.anchor ? {...state.anchor} : null;
    retainedRanges.length=0; retainedRanges.push(...state.ranges.map(range=>({...range})));
    manualRows.clear(); for(const index of state.manualRows)manualRows.add(index);
    lockedRows.clear(); for (const index of state.lockedRows) lockedRows.add(index);
    lockedColumns.clear(); for (const index of state.lockedColumns) lockedColumns.add(index);
    lockedCells.clear(); for (const key of state.lockedCells) lockedCells.add(key);
    formats.clear(); for (const [key,entry] of state.formats) formats.set(key,entry);
    orderedFormats=[...formats.values()].sort((a,b)=>a.order-b.order);
    frozenRows=state.frozenRows; frozenColumns=state.frozenColumns;
  }
  function mappedIntervals(start: number, end: number, mapping: readonly number[]): [number,number][] {
    const sorted=mapping.slice(start,end+1).filter(i=>i>=0).sort((a,b)=>a-b), result:[number,number][]=[];
    for (const index of sorted) {
      const last=result.at(-1);
      if (last && index===last[1]+1) last[1]=index; else result.push([index,index]);
    }
    return result;
  }
  function mappedRanges(range: SelectionRange, rows: readonly number[], cols: readonly number[]): SelectionRange[] {
    return mappedIntervals(range.startRow,range.endRow,rows).flatMap(([startRow,endRow])=>mappedIntervals(range.startColumn,range.endColumn,cols).map(([startColumn,endColumn])=>({startRow,endRow,startColumn,endColumn})));
  }
  function mappedState(before: StructureState, order: readonly number[], axis: 'row'|'column', rowMap: number[], columnMap: number[], addedColumns:readonly Column[]=[]): StructureState {
    let inserted=0;
    const nextColumns=axis==='column' ? Object.freeze(order.map(i=>i<0 ? addedColumns[inserted++]! : columns[i]!)) : columns;
    const nextCount=axis==='row' ? order.length : rowCount;
    const mapCell=(cell:CellSelection|null):CellSelection|null => {
      if (!cell || rowMap[cell.rowIndex]===undefined || rowMap[cell.rowIndex]!<0 || columnMap[cell.columnIndex]===undefined || columnMap[cell.columnIndex]!<0) return null;
      return {...cell,rowIndex:rowMap[cell.rowIndex]!,columnIndex:columnMap[cell.columnIndex]!};
    };
    const ranges=before.ranges.flatMap(range=>mappedRanges(range,rowMap,columnMap));
    const currentRange=getSelectionRange(),activeRanges=currentRange ? mappedRanges(currentRange,rowMap,columnMap):[];
    const nextSelection=mapCell(selection), nextAnchor=mapCell(anchor);
    const active=activeRanges.findIndex(range=>nextSelection && nextSelection.rowIndex>=range.startRow && nextSelection.rowIndex<=range.endRow && nextSelection.columnIndex>=range.startColumn && nextSelection.columnIndex<=range.endColumn);
    if(active>=0)activeRanges.push(...activeRanges.splice(active,1));
    ranges.push(...activeRanges);
    if(ranges.length>128)throw new RangeError('Structural change would exceed the selection range limit.');
    const activeRange=ranges.pop();
    const cellAt=(rowIndex:number,columnIndex:number):CellSelection => ({rowIndex,columnIndex,columnKey:nextColumns[columnIndex]!.key,rowId:axis==='row' ? dataSource.getRowId(order[rowIndex]!) : dataSource.getRowId(rowIndex)});
    let mappedSelection=nextSelection, mappedAnchor=nextAnchor;
    if (activeRange && nextCount && nextColumns.length) {
      const exact=nextSelection && nextAnchor && Math.min(nextSelection.rowIndex,nextAnchor.rowIndex)===activeRange.startRow && Math.max(nextSelection.rowIndex,nextAnchor.rowIndex)===activeRange.endRow && Math.min(nextSelection.columnIndex,nextAnchor.columnIndex)===activeRange.startColumn && Math.max(nextSelection.columnIndex,nextAnchor.columnIndex)===activeRange.endColumn;
      if (!exact) { mappedSelection=cellAt(activeRange.startRow,activeRange.startColumn); mappedAnchor=cellAt(activeRange.endRow,activeRange.endColumn); }
    } else mappedSelection=mappedAnchor=null;
    const nextFormats=new Map<string,FormatEntry>();
    for (const entry of before.formats.values()) {
      const targets:CellFormatTarget[]=[];
      if (entry.target.scope==='table') targets.push(entry.target);
      else if (entry.target.scope==='row') { const row=rowMap[entry.target.rowIndex]!; if(row>=0) targets.push({scope:'row',rowIndex:row}); }
      else if (entry.target.scope==='column') { const col=columnMap[entry.target.columnIndex]!; if(col>=0) targets.push({scope:'column',columnIndex:col}); }
      else if (entry.target.scope==='cell') { const row=rowMap[entry.target.rowIndex]!,col=columnMap[entry.target.columnIndex]!; if(row>=0&&col>=0) targets.push({scope:'cell',rowIndex:row,columnIndex:col}); }
      else for (const range of mappedRanges(entry.bounds,rowMap,columnMap)) targets.push({scope:'range',range:Object.freeze(range)});
      for (const target of targets) {
        const bounds:SelectionRange=target.scope==='range' ? {...target.range} : {
          startRow:target.scope==='row'||target.scope==='cell' ? target.rowIndex:0,endRow:target.scope==='row'||target.scope==='cell' ? target.rowIndex:nextCount-1,
          startColumn:target.scope==='column'||target.scope==='cell' ? target.columnIndex:0,endColumn:target.scope==='column'||target.scope==='cell' ? target.columnIndex:nextColumns.length-1};
        const nextKey=JSON.stringify([target.scope,bounds.startRow,bounds.endRow,bounds.startColumn,bounds.endColumn]);
        const existing=nextFormats.get(nextKey),patch={...existing?.patch},orders={...existing?.orders};
        for(const property of ['background','textColor'] as const)if((entry.orders[property]??0)>(orders[property]??0)){orders[property]=entry.orders[property]!;patch[property]=entry.patch[property]!;}
        nextFormats.set(nextKey,{...entry,target:Object.freeze(target),bounds:Object.freeze(bounds),patch:Object.freeze(patch),orders:Object.freeze(orders),order:Math.max(existing?.order??0,entry.order)});
      }
    }
    const mapSizes=(sizes:StructureState['rows'],map:readonly number[])=>sizes.filter(([i])=>map[i]!>=0).map(([i,size])=>[map[i]!,size] as const);
    return {...before,columns:nextColumns,rowCount:nextCount,rowIds:axis==='row' ? order.map(i=>i<0 ? '' : before.rowIds[i]!) : before.rowIds,rows:mapSizes(before.rows,rowMap),widths:mapSizes(before.widths,columnMap),selection:mappedSelection,anchor:mappedAnchor,ranges,
      manualRows:before.manualRows.map(i=>rowMap[i]!).filter(i=>i>=0),lockedRows:before.lockedRows.map(i=>rowMap[i]!).filter(i=>i>=0),lockedColumns:before.lockedColumns.map(i=>columnMap[i]!).filter(i=>i>=0),
      lockedCells:before.lockedCells.flatMap(key=>{const [r,c]=key.split(':').map(Number);const row=rowMap[r!]!,col=columnMap[c!]!;return row>=0&&col>=0 ? [`${row}:${col}`] : [];}),
      formats:nextFormats,frozenRows:Math.min(frozenRows,nextCount),frozenColumns:Math.min(frozenColumns,nextColumns.length)};
  }
  function structureAllowed(request: Readonly<StructureRequest>): boolean {
    const limit=request?.axis==='row' ? rowCount:columns.length;
    if(!request||!['row','column'].includes(request.axis)||!['insert','delete','move'].includes(request.kind)||!Array.isArray(request.indices)||!Number.isSafeInteger(request.beforeIndex)||request.beforeIndex<0||request.beforeIndex>limit||!Number.isSafeInteger(request.count)||request.count<1||new Set(request.indices).size!==request.indices.length||request.indices.some(i=>!Number.isSafeInteger(i)||i<0||i>=limit))return false;
    if (destroyed || tableLocked || options.canChangeStructure?.(request)===false) return false;
    if (request.axis==='row' && (!dataSource.getRow || !dataSource.spliceRows)) return false;
    if(request.axis==='column' && request.kind!=='move' && !dataSource.addColumns)return false;
    if (request.kind==='delete') {
      if(request.axis==='row') {
        if(request.indices.some(row=>lockedRows.has(row)))return false;
        for(const row of request.indices)for(let col=0;col<columns.length;col++)if(!getCellPermission(row,col).writable)return false;
      } else {
        if(request.indices.some(col=>lockedColumns.has(col)))return false;
        for(let row=0;row<rowCount;row++)for(const col of request.indices)if(!getCellPermission(row,col).writable)return false;
      }
    }
    return true;
  }
  function structureRequest(axis:'row'|'column',kind:StructureRequest['kind'],indices:readonly number[],beforeIndex:number,count:number):Readonly<StructureRequest> {
    return Object.freeze({axis,kind,indices:Object.freeze([...indices]),beforeIndex,count});
  }
  function inverseMap(map:readonly number[],count:number):number[] {
    const result=Array<number>(count).fill(-1); map.forEach((next,old)=>{if(next>=0) result[next]=old;});return result;
  }
  function notifyStructure(entry:Extract<HistoryCommand,{kind:'structure'}>,redo:boolean,source:'api'|'undo'|'redo'):void {
    const state=redo ? entry.after:entry.before;
    notify({type:'structure',rowMap:redo ? entry.rowMap:Object.freeze(inverseMap(entry.rowMap,entry.after.rowCount)),columnMap:redo ? entry.columnMap:Object.freeze(inverseMap(entry.columnMap,entry.after.columns.length))},
      Object.freeze({type:'structure:change',source,request:redo ? entry.request:entry.reverseRequest,rowCount:state.rowCount,columnKeys:Object.freeze(state.columns.map(col=>col.key))}));
  }
  function replayStructure(entry:Extract<HistoryCommand,{kind:'structure'}>,redo:boolean):void {
    const request=redo ? entry.request:entry.reverseRequest;
    if(!structureAllowed(request)) throw new Error('Structural change is disabled.');
    if(dataSource.getRowCount()!==rowCount)throw new Error('Structural history conflicts with external row count.');
    const expectedState=redo ? entry.before:entry.after;
    if(expectedState.rowIds.some((id,i)=>dataSource.getRowId(i)!==id))throw new Error('Structural history conflicts with external row identity.');
    const splices=redo ? entry.forward:entry.backward;
    // Validate snapshots that this direction removes, before any source mutation.
    if(request.axis==='row') {
      const removed=splices.flatMap(splice=>Array.from({length:splice.deleteCount},(_,i)=>splice.index+i));
      const removedById=new Map(removed.map(i=>[dataSource.getRowId(i),i]));
      const inserted=(redo ? entry.backward:entry.forward).flatMap(splice=>splice.rows);
      for(const row of inserted) if(removedById.has(row.id)) {
        const index=removedById.get(row.id)!;
        const current=dataSource.getRow!(index);
        if(Object.keys(current.values).some(key=>!Object.hasOwn(row.values,key)&&current.values[key]!==undefined) || Object.keys(row.values).some(key=>!Object.is(current.values[key],row.values[key]))) throw new Error('Structural history conflicts with external data changes.');
      }
      dataSource.spliceRows!(splices);
    }
    const state=redo ? entry.after:entry.before;
    const rMap=redo ? entry.rowMap:inverseMap(entry.rowMap,entry.after.rowCount),cMap=redo ? entry.columnMap:inverseMap(entry.columnMap,entry.after.columns.length);
    // Locks are outside history: preserve changes made since the structural command.
    const previousLocks={rows:[...lockedRows],columns:[...lockedColumns],cells:[...lockedCells]};
    restoreStructure(state);
    lockedRows.clear(); previousLocks.rows.forEach(i=>{if(rMap[i]!>=0) lockedRows.add(rMap[i]!);});
    lockedColumns.clear(); previousLocks.columns.forEach(i=>{if(cMap[i]!>=0) lockedColumns.add(cMap[i]!);});
    lockedCells.clear(); previousLocks.cells.forEach(key=>{const [r,c]=key.split(':').map(Number);if(rMap[r!]!>=0&&cMap[c!]!>=0)lockedCells.add(`${rMap[r!]}:${cMap[c!]}`);});
    if(!redo) {
      for(const row of state.lockedRows) if(entry.rowMap[row]===-1) lockedRows.add(row);
      for(const col of state.lockedColumns) if(entry.columnMap[col]===-1) lockedColumns.add(col);
      for(const key of state.lockedCells) {const [r,c]=key.split(':').map(Number);if(entry.rowMap[r!]===-1||entry.columnMap[c!]===-1)lockedCells.add(key);}
    }
  }
  function changeStructure(request:Readonly<StructureRequest>,reverseRequest:Readonly<StructureRequest>,order:readonly number[],forward:readonly RowSplice[],backward:readonly RowSplice[],addedColumns:readonly Column[]=[]):void {
    assertAlive();
    if(dataSource.getRowCount()!==rowCount) throw new Error('External row count changed.');
    const rowMap=Array.from({length:rowCount},(_,i)=>i),columnMap=Array.from({length:columns.length},(_,i)=>i);
    const map=request.axis==='row' ? rowMap:columnMap; map.fill(-1);order.forEach((old,index)=>{if(old>=0)map[old]=index;});
    const before=snapshotStructure(),after=mappedState(before,order,request.axis,rowMap,columnMap,addedColumns);
    request=Object.freeze({...request,order:Object.freeze([...order]),columns:after.columns});
    reverseRequest=Object.freeze({...reverseRequest,order:Object.freeze([...map]),columns:before.columns});
    if(!structureAllowed(request))throw new Error('Structural change is disabled.');
    const checkRows=new GridAxis(after.rowCount,rowHeight),checkColumns=new GridAxis(after.columns.length,columnWidth);
    checkRows.replace(after.rowCount,after.rows);checkColumns.replace(after.columns.length,after.widths);
    if(addedColumns.length)dataSource.addColumns!(addedColumns.map(column=>column.key));
    if(request.axis==='row') {
      let inserted=0;const newRows=forward.flatMap(splice=>splice.rows);
      after.rowIds=order.map(old=>old>=0 ? before.rowIds[old]! : newRows[inserted++]!.id);
      dataSource.spliceRows!(forward);
    }
    restoreStructure(after);
    const entry:Extract<HistoryCommand,{kind:'structure'}>={kind:'structure',request,reverseRequest,before,after,forward,backward,rowMap:Object.freeze(rowMap),columnMap:Object.freeze(columnMap)};
    past.push(entry); if(past.length>100)past.shift();future.length=0;
    notifyStructure(entry,true,'api');
  }
  function insertRows(beforeIndex:number,rows:readonly DataRow[]):void {
    assertAlive();
    if(!Number.isSafeInteger(beforeIndex)||beforeIndex<0||beforeIndex>rowCount||!Array.isArray(rows))throw new RangeError('Invalid row insertion.');
    if(!rows.length)return;
    const snapshots=Object.freeze(rows.map(row=>Object.freeze({id:row.id,values:Object.freeze({...row.values})})));
    const previous=Array.from({length:rowCount},(_,i)=>i),order=previous.slice(0,beforeIndex).concat(Array<number>(rows.length).fill(-1),previous.slice(beforeIndex));
    changeStructure(structureRequest('row','insert',[],beforeIndex,rows.length),structureRequest('row','delete',rows.map((_,i)=>beforeIndex+i),beforeIndex,rows.length),order,
      [{index:beforeIndex,deleteCount:0,rows:snapshots}],[{index:beforeIndex,deleteCount:rows.length,rows:[]}]);
  }
  function rowBlocks(indices:readonly number[],rows:readonly DataRow[]):RowSplice[] {
    const blocks:RowSplice[]=[];
    let start=0;
    while(start<indices.length) {
      let end=start+1;while(end<indices.length&&indices[end]===indices[end-1]!+1)end++;
      blocks.push({index:indices[start]!,deleteCount:end-start,rows:rows.slice(start,end)});start=end;
    }
    return blocks;
  }
  function deleteRows(indices:readonly number[]):void {
    assertAlive();if(!indices.length)return;
    const ordered=[...indices].sort((a,b)=>a-b);
    if(new Set(ordered).size!==ordered.length||ordered.some(i=>!Number.isSafeInteger(i)||i<0||i>=rowCount))throw new RangeError('Invalid row deletion.');
    if(!dataSource.getRow||!dataSource.spliceRows)throw new Error('Atomic structural source methods are required.');
    const deleted=new Set(ordered),rows=ordered.map(i=>dataSource.getRow!(i)),blocks=rowBlocks(ordered,rows);
    changeStructure(structureRequest('row','delete',ordered,ordered[0]!,ordered.length),structureRequest('row','insert',[],ordered[0]!,ordered.length),Array.from({length:rowCount},(_,i)=>i).filter(i=>!deleted.has(i)),
      blocks.map(block=>({...block,rows:[]})).reverse(),blocks.map(block=>({...block,deleteCount:0})));
  }
  function insertColumns(beforeIndex:number,added:readonly Column[]):void {
    assertAlive();
    if(!Number.isSafeInteger(beforeIndex)||beforeIndex<0||beforeIndex>columns.length||!Array.isArray(added))throw new RangeError('Invalid column insertion.');
    if(!added.length)return;
    const snapshots=Object.freeze(added.map(column=>{
      if(!column||typeof column.key!=='string'||!column.key||typeof column.title!=='string')throw new TypeError('Invalid inserted column.');
      return Object.freeze({...column,...(column.permissions ? {permissions:Object.freeze({...column.permissions})}:{})});
    }));
    if(new Set([...columns,...snapshots].map(c=>c.key)).size!==columns.length+snapshots.length)throw new Error('Column keys must be unique.');
    const previous=Array.from({length:columns.length},(_,i)=>i),order=previous.slice(0,beforeIndex).concat(Array<number>(snapshots.length).fill(-1),previous.slice(beforeIndex));
    changeStructure(structureRequest('column','insert',[],beforeIndex,added.length),structureRequest('column','delete',added.map((_,i)=>beforeIndex+i),beforeIndex,added.length),order,[],[],snapshots);
  }
  function deleteColumns(indices:readonly number[]):void {
    assertAlive();if(!indices.length)return;
    const selected=[...indices].sort((a,b)=>a-b);
    if(new Set(selected).size!==selected.length||selected.some(i=>!Number.isSafeInteger(i)||i<0||i>=columns.length))throw new RangeError('Invalid column deletion.');
    const removed=new Set(selected),order=Array.from({length:columns.length},(_,i)=>i).filter(i=>!removed.has(i));
    changeStructure(structureRequest('column','delete',selected,selected[0]!,selected.length),structureRequest('column','insert',[],selected[0]!,selected.length),order,[],[]);
  }
  function moveAxis(axis:'row'|'column',indices:readonly number[],beforeIndex:number):void {
    assertAlive();const count=axis==='row' ? rowCount:columns.length,order=reorderedIndices(count,indices,beforeIndex);
    if(order.every((old,i)=>old===i))return;
    const selected=[...indices].sort((a,b)=>a-b),insertion=beforeIndex-selected.filter(i=>i<beforeIndex).length;
    let forward:RowSplice[]=[],backward:RowSplice[]=[];
    if(axis==='row'){
      if(!dataSource.getRow||!dataSource.spliceRows)throw new Error('Atomic structural source methods are required.');
      const rows=selected.map(i=>dataSource.getRow!(i)),blocks=rowBlocks(selected,rows);
      forward=blocks.map(block=>({...block,rows:[]})).reverse();forward.push({index:insertion,deleteCount:0,rows});
      backward=[{index:insertion,deleteCount:selected.length,rows:[]},...blocks.map(block=>({...block,deleteCount:0}))];
    }
    changeStructure(structureRequest(axis,'move',selected,beforeIndex,selected.length),structureRequest(axis,'move',selected.map((_,i)=>insertion+i),selected[0]!,selected.length),order,forward,backward);
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
    get columns() { return columns; }, get rowCount() { return rowCount; }, get frozenRows() { return frozenRows; }, get frozenColumns() { return frozenColumns; },
    getViewport: (viewport: ViewportOptions) => { assertAlive(); return createViewport(rowAxis, columnAxis, frozenRows, frozenColumns, viewport); },
    rows: axisView(rowAxis), columnsLayout: axisView(columnAxis),
    getValue: (row: number, key: string): unknown => dataSource.getValue(row, key),
    insertColumns:(index:number,added:readonly Column[])=>command(()=>insertColumns(index,added)),
    deleteColumns:(indices:readonly number[])=>command(()=>deleteColumns(indices)),
    insertRows: (index:number,rows:readonly DataRow[])=>command(()=>insertRows(index,rows)),
    deleteRows: (indices:readonly number[])=>command(()=>deleteRows(indices)),
    moveRows: (indices:readonly number[],beforeIndex:number)=>command(()=>moveAxis('row',indices,beforeIndex)),
    moveColumns: (indices:readonly number[],beforeIndex:number)=>command(()=>moveAxis('column',indices,beforeIndex)),
    canChangeStructure: (request:Readonly<StructureRequest>)=>query(()=>structureAllowed(request)),
    isRowHeightManual:(index:number)=>manualRows.has(index),
    measureRowHeight: (index:number,size:number)=>command(()=>resize(rowAxis,index,size,false)),
    getSelection, getSelectionRange, getSelectionRanges, getCellPermission, canEdit, canPaste,
    select: (row: number, col: number, extend = false) => command(() => select(row, col, extend)),
    selectRange: (range: SelectionRange, mode: 'replace' | 'add' | 'extend' = 'replace') => command(() => selectRange(range, mode)),
    addSelection: (row: number, col: number) => command(() => select(row, col, false, true)),
    clearSelection: () => command(clearSelection),
    editCell: (row: number, col: number, text: string) => command(() => editCell(row, col, text)),
    updateCells: (updates: readonly CellUpdate[]) => command(() => applyUpdates(updates)),
    copySelection: () => query(copySelection), paste: (text: string) => command(() => paste(text)),
    undo: () => command(() => replay(false)), redo: () => command(() => replay(true)),
    canUndo: () => !destroyed && past.length > 0,
    canRedo: () => !destroyed && future.length > 0,
    getFormat, canFormat: (targets: readonly CellFormatTarget[]) => query(() => canFormat(targets)),
    format: (targets: readonly CellFormatTarget[], patch: CellFormatPatch | null) => command(() => format(targets, patch)),
    isLocked, canManageLocks: () => !destroyed && allowLockChanges,
    setLocked: (target: CellLockTarget, locked: boolean) => command(() => setLocked(target, locked)),
    setFrozen: (rows: number, columns: number) => command(() => setFrozen(rows, columns)),
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
      retainedRanges.length = 0;
      formats.clear(); orderedFormats.length = 0;
      manualRows.clear();lockedRows.clear(); lockedColumns.clear(); lockedCells.clear(); tableLocked = false;
    }),
  });
}

export type GridEngine = ReturnType<typeof createGridEngine>;
