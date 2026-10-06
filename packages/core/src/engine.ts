import { createFormatting } from './internal/formatting.js';
import { createPermissions } from './internal/permissions.js';
import { createStructure } from './internal/structure.js';
import { mappedIntervals, mappedRanges, inverseMap, rowBlocks } from './internal/structure-mapping.js';
import type { GridConfiguration } from './configuration.js';
import { restoreGridConfiguration } from './configuration.js';
import { readGridState } from './state.js';
import type { GridState } from './state.js';
import { LocalDataView, snapshotLocalView as snapshotView } from './data-source.js';
import type { LocalViewOptions } from './data-source.js';
import { blocksToTsv, encodeBlocks, decodeBlocks } from './clipboard.js';
import type { ClipboardBlock } from './clipboard.js';
import type { PasteOptions } from './types.js';
import { reorderedIndices } from './structure.js';
import type { StructureRequest } from './structure.js';
import type { CellUpdate, DataSource, RowId, DataRow, RowSplice } from './data-source.js';
import type {
  Column,
  CellSelection,
  SelectionRange,
  CellLockTarget,
  CellFormatTarget,
  CellFormat,
  CellFormatPatch,
  RowGroup,
  LayoutRequest,
} from './types.js';
import { resolvePermissions } from './permissions.js';
import type { CellPermission, CellPermissionPolicy, CellPermissionResolver } from './permissions.js';
import type { GridEvent, GridChangeSource } from './events.js';
import { GridAxis } from './axis.js';
import { createViewport } from './panes.js';
import type { ViewportOptions } from './panes.js';
import { clipboardCellLimit, clipboardTextLimit, decodeTsv } from './tsv.js';
import type {
  Change,
  EngineContext,
  FormatChange,
  FormatEntry,
  HistoryCommand,
  StructureState,
} from './internal/engine-context.js';
import { createHistory } from './internal/history.js';
export type GridInvalidation =
  | { readonly type: 'cells'; readonly cells: readonly { readonly rowIndex: number; readonly columnKey: string }[] }
  | { readonly type: 'selection'; readonly changed: boolean; readonly rangeChanged: boolean }
  | { readonly type: 'layout' }
  | { readonly type: 'structure'; readonly rowMap: readonly number[]; readonly columnMap: readonly number[] };

export interface GridEngineOptions {
  onObserverError?: (error: unknown) => void;
  allowMerging?: boolean;
  allowRowGrouping?: boolean;
  canChangeVisibility?: (
    request: Readonly<{ axis: 'row' | 'column'; indices: readonly number[]; hidden: boolean }>,
  ) => boolean;
  canChangeLayout?: (request: Readonly<LayoutRequest>) => boolean;
  columns: readonly Column[];
  view?: LocalViewOptions;
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
  let columns = Object.freeze(
    options.columns.map((column) =>
      Object.freeze({
        ...column,
        ...(column.permissions ? { permissions: Object.freeze({ ...column.permissions }) } : {}),
      }),
    ),
  );
  const rowHeight = options.rowHeight ?? 32;
  const columnWidth = options.columnWidth ?? 160;
  for (const size of [rowHeight, columnWidth]) {
    if (!Number.isFinite(size) || size <= 0) throw new RangeError('Grid sizes must be positive finite numbers.');
  }
  if (new Set(columns.map((column) => column.key)).size !== columns.length)
    throw new Error('Column keys must be unique.');
  const columnIndices = new Map(columns.map((column, index) => [column.key, index]));
  let rowCount = dataSource.getRowCount();
  if (!Number.isSafeInteger(rowCount) || rowCount < 0) throw new RangeError('Invalid row count.');
  let frozenRows = options.frozenRows ?? 0;
  let frozenColumns = options.frozenColumns ?? 0;
  for (const [count, limit] of [
    [frozenRows, rowCount],
    [frozenColumns, columns.length],
  ] as const) {
    if (!Number.isSafeInteger(count) || count < 0 || count > limit)
      throw new RangeError('Invalid frozen row or column count.');
  }
  if (!Number.isFinite(rowCount * rowHeight) || !Number.isFinite(columns.length * columnWidth))
    throw new RangeError('Grid dimensions overflow.');
  const rowAxis = new GridAxis(rowCount, rowHeight);
  const columnAxis = new GridAxis(columns.length, columnWidth);
  for (const [key, size] of Object.entries(options.columnWidths ?? {})) {
    const index = columnIndices.get(key);
    if (index === undefined) throw new Error('Unknown initial column width.');
    columnAxis.setSize(index, size);
  }
  const permissions = options.permissions ? Object.freeze({ ...options.permissions }) : undefined;
  let resolver = options.resolveCellPermission;
  let onEvent = options.onEvent;
  const allowLockChanges = options.allowLockChanges ?? true;
  if (typeof allowLockChanges !== 'boolean') throw new TypeError('allowLockChanges must be boolean.');
  let tableLocked = false;
  let merges: Readonly<SelectionRange>[] = [];
  let groups: Readonly<RowGroup>[] = [];
  let groupId = 0;
  const addedColumnKeys = new Set<string>();
  const manualRows = new Set<number>();
  const lockedRows = new Set<number>();
  const lockedColumns = new Set<number>();
  const lockedCells = new Set<string>();
  let busy = false;
  let destroyed = false;
  let onInvalidate = options.onInvalidate;
  const subscribers = new Set<{
    readonly onEvent?: (event: GridEvent) => void;
    readonly onInvalidate?: (change: GridInvalidation) => void;
  }>();
  const observerErrors: unknown[] = [];
  function observe(callback: (() => void) | undefined): void {
    try {
      callback?.();
    } catch (error) {
      observerErrors.push(error);
      if (observerErrors.length > 10) observerErrors.shift();
      try {
        options.onObserverError?.(error);
      } catch (reportError) {
        observerErrors.push(reportError);
        if (observerErrors.length > 10) observerErrors.shift();
      }
    }
  }
  let selection: CellSelection | null = null;
  let anchor: CellSelection | null = null;
  const retainedRanges: SelectionRange[] = [];

  const past: HistoryCommand[] = [];
  const future: HistoryCommand[] = [];
  let pendingCut:
    | { cells: readonly (CellUpdate & { rowId: RowId })[]; columnKeys: readonly string[]; blockCount: number }
    | undefined;
  const formats = new Map<string, FormatEntry>();
  let orderedFormats: FormatEntry[] = [];
  let formatOrder = 0;
  let view: Readonly<LocalViewOptions> = Object.freeze({});
  let projection: number[] | null = null;
  let reverseProjection = new Map<number, number>();
  let projectedAxis: GridAxis | null = null;
  let cachedRanges: SelectionRange[] | null = null;
  let cachedFrozenRows: number | null = null;
  let activeParts = 1;
  let displayAnchor: { row: number; col: number } | null = null;

  const context: EngineContext = {
    options,
    get dataSource() {
      return dataSource;
    },
    get columns() {
      return columns;
    },
    set columns(value) {
      columns = value;
    },
    get rowHeight() {
      return rowHeight;
    },
    get columnWidth() {
      return columnWidth;
    },
    get columnIndices() {
      return columnIndices;
    },
    get rowCount() {
      return rowCount;
    },
    set rowCount(value) {
      rowCount = value;
    },
    get frozenRows() {
      return frozenRows;
    },
    set frozenRows(value) {
      frozenRows = value;
    },
    get frozenColumns() {
      return frozenColumns;
    },
    set frozenColumns(value) {
      frozenColumns = value;
    },
    get rowAxis() {
      return rowAxis;
    },
    get columnAxis() {
      return columnAxis;
    },
    get permissions() {
      return permissions;
    },
    get resolver() {
      return resolver;
    },
    set resolver(value) {
      resolver = value;
    },
    get onEvent() {
      return onEvent;
    },
    set onEvent(value) {
      onEvent = value;
    },
    get allowLockChanges() {
      return allowLockChanges;
    },
    get tableLocked() {
      return tableLocked;
    },
    set tableLocked(value) {
      tableLocked = value;
    },
    get merges() {
      return merges;
    },
    set merges(value) {
      merges = value;
    },
    get groups() {
      return groups;
    },
    set groups(value) {
      groups = value;
    },
    get groupId() {
      return groupId;
    },
    set groupId(value) {
      groupId = value;
    },
    get addedColumnKeys() {
      return addedColumnKeys;
    },
    get manualRows() {
      return manualRows;
    },
    get lockedRows() {
      return lockedRows;
    },
    get lockedColumns() {
      return lockedColumns;
    },
    get lockedCells() {
      return lockedCells;
    },
    get busy() {
      return busy;
    },
    set busy(value) {
      busy = value;
    },
    get destroyed() {
      return destroyed;
    },
    set destroyed(value) {
      destroyed = value;
    },
    get onInvalidate() {
      return onInvalidate;
    },
    set onInvalidate(value) {
      onInvalidate = value;
    },
    get subscribers() {
      return subscribers;
    },
    get observerErrors() {
      return observerErrors;
    },
    get selection() {
      return selection;
    },
    set selection(value) {
      selection = value;
    },
    get anchor() {
      return anchor;
    },
    set anchor(value) {
      anchor = value;
    },
    get retainedRanges() {
      return retainedRanges;
    },
    get past() {
      return past;
    },
    get future() {
      return future;
    },
    get pendingCut() {
      return pendingCut;
    },
    set pendingCut(value) {
      pendingCut = value;
    },
    get formats() {
      return formats;
    },
    get orderedFormats() {
      return orderedFormats;
    },
    set orderedFormats(value) {
      orderedFormats = value;
    },
    get formatOrder() {
      return formatOrder;
    },
    set formatOrder(value) {
      formatOrder = value;
    },
    get view() {
      return view;
    },
    set view(value) {
      view = value;
    },
    get projection() {
      return projection;
    },
    set projection(value) {
      projection = value;
    },
    get reverseProjection() {
      return reverseProjection;
    },
    set reverseProjection(value) {
      reverseProjection = value;
    },
    get projectedAxis() {
      return projectedAxis;
    },
    set projectedAxis(value) {
      projectedAxis = value;
    },
    get cachedRanges() {
      return cachedRanges;
    },
    set cachedRanges(value) {
      cachedRanges = value;
    },
    get cachedFrozenRows() {
      return cachedFrozenRows;
    },
    set cachedFrozenRows(value) {
      cachedFrozenRows = value;
    },
    get activeParts() {
      return activeParts;
    },
    set activeParts(value) {
      activeParts = value;
    },
    get displayAnchor() {
      return displayAnchor;
    },
    set displayAnchor(value) {
      displayAnchor = value;
    },
    get emptyFormat() {
      return emptyFormat;
    },
  };
  function viewAxis(): GridAxis {
    return projectedAxis ?? rowAxis;
  }
  function visibleFrozenRows(): number {
    if (!projection || !groups.some((group) => group.collapsed)) return Math.min(frozenRows, visibleRowCount());
    return (cachedFrozenRows ??= projection.reduce((count, row) => count + (row < frozenRows ? 1 : 0), 0));
  }
  function rebuildViewAxis(): void {
    if (!projection) {
      projectedAxis = null;
      return;
    }
    const axis = new GridAxis(projection.length, rowHeight);
    axis.replace(
      projection.length,
      rowAxis.snapshot().flatMap(([row, size]) => {
        const index = reverseProjection.get(row);
        return index === undefined ? [] : [[index, size] as const];
      }),
    );
    projectedAxis = axis;
    axis.replaceHidden(
      rowAxis.hiddenIndices().flatMap((row) => {
        const index = reverseProjection.get(row);
        return index === undefined ? [] : [index];
      }),
    );
  }
  function buildProjection(
    next: LocalViewOptions,
    count = rowCount,
    spans: readonly Readonly<SelectionRange>[] = merges,
    outlines: readonly Readonly<RowGroup>[] = groups,
    frozen = frozenRows,
  ): number[] | null {
    if (!next.sort && !next.sorts?.length && !next.filters?.length) {
      const hidden = outlines.filter((group) => group.collapsed);
      return hidden.length
        ? Array.from({ length: count }, (_, i) => i).filter(
            (row) => !hidden.some((group) => row > group.startRow && row <= group.endRow),
          )
        : null;
    }
    for (const key of [
      next.sort?.columnKey,
      ...(next.sorts ?? []).map((sort) => sort.columnKey),
      ...(next.filters ?? []).map((filter) => filter.columnKey),
    ]) {
      if (key !== undefined && !columnIndices.has(key)) throw new Error('Unknown view column: ' + key);
    }
    if (spans.length || outlines.length) {
      // Outline blocks move as units; filters retain the entire block if any member matches.
      const intervals = [
        ...spans.map((span) => [span.startRow, span.endRow] as const),
        ...outlines.map((group) => [group.startRow, group.endRow] as const),
      ].sort((a, b) => a[0] - b[0]);
      const combined: [number, number][] = [];
      for (const interval of intervals) {
        const last = combined.at(-1);
        if (last && interval[0] <= last[1]) last[1] = Math.max(last[1], interval[1]);
        else combined.push([...interval]);
      }
      const matches = new LocalDataView(dataSource, { ...(next.filters ? { filters: next.filters } : {}) }),
        matching = new Set(Array.from({ length: matches.getRowCount() }, (_, i) => matches.getSourceIndex(i)));
      const blocks: { start: number; end: number }[] = [];
      let intervalIndex = 0;
      for (let row = 0; row < count;) {
        const interval = combined[intervalIndex];
        const end = interval?.[0] === row ? interval[1] : row;
        if (interval?.[0] === row) intervalIndex++;
        if (Array.from({ length: end - row + 1 }, (_, i) => row + i).some((i) => matching.has(i)))
          blocks.push({ start: row, end });
        row = end + 1;
      }
      const pinned = blocks.filter((block) => block.start < frozen),
        movable = blocks.filter((block) => block.start >= frozen);
      const ordered = new LocalDataView(
        {
          getRowCount: () => movable.length,
          getRowId: (i) => i,
          getValue: (i, key) => dataSource.getValue(movable[i]!.start, key),
        },
        { ...(next.sort ? { sort: next.sort } : {}), ...(next.sorts ? { sorts: next.sorts } : {}) },
      );
      const hidden = outlines.filter((group) => group.collapsed);
      return [
        ...pinned,
        ...Array.from({ length: ordered.getRowCount() }, (_, i) => movable[ordered.getSourceIndex(i)]!),
      ].flatMap((block) =>
        Array.from({ length: block.end - block.start + 1 }, (_, i) => block.start + i).filter(
          (row) => !hidden.some((group) => row > group.startRow && row <= group.endRow),
        ),
      );
    }
    const local = new LocalDataView(dataSource, next);
    return next.sort || next.sorts?.length || next.filters?.length
      ? Array.from({ length: local.getRowCount() }, (_, i) => local.getSourceIndex(i))
      : null;
  }
  function installProjection(next: number[] | null): void {
    projection = next;
    reverseProjection = new Map(next?.map((row, index) => [row, index]) ?? []);
    cachedRanges = null;
    cachedFrozenRows = null;
    rebuildViewAxis();
  }
  function displayRow(row: number): number {
    return projection ? (reverseProjection.get(row) ?? -1) : row;
  }
  function displaySelection(): CellSelection | null {
    if (!selection) return null;
    const rowIndex = displayRow(selection.rowIndex);
    if (rowIndex >= 0) return { ...selection, rowIndex };
    const range = displaySelectionRanges().at(-1);
    return range
      ? {
          rowIndex: range.startRow,
          rowId: dataSource.getRowId(sourceRow(range.startRow)),
          columnIndex: range.startColumn,
          columnKey: columns[range.startColumn]!.key,
        }
      : null;
  }
  function setView(next: LocalViewOptions): void {
    assertAlive();
    const snapshot = snapshotView(next);
    const nextProjection = buildProjection(snapshot);
    const old = projection ?? Array.from({ length: rowCount }, (_, i) => i);
    view = snapshot;
    installProjection(nextProjection);
    displayAnchor = null;
    notify(
      { type: 'structure', rowMap: old.map(displayRow), columnMap: columns.map((_, i) => i) },
      Object.freeze({ type: 'view:change', view, rowCount: visibleRowCount(), sourceRowCount: rowCount }),
    );
  }
  function sourceTarget<T extends CellLockTarget>(target: T): T {
    return target.scope === 'row' || target.scope === 'cell'
      ? { ...target, rowIndex: sourceRow(target.rowIndex) }
      : target;
  }
  function sourceRanges(range: SelectionRange): SelectionRange[] {
    if (
      ![range.startRow, range.endRow, range.startColumn, range.endColumn].every(Number.isSafeInteger) ||
      range.startRow < 0 ||
      range.endRow < range.startRow ||
      range.endRow >= visibleRowCount() ||
      range.startColumn < 0 ||
      range.endColumn < range.startColumn ||
      range.endColumn >= columns.length
    )
      throw new RangeError('Invalid selection range.');
    if (!projection) return [{ ...range }];
    const rows = Array.from({ length: range.endRow - range.startRow + 1 }, (_, i) =>
      sourceRow(range.startRow + i),
    ).sort((a, b) => a - b);
    const result: SelectionRange[] = [];
    for (const row of rows) {
      const last = result.at(-1);
      if (last && last.endRow + 1 === row) last.endRow = row;
      else result.push({ ...range, startRow: row, endRow: row });
    }
    return result;
  }
  function sourceFormats(targets: readonly CellFormatTarget[]): CellFormatTarget[] {
    return targets.flatMap<CellFormatTarget>((target) =>
      target.scope === 'range'
        ? sourceRanges(target.range).map((range) => ({ scope: 'range' as const, range }))
        : [sourceTarget(target)],
    );
  }
  function selectDisplayRange(range: SelectionRange, mode: 'replace' | 'add' | 'extend' = 'replace'): boolean {
    assertAlive();
    if (merges.length)
      range = expandMergedRange(
        range,
        merges.map((span) => ({ ...span, startRow: displayRow(span.startRow), endRow: displayRow(span.endRow) })),
      );
    const parts = sourceRanges(range);
    if (
      !getCellPermission(sourceRow(range.startRow), range.startColumn).selectable ||
      !getCellPermission(sourceRow(range.endRow), range.endColumn).selectable
    )
      return false;
    if (!['replace', 'add', 'extend'].includes(mode)) throw new TypeError('Invalid selection mode.');
    if (mode === 'add' && displaySelectionRanges().length >= 128)
      throw new RangeError('Selection supports at most 128 ranges.');
    const old = getSelectionRanges();
    const keep =
      mode === 'replace' ? [] : mode === 'extend' ? old.slice(0, Math.max(0, old.length - activeParts)) : old;
    const row = sourceRow(range.startRow);
    const others = parts.flatMap((part) =>
      row < part.startRow || row > part.endRow
        ? [part]
        : [
            ...(part.startRow < row ? [{ ...part, endRow: row - 1 }] : []),
            ...(row < part.endRow ? [{ ...part, startRow: row + 1 }] : []),
          ],
    );
    if (keep.length + others.length + 1 > 128) throw new RangeError('Selection supports at most 128 source ranges.');
    retainedRanges.splice(0, retainedRanges.length, ...keep, ...others);
    selection = {
      rowIndex: row,
      rowId: dataSource.getRowId(row),
      columnIndex: range.startColumn,
      columnKey: columns[range.startColumn]!.key,
    };
    anchor = {
      rowIndex: row,
      rowId: selection.rowId,
      columnIndex: range.endColumn,
      columnKey: columns[range.endColumn]!.key,
    };
    activeParts = others.length + 1;
    cachedRanges = null;
    displayAnchor = { row: range.startRow, col: range.startColumn };
    notifySelection(true, true);
    return true;
  }
  function selectDisplay(row: number, col: number, extend = false, add = false): boolean {
    if (!projection && activeParts === 1) {
      displayAnchor = { row, col };
      return select(row, col, extend, add);
    }
    const span = mergeAt(sourceRow(row), col);
    if (span) {
      row = displayRow(span.startRow);
      col = span.startColumn;
    }
    const from = extend
      ? (displayAnchor ?? { row: displaySelection()?.rowIndex ?? row, col: displaySelection()?.columnIndex ?? col })
      : { row, col };
    const result = selectDisplayRange(
      {
        startRow: Math.min(from.row, row),
        endRow: Math.max(from.row, row),
        startColumn: Math.min(from.col, col),
        endColumn: Math.max(from.col, col),
      },
      add ? 'add' : extend ? 'extend' : 'replace',
    );
    displayAnchor = from;
    return result;
  }

  function intersects(a: Readonly<SelectionRange>, b: Readonly<SelectionRange>): boolean {
    return (
      a.startRow <= b.endRow && b.startRow <= a.endRow && a.startColumn <= b.endColumn && b.startColumn <= a.endColumn
    );
  }
  function mergeAt(row: number, col: number): Readonly<SelectionRange> | undefined {
    return merges.find(
      (range) => row >= range.startRow && row <= range.endRow && col >= range.startColumn && col <= range.endColumn,
    );
  }
  function expandMergedRange(
    range: SelectionRange,
    spans: readonly Readonly<SelectionRange>[] = merges,
  ): SelectionRange {
    const result = { ...range };
    let changed = true;
    while (changed) {
      changed = false;
      for (const span of spans)
        if (intersects(result, span)) {
          const next = {
            startRow: Math.min(result.startRow, span.startRow),
            endRow: Math.max(result.endRow, span.endRow),
            startColumn: Math.min(result.startColumn, span.startColumn),
            endColumn: Math.max(result.endColumn, span.endColumn),
          };
          if (JSON.stringify(next) !== JSON.stringify(result)) {
            Object.assign(result, next);
            changed = true;
          }
        }
    }
    return result;
  }
  function validateMergeFreeze(
    spans: readonly Readonly<SelectionRange>[],
    rows = frozenRows,
    cols = frozenColumns,
  ): void {
    if (
      spans.some(
        (span) => (span.startRow < rows && span.endRow >= rows) || (span.startColumn < cols && span.endColumn >= cols),
      )
    )
      throw new Error('A merged cell cannot cross a frozen boundary.');
  }
  function layoutAllowed(request: LayoutRequest): boolean {
    assertAlive();
    if (!request || !['merge', 'unmerge', 'group', 'ungroup', 'collapse', 'expand'].includes(request.kind))
      return false;
    if ('range' in request) {
      const range = request.range;
      if (
        !range ||
        ![range.startRow, range.endRow, range.startColumn, range.endColumn].every(Number.isSafeInteger) ||
        range.startRow < 0 ||
        range.endRow < range.startRow ||
        range.endRow >= rowCount ||
        range.startColumn < 0 ||
        range.endColumn < range.startColumn ||
        range.endColumn >= columns.length
      )
        return false;
    } else {
      const group = request.group;
      if (
        !group ||
        typeof group.id !== 'string' ||
        !Number.isSafeInteger(group.startRow) ||
        !Number.isSafeInteger(group.endRow) ||
        group.startRow < 0 ||
        group.endRow <= group.startRow ||
        group.endRow >= rowCount ||
        typeof group.collapsed !== 'boolean'
      )
        return false;
    }
    const snapshot = Object.freeze(
      'range' in request
        ? { ...request, range: Object.freeze({ ...request.range }) }
        : { ...request, group: Object.freeze({ ...request.group }) },
    );
    if (tableLocked || options.canChangeLayout?.(snapshot) === false) return false;
    if ('range' in request) {
      if (options.allowMerging === false) return false;
      const range = request.range;
      if ((range.endRow - range.startRow + 1) * (range.endColumn - range.startColumn + 1) > clipboardCellLimit)
        return false;
      for (let row = range.startRow; row <= range.endRow; row++)
        for (let col = range.startColumn; col <= range.endColumn; col++)
          if (!getCellPermission(row, col).writable) return false;
    } else {
      if (options.allowRowGrouping === false) return false;
      for (let row = request.group.startRow; row <= request.group.endRow; row++) if (lockedRows.has(row)) return false;
    }
    return true;
  }
  function notifyOutline(kind: 'merge' | 'group', old: readonly number[], source: 'api' | 'undo' | 'redo'): void {
    if (selection) {
      const span = mergeAt(selection.rowIndex, selection.columnIndex);
      if (span)
        selection = {
          rowIndex: span.startRow,
          columnIndex: span.startColumn,
          rowId: dataSource.getRowId(span.startRow),
          columnKey: columns[span.startColumn]!.key,
        };
    }
    installProjection(buildProjection(view));
    notify(
      { type: 'structure', rowMap: old.map(displayRow), columnMap: columns.map((_, i) => i) },
      Object.freeze({ type: kind === 'merge' ? 'merge:change' : 'group:change', source }),
    );
  }
  function changeOutline(
    requests: readonly LayoutRequest[],
    nextMerges: readonly Readonly<SelectionRange>[],
    nextGroups: readonly Readonly<RowGroup>[],
  ): void {
    if (nextMerges.length > 1024 || nextGroups.length > 1024)
      throw new RangeError('At most 1024 merged regions and row groups are supported.');
    if (requests.some((request) => !layoutAllowed(request)))
      throw new Error('Changing merged cells or row groups is disabled.');
    const old = projection ?? Array.from({ length: rowCount }, (_, i) => i);
    const entry: Extract<HistoryCommand, { kind: 'outline' }> = {
      kind: 'outline',
      requests,
      beforeMerges: merges,
      afterMerges: nextMerges,
      beforeGroups: groups,
      afterGroups: nextGroups,
    };
    merges = [...nextMerges];
    groups = [...nextGroups];
    past.push(entry);
    if (past.length > 100) past.shift();
    future.length = 0;
    notifyOutline(requests[0] && 'range' in requests[0] ? 'merge' : 'group', old, 'api');
  }
  function mergeRange(range: SelectionRange): Readonly<SelectionRange> {
    const parts = sourceRanges(range);
    if (parts.length !== 1 || parts[0]!.endRow - parts[0]!.startRow !== range.endRow - range.startRow)
      throw new Error('Merged rows must be contiguous and visible.');
    return Object.freeze(parts[0]!);
  }
  function canMerge(range: SelectionRange): boolean {
    try {
      if ((range.endRow - range.startRow + 1) * (range.endColumn - range.startColumn + 1) > clipboardCellLimit)
        return false;
      const span = mergeRange(range);
      validateMergeFreeze([span]);
      return (
        (span.startRow !== span.endRow || span.startColumn !== span.endColumn) &&
        !merges.some((other) => intersects(span, other)) &&
        layoutAllowed({ kind: 'merge', range: span })
      );
    } catch {
      return false;
    }
  }
  function mergeCells(range: SelectionRange): void {
    if (!canMerge(range))
      throw new Error('This range cannot be merged. Check locks, existing merges and frozen boundaries.');
    const span = mergeRange(range);
    changeOutline([{ kind: 'merge', range: span }], [...merges, span], groups);
  }
  function unmergeCells(range: SelectionRange): void {
    const parts = sourceRanges(range),
      removed = merges.filter((span) => parts.some((part) => intersects(part, span)));
    if (!removed.length) return;
    changeOutline(
      removed.map((span) => ({ kind: 'unmerge', range: span })),
      merges.filter((span) => !removed.includes(span)),
      groups,
    );
  }
  function groupRows(startRow: number, endRow: number): string {
    sourceRow(startRow);
    sourceRow(endRow);
    if (projection || view.sort || view.sorts?.length || view.filters?.length || endRow <= startRow)
      throw new Error('Group at least two contiguous rows in an expanded, unsorted view.');
    if (
      groups.some(
        (group) =>
          (group.startRow === startRow && group.endRow === endRow) ||
          (group.startRow <= endRow &&
            startRow <= group.endRow &&
            !(
              (startRow <= group.startRow && endRow >= group.endRow) ||
              (group.startRow <= startRow && group.endRow >= endRow)
            )),
      )
    )
      throw new Error('Row groups must be nested or disjoint.');
    let id: string;
    do {
      id = 'group-' + ++groupId;
    } while (groups.some((group) => group.id === id));
    const group = Object.freeze({ id, startRow, endRow, collapsed: false });
    changeOutline([{ kind: 'group', group }], merges, [...groups, group]);
    return group.id;
  }
  function findGroup(id: string): Readonly<RowGroup> {
    const group = groups.find((group) => group.id === id);
    if (!group) throw new Error('Unknown row group.');
    return group;
  }
  function ungroupRows(id: string): void {
    const group = findGroup(id);
    changeOutline(
      [{ kind: 'ungroup', group }],
      merges,
      groups.filter((other) => other !== group),
    );
  }
  function setGroupCollapsed(id: string, collapsed: boolean): void {
    if (typeof collapsed !== 'boolean') throw new TypeError('Collapsed must be boolean.');
    const group = findGroup(id);
    if (group.collapsed === collapsed) return;
    if (collapsed && merges.some((span) => span.endRow > group.startRow && span.startRow <= group.endRow))
      throw new Error('Unmerge cells in these rows before collapsing the group.');
    if (collapsed && group.startRow < frozenRows && group.endRow >= frozenRows)
      throw new Error('A collapsed group cannot cross a frozen boundary.');
    changeOutline(
      [{ kind: collapsed ? 'collapse' : 'expand', group }],
      merges,
      groups.map((other) => (other === group ? Object.freeze({ ...group, collapsed }) : other)),
    );
  }
  function mergedViewport(options: ViewportOptions) {
    const axis = viewAxis(),
      viewport = createViewport(axis, columnAxis, visibleFrozenRows(), frozenColumns, options);
    return Object.freeze({
      ...viewport,
      hitTest(x: number, y: number) {
        const hit = viewport.hitTest(x, y);
        if (!hit) return null;
        const span = mergeAt(sourceRow(hit.row), hit.col);
        return span ? { row: displayRow(span.startRow), col: span.startColumn } : hit;
      },
      cellRect(row: number, col: number) {
        const base = viewport.cellRect(row, col),
          span = mergeAt(sourceRow(row), col);
        if (!span) return base;
        const first = displayRow(span.startRow),
          last = displayRow(span.endRow),
          rect = viewport.cellRect(first, span.startColumn);
        return Object.freeze({
          ...rect,
          width: columnAxis.position(span.endColumn + 1) - columnAxis.position(span.startColumn),
          height: axis.position(last + 1) - axis.position(first),
        });
      },
    });
  }

  const emptyFormat: Readonly<CellFormat> = Object.freeze({});

  function assertAlive(): void {
    if (destroyed) throw new Error('Grid is destroyed.');
  }

  function command<T>(run: () => T): T {
    if (busy) throw new Error('Nested grid mutations are not allowed.');
    busy = true;
    try {
      return run();
    } finally {
      busy = false;
    }
  }

  function query<T>(run: () => T): T {
    const wasBusy = busy;
    busy = true;
    try {
      return run();
    } finally {
      busy = wasBusy;
    }
  }

  function notify(change: GridInvalidation, event: GridEvent): void {
    cachedRanges = null;
    cachedFrozenRows = null;
    if (projection && change.type === 'cells') {
      const old = projection;
      installProjection(buildProjection(view));
      if (old.length !== projection!.length || old.some((row, i) => row !== projection![i])) {
        displayAnchor = null;
        change = { type: 'structure', rowMap: old.map(displayRow), columnMap: columns.map((_, i) => i) };
      } else
        change = {
          type: 'cells',
          cells: change.cells.flatMap((cell) => {
            const rowIndex = displayRow(cell.rowIndex);
            return rowIndex < 0 ? [] : [{ ...cell, rowIndex }];
          }),
        };
    } else if (change.type === 'layout') rebuildViewAxis();
    observe(() => onInvalidate?.(change));
    observe(() => onEvent?.(event));
    for (const subscriber of [...subscribers]) {
      if (!subscribers.has(subscriber)) continue;
      observe(() => subscriber.onInvalidate?.(change));
      observe(() => subscriber.onEvent?.(event));
    }
  }

  function notifyCells(changes: readonly Change[], source: GridChangeSource): void {
    notify(
      { type: 'cells', cells: changes.map(({ rowIndex, columnKey }) => ({ rowIndex, columnKey })) },
      Object.freeze({
        type: 'cell:change',
        source,
        changes: Object.freeze(changes.map((change) => Object.freeze({ ...change }))),
      }),
    );
  }

  function write(changes: readonly CellUpdate[]): void {
    if (changes.length === 1 && dataSource.setValue) {
      const change = changes[0]!;
      dataSource.setValue(change.rowIndex, change.columnKey, change.value);
    } else if (dataSource.setValues) dataSource.setValues(changes);
    else throw new Error('An atomic setValues method is required for batch writes.');
  }

  function applyUpdates(
    updates: readonly CellUpdate[],
    source: GridChangeSource = 'api',
    formatChanges: FormatChange[] = [],
  ): void {
    assertAlive();
    const unique = new Map<string, CellUpdate>();
    for (const update of updates) {
      if (!Number.isSafeInteger(update.rowIndex) || update.rowIndex < 0 || update.rowIndex >= rowCount)
        throw new RangeError('Invalid row index.');
      if (!columnIndices.has(update.columnKey)) throw new Error(`Unknown column: ${update.columnKey}`);
      unique.set(`${update.rowIndex}:${update.columnKey}`, { ...update });
    }
    const changes: Change[] = [...unique.values()]
      .map((update) => ({
        ...update,
        previous: dataSource.getValue(update.rowIndex, update.columnKey),
        rowId: dataSource.getRowId(update.rowIndex),
      }))
      .filter((change) => !Object.is(change.previous, change.value));
    if (!changes.length && !formatChanges.length) return;
    for (const change of changes) requirePermission(change.rowIndex, columnIndices.get(change.columnKey)!, 'writable');
    for (const change of changes) {
      const column = columns[columnIndices.get(change.columnKey)!]!;
      const message = column.validate?.(change.value);
      if (message && column.invalidInput !== 'allow') throw new Error(message);
    }
    if (changes.length) write(changes);
    writeFormats(formatChanges);
    past.push({ kind: 'values', changes, formats: formatChanges });
    // keep the latest 100 commands; large values remain shallow caller-owned references.
    if (past.length > 100) past.shift();
    future.length = 0;
    if (changes.length) notifyCells(changes, source);
    if (formatChanges.length) notifyFormats(formatChanges, source === 'paste' ? 'paste' : 'api');
  }

  function getSelection(): CellSelection | null {
    return selection ? { ...selection } : null;
  }

  function getSelectionRange(): SelectionRange | null {
    if (!selection || !anchor) return null;
    return expandMergedRange({
      startRow: Math.min(anchor.rowIndex, selection.rowIndex),
      endRow: Math.max(anchor.rowIndex, selection.rowIndex),
      startColumn: Math.min(anchor.columnIndex, selection.columnIndex),
      endColumn: Math.max(anchor.columnIndex, selection.columnIndex),
    });
  }

  function getSelectionRanges(): SelectionRange[] {
    const range = getSelectionRange();
    return range ? [...retainedRanges.map((range) => ({ ...range })), range] : [];
  }

  function displaySelectionRanges(): SelectionRange[] {
    if (!projection && activeParts === 1) return getSelectionRanges();
    if (cachedRanges) return cachedRanges.map((range) => ({ ...range }));
    const grouped = new Map<string, Set<number>>();
    for (const range of getSelectionRanges()) {
      const key = range.startColumn + ':' + range.endColumn;
      const rows = grouped.get(key) ?? new Set<number>();
      grouped.set(key, rows);
      for (let row = range.startRow; row <= range.endRow; row++) {
        const index = displayRow(row);
        if (index >= 0) rows.add(index);
      }
    }
    const result: SelectionRange[] = [];
    for (const [key, rows] of grouped) {
      const [startColumn, endColumn] = key.split(':').map(Number);
      let last: SelectionRange | undefined;
      for (const row of [...rows].sort((a, b) => a - b)) {
        if (last && last.endRow + 1 === row) last.endRow = row;
        else {
          last = { startRow: row, endRow: row, startColumn: startColumn!, endColumn: endColumn! };
          result.push(last);
        }
      }
    }
    if (selection) {
      const row = displayRow(selection.rowIndex),
        col = selection.columnIndex;
      const index = result.findIndex(
        (range) => row >= range.startRow && row <= range.endRow && col >= range.startColumn && col <= range.endColumn,
      );
      if (index >= 0) result.push(...result.splice(index, 1));
    }
    cachedRanges = result;
    return result.map((range) => ({ ...range }));
  }
  function sourceRow(index: number): number {
    if (!Number.isSafeInteger(index) || index < 0 || index >= visibleRowCount())
      throw new RangeError('Invalid row index in view.');
    return projection ? projection[index]! : index;
  }
  function visibleRowCount(): number {
    return projection?.length ?? rowCount;
  }
  function clipboardBlocks(): ClipboardBlock[] {
    assertAlive();
    const ranges = displaySelectionRanges().sort((a, b) => a.startRow - b.startRow || a.startColumn - b.startColumn);
    if (!ranges.length) return [];
    if (ranges.length > 128) throw new RangeError('Clipboard supports at most 128 visible ranges.');
    const firstRow = Math.min(...ranges.map((range) => range.startRow)),
      firstColumn = Math.min(...ranges.map((range) => range.startColumn));
    let cells = 0,
      length = 0;
    return ranges.map((range) => {
      cells += (range.endRow - range.startRow + 1) * (range.endColumn - range.startColumn + 1);
      if (cells > clipboardCellLimit) throw new RangeError('Selection has too many cells.');
      const values: string[][] = [],
        cellFormats: CellFormat[][] = [];
      for (let row = range.startRow; row <= range.endRow; row++) {
        const line: string[] = [],
          formatLine: CellFormat[] = [];
        for (let col = range.startColumn; col <= range.endColumn; col++) {
          const index = sourceRow(row);
          requirePermission(index, col, 'copyable');
          const span = mergeAt(index, col),
            value =
              span && (index !== span.startRow || col !== span.startColumn)
                ? null
                : dataSource.getValue(index, columns[col]!.key),
            text = value == null ? '' : String(value);
          length += text.length;
          if (length > clipboardTextLimit) throw new RangeError('Selection text is too large.');
          line.push(text);
          formatLine.push(getFormat(index, col));
        }
        values.push(line);
        cellFormats.push(formatLine);
      }
      return {
        row: range.startRow - firstRow,
        column: range.startColumn - firstColumn,
        values,
        ...(cellFormats.some((line) => line.some((format) => Object.keys(format).length))
          ? { formats: cellFormats }
          : {}),
      };
    });
  }
  function copySelection(): string {
    return blocksToTsv(clipboardBlocks());
  }
  function cutSelectionBlocks(): string {
    const blocks = clipboardBlocks();
    if (!blocks.length) throw new Error('Select cells before cutting.');
    const cells = new Map<string, CellUpdate & { rowId: RowId }>();
    for (const range of displaySelectionRanges())
      for (let row = range.startRow; row <= range.endRow; row++)
        for (let col = range.startColumn; col <= range.endColumn; col++) {
          const rowIndex = sourceRow(row),
            columnKey = columns[col]!.key;
          if (mergeAt(rowIndex, col)) throw new Error('Unmerge cells before cutting.');
          requirePermission(rowIndex, col, 'writable');
          cells.set(`${rowIndex}:${columnKey}`, {
            rowIndex,
            columnKey,
            rowId: dataSource.getRowId(rowIndex),
            value: dataSource.getValue(rowIndex, columnKey),
          });
        }
    const text = encodeBlocks(blocks);
    pendingCut = {
      cells: [...cells.values()],
      columnKeys: columns.map((column) => column.key),
      blockCount: blocks.length,
    };
    return text;
  }
  function pasteBlocks(
    blocks: readonly ClipboardBlock[],
    structured: boolean,
    move = false,
    options: PasteOptions = {},
  ): void {
    assertAlive();
    if (
      !options ||
      typeof options !== 'object' ||
      (options.mode !== undefined && !['all', 'values', 'formats'].includes(options.mode)) ||
      (options.transpose !== undefined && typeof options.transpose !== 'boolean') ||
      (options.skipEmpty !== undefined && typeof options.skipEmpty !== 'boolean')
    )
      throw new TypeError('Invalid paste options.');
    const mode = options.mode ?? 'all';
    if (move && (mode !== 'all' || options.transpose || options.skipEmpty))
      throw new Error('Cut cannot use paste special.');
    if (options.transpose)
      blocks = blocks.map((block) => ({
        ...block,
        row: block.column,
        column: block.row,
        values: block.values[0]!.map((_, col) => block.values.map((row) => row[col]!)),
        ...(block.formats
          ? { formats: block.formats[0]!.map((_, col) => block.formats!.map((row) => row[col]!)) }
          : {}),
      }));
    const ranges = displaySelectionRanges().sort((a, b) => a.startRow - b.startRow || a.startColumn - b.startColumn);
    if (!ranges.length) return;
    const cut = move ? pendingCut : undefined;
    if (move && !cut) throw new Error('No pending cut.');
    if (cut) {
      if (blocks.length !== cut.blockCount || (ranges.length > 1 && ranges.length !== blocks.length))
        throw new Error('Cut requires matching destination ranges.');
      if (cut.columnKeys.length !== columns.length || cut.columnKeys.some((key, index) => key !== columns[index]!.key))
        throw new Error('Columns changed after cut. Cut again.');
      for (const cell of cut.cells) {
        if (
          cell.rowIndex >= rowCount ||
          dataSource.getRowId(cell.rowIndex) !== cell.rowId ||
          !Object.is(dataSource.getValue(cell.rowIndex, cell.columnKey), cell.value)
        )
          throw new Error('Cut source changed. Cut again.');
        requirePermission(cell.rowIndex, columnIndices.get(cell.columnKey)!, 'writable');
      }
    }
    const broadcast =
      !move && blocks.length === 1 && blocks[0]!.values.length === 1 && blocks[0]!.values[0]!.length === 1;
    if (structured && !broadcast && ranges.length > 1 && ranges.length !== blocks.length)
      throw new Error('Clipboard and target range counts must match.');
    const placements: (ClipboardBlock & { col: number; height?: number; width?: number })[] = broadcast
      ? ranges.map((range) => ({
          ...blocks[0]!,
          row: range.startRow,
          col: range.startColumn,
          height: range.endRow - range.startRow + 1,
          width: range.endColumn - range.startColumn + 1,
        }))
      : structured
        ? ranges.length === 1
          ? blocks.map((block) => ({
              ...block,
              row: ranges[0]!.startRow + block.row,
              col: ranges[0]!.startColumn + block.column,
            }))
          : blocks.map((block, i) => ({ ...block, row: ranges[i]!.startRow, col: ranges[i]!.startColumn }))
        : ranges.map((range) => ({ ...blocks[0]!, row: range.startRow, col: range.startColumn }));
    let cells = 0;
    const texts = new Map<
      string,
      { rowIndex: number; columnKey: string; columnIndex: number; text: string; format?: CellFormat }
    >();
    for (const place of placements) {
      const height = place.height ?? place.values.length,
        width = place.width ?? place.values[0]!.length;
      cells += height * width;
      if (cells > clipboardCellLimit) throw new RangeError('Paste has too many cells.');
      if (place.row + height > visibleRowCount() || place.col + width > columns.length)
        throw new RangeError('Paste extends beyond grid bounds.');
      for (let row = 0; row < height; row++)
        for (let col = 0; col < width; col++) {
          const rowIndex = sourceRow(place.row + row),
            columnIndex = place.col + col,
            columnKey = columns[columnIndex]!.key,
            text = place.values[broadcast ? 0 : row]![broadcast ? 0 : col]!,
            key = `${rowIndex}:${columnKey}`,
            previous = texts.get(key);
          if (options.skipEmpty && text === '') continue;
          const span = mergeAt(rowIndex, columnIndex);
          if (span && (rowIndex !== span.startRow || columnIndex !== span.startColumn)) {
            if (mode !== 'formats' && text !== '')
              throw new Error('Paste would overwrite a hidden merged value. Unmerge first.');
            continue;
          }
          if (previous && previous.text !== text)
            throw new Error('Overlapping paste targets contain conflicting values.');
          const format = mode === 'values' ? undefined : place.formats?.[broadcast ? 0 : row]?.[broadcast ? 0 : col];
          if (previous && JSON.stringify(previous.format) !== JSON.stringify(format))
            throw new Error('Overlapping paste targets contain conflicting formats.');
          texts.set(key, { rowIndex, columnKey, columnIndex, text, ...(format ? { format } : {}) });
        }
    }
    for (const cell of texts.values()) {
      if (mode !== 'formats') requirePermission(cell.rowIndex, cell.columnIndex, 'pasteable');
      if (cell.format && Object.keys(cell.format).length)
        requireFormatPermission({
          startRow: cell.rowIndex,
          endRow: cell.rowIndex,
          startColumn: cell.columnIndex,
          endColumn: cell.columnIndex,
        });
    }
    const updates =
      mode === 'formats'
        ? []
        : [...texts.values()].map((cell) => {
            const column = columns[cell.columnIndex]!,
              current = dataSource.getValue(cell.rowIndex, column.key);
            if (!column.parse && current != null && typeof current !== 'string')
              throw new Error('Column requires a parser: ' + column.key);
            return {
              rowIndex: cell.rowIndex,
              columnKey: column.key,
              value: column.parse ? column.parse(cell.text) : cell.text,
            };
          });
    if (cut)
      for (const cell of cut.cells)
        if (!texts.has(`${cell.rowIndex}:${cell.columnKey}`))
          updates.push({ rowIndex: cell.rowIndex, columnKey: cell.columnKey, value: null });
    const formatChanges: FormatChange[] = [];
    for (const cell of texts.values())
      if (cell.format && Object.keys(cell.format).length) {
        const bounds = {
          startRow: cell.rowIndex,
          endRow: cell.rowIndex,
          startColumn: cell.columnIndex,
          endColumn: cell.columnIndex,
        };
        requireFormatPermission(bounds);
        const target = { scope: 'cell' as const, rowIndex: cell.rowIndex, columnIndex: cell.columnIndex };
        const key = JSON.stringify(['cell', cell.rowIndex, cell.rowIndex, cell.columnIndex, cell.columnIndex]);
        const previous = formats.get(key),
          orders = { ...previous?.orders };
        for (const property of Object.keys(cell.format) as (keyof CellFormat)[]) orders[property] = ++formatOrder;
        formatChanges.push({
          key,
          previous,
          value: {
            target,
            bounds: Object.freeze(bounds),
            patch: Object.freeze({ ...previous?.patch, ...cell.format }),
            orders: Object.freeze(orders),
            order: formatOrder,
          },
        });
      }
    applyUpdates(updates, 'paste', formatChanges);
    if (move) pendingCut = undefined;
    // Preserve selection when a live filter removes a pasted row from the visible view.
    const targets = placements.map((place) => ({
      startRow: place.row,
      endRow: place.row + (place.height ?? place.values.length) - 1,
      startColumn: place.col,
      endColumn: place.col + (place.width ?? place.values[0]!.length) - 1,
    }));
    if (targets.length <= 128 && targets.every((range) => range.endRow < visibleRowCount()))
      targets.forEach((range, index) =>
        !projection && activeParts === 1
          ? selectRange(range, index === 0 ? 'replace' : 'add')
          : selectDisplayRange(range, index === 0 ? 'replace' : 'add'),
      );
  }
  function paste(text: string, options?: PasteOptions): void {
    pasteBlocks([{ row: 0, column: 0, values: decodeTsv(text) }], false, false, options);
  }

  function select(rowIndex: number, columnIndex: number, extend = false, add = false): boolean {
    assertAlive();
    if (
      !Number.isSafeInteger(rowIndex) ||
      rowIndex < 0 ||
      rowIndex >= rowCount ||
      !Number.isSafeInteger(columnIndex) ||
      columnIndex < 0 ||
      columnIndex >= columns.length
    )
      throw new RangeError('Invalid cell position.');
    if (!getCellPermission(rowIndex, columnIndex).selectable) return false;
    const span = mergeAt(rowIndex, columnIndex);
    if (span) {
      rowIndex = span.startRow;
      columnIndex = span.startColumn;
      if (!getCellPermission(rowIndex, columnIndex).selectable) return false;
    }
    if (add && extend) throw new Error('Adding and extending a selection are separate operations.');
    if (add && selection && retainedRanges.length >= 127)
      throw new RangeError('Selection supports at most 128 ranges.');
    const nextSelection = {
      rowIndex,
      rowId: dataSource.getRowId(rowIndex),
      columnIndex,
      columnKey: columns[columnIndex]!.key,
    };
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
    range = expandMergedRange(range);
    const { startRow, endRow, startColumn, endColumn } = range;
    for (const [value, limit] of [
      [startRow, rowCount],
      [endRow, rowCount],
      [startColumn, columns.length],
      [endColumn, columns.length],
    ]) {
      if (!Number.isSafeInteger(value) || value! < 0 || value! >= limit!)
        throw new RangeError('Invalid selection range.');
    }
    if (startRow > endRow || startColumn > endColumn) throw new RangeError('Invalid selection range order.');
    if (!getCellPermission(startRow, startColumn).selectable || !getCellPermission(endRow, endColumn).selectable)
      return false;
    if (mode !== 'replace' && mode !== 'add' && mode !== 'extend') throw new TypeError('Invalid selection mode.');
    if (mode === 'add' && selection && retainedRanges.length >= 127)
      throw new RangeError('Selection supports at most 128 ranges.');
    const previous = JSON.stringify(getSelectionRanges());
    const previousRange = getSelectionRange();
    if (mode === 'add' && previousRange) retainedRanges.push(previousRange);
    else if (mode === 'replace') retainedRanges.length = 0;
    const changed = selection?.rowIndex !== startRow || selection?.columnIndex !== startColumn;
    selection = {
      rowIndex: startRow,
      rowId: dataSource.getRowId(startRow),
      columnIndex: startColumn,
      columnKey: columns[startColumn]!.key,
    };
    anchor = {
      rowIndex: endRow,
      rowId: dataSource.getRowId(endRow),
      columnIndex: endColumn,
      columnKey: columns[endColumn]!.key,
    };
    const rangeChanged = previous !== JSON.stringify(getSelectionRanges());
    if (changed || rangeChanged) notifySelection(changed, rangeChanged);
    return changed || rangeChanged;
  }

  function notifySelection(changed: boolean, rangeChanged: boolean): void {
    cachedRanges = null;
    const endpoint = displaySelection();
    const range = displaySelectionRanges().at(-1) ?? null;
    notify(
      { type: 'selection', changed, rangeChanged },
      Object.freeze({
        type: 'selection:change',
        selection: endpoint ? Object.freeze(endpoint) : null,
        range: range ? Object.freeze(range) : null,
        ranges: Object.freeze(displaySelectionRanges().map((range) => Object.freeze(range))),
      }),
    );
  }

  function clearSelection(): void {
    assertAlive();
    if (!selection) return;
    selection = anchor = null;
    activeParts = 1;
    displayAnchor = null;
    cachedRanges = null;
    retainedRanges.length = 0;
    notifySelection(true, true);
  }

  function canEdit(rowIndex: number, columnIndex: number): boolean {
    const span = mergeAt(rowIndex, columnIndex);
    if (span) {
      rowIndex = span.startRow;
      columnIndex = span.startColumn;
      for (let row = span.startRow; row <= span.endRow; row++)
        for (let col = span.startColumn; col <= span.endColumn; col++)
          if (!getCellPermission(row, col).writable) return false;
    }
    const column = columns[columnIndex];
    if (
      destroyed ||
      !Number.isSafeInteger(rowIndex) ||
      !Number.isSafeInteger(columnIndex) ||
      !(dataSource.setValue || dataSource.setValues) ||
      !column ||
      rowIndex < 0 ||
      rowIndex >= rowCount
    )
      return false;
    if (!getCellPermission(rowIndex, columnIndex).editable) return false;
    const value = dataSource.getValue(rowIndex, column.key);
    return column.parse !== undefined || value == null || typeof value === 'string';
  }

  function canPaste(): boolean {
    const range = getSelectionRange();
    return (
      !destroyed &&
      !!range &&
      !!(dataSource.setValue || dataSource.setValues) &&
      getCellPermission(range.startRow, range.startColumn).pasteable
    );
  }

  function editCell(rowIndex: number, columnIndex: number, text: string): void {
    assertAlive();
    const span = mergeAt(rowIndex, columnIndex);
    if (span) {
      rowIndex = span.startRow;
      columnIndex = span.startColumn;
    }
    if (!canEdit(rowIndex, columnIndex)) throw new Error('Cell cannot be edited.');
    const column = columns[columnIndex]!;
    const previous = dataSource.getValue(rowIndex, column.key);
    if (text !== (previous == null ? '' : String(previous))) {
      applyUpdates([{ rowIndex, columnKey: column.key, value: column.parse ? column.parse(text) : text }], 'edit');
    }
  }

  function resize(axis: GridAxis, index: number, size: number, history = true): void {
    assertAlive();
    if (!history && manualRows.has(index)) return;
    const previous = axis.storedSize(index),
      previousManual = axis === rowAxis && manualRows.has(index);
    axis.setSize(index, size);
    if (previous !== size && history) {
      if (axis === rowAxis) manualRows.add(index);
      past.push({ kind: 'resize', axis: axis === rowAxis ? 'row' : 'column', index, previous, size, previousManual });
      if (past.length > 100) past.shift();
      future.length = 0;
    }
    if (previous !== size)
      notify(
        { type: 'layout' },
        Object.freeze({ type: axis === rowAxis ? 'row:resize' : 'column:resize', index, previous, size }),
      );
  }

  function requireVisibilityPolicy(axis: 'row' | 'column', indices: readonly number[], hidden: boolean): void {
    if (
      tableLocked ||
      options.canChangeVisibility?.(Object.freeze({ axis, indices: Object.freeze([...indices]), hidden })) === false
    )
      throw new Error('Changing visibility is disabled.');
  }
  function changeVisibility(
    axis: 'row' | 'column',
    indices: readonly number[],
    hidden: boolean,
    history = true,
    source: 'api' | 'undo' | 'redo' = 'api',
  ): void {
    assertAlive();
    const layout = axis === 'row' ? rowAxis : columnAxis;
    if (
      typeof hidden !== 'boolean' ||
      !Array.isArray(indices) ||
      new Set(indices).size !== indices.length ||
      indices.some((index) => !Number.isSafeInteger(index) || index < 0 || index >= layout.count)
    )
      throw new RangeError('Invalid visibility request.');
    requireVisibilityPolicy(axis, indices, hidden);
    const before = new Set(layout.hiddenIndices()),
      changed = indices.filter((index) => before.has(index) !== hidden);
    if (!changed.length) return;
    for (const index of changed) {
      if (hidden) before.add(index);
      else before.delete(index);
    }
    layout.replaceHidden([...before]);
    rebuildViewAxis();
    clearSelection();
    pendingCut = undefined;
    if (history) {
      past.push({ kind: 'visibility', axis, indices: Object.freeze(changed), hidden });
      if (past.length > 100) past.shift();
      future.length = 0;
    }
    notify(
      { type: 'layout' },
      Object.freeze({ type: 'visibility:change', axis, indices: Object.freeze(changed), hidden, source }),
    );
  }

  function setFrozen(rows: number, columnCount: number): void {
    assertAlive();
    if (
      !Number.isSafeInteger(rows) ||
      rows < 0 ||
      rows > rowCount ||
      !Number.isSafeInteger(columnCount) ||
      columnCount < 0 ||
      columnCount > columns.length
    )
      throw new RangeError('Invalid frozen row or column count.');
    if (rows === frozenRows && columnCount === frozenColumns) return;
    validateMergeFreeze(merges, rows, columnCount);
    if (groups.some((group) => group.collapsed && group.startRow < rows && group.endRow >= rows))
      throw new Error('A collapsed group cannot cross a frozen boundary.');
    const previousRows = frozenRows;
    const previousColumns = frozenColumns;
    frozenRows = rows;
    frozenColumns = columnCount;
    past.push({ kind: 'freeze', previousRows, previousColumns, rows, columns: columnCount });
    if (past.length > 100) past.shift();
    future.length = 0;
    notify(
      { type: 'layout' },
      Object.freeze({ type: 'freeze:change', previousRows, previousColumns, rows, columns: columnCount }),
    );
  }

  function axisView(axis: GridAxis) {
    return Object.freeze({
      size: (index: number) => axis.size(index),
      position: (index: number) => axis.position(index),
      indexAt: (offset: number) => axis.indexAt(offset),
      range: (offset: number, extent: number) => axis.range(offset, extent),
    });
  }

  function refreshData(previousRowIds?: readonly RowId[] | 'values'): void {
    assertAlive();
    const count = dataSource.getRowCount();
    if (!Number.isSafeInteger(count) || count < 0 || !Number.isFinite(count * rowHeight))
      throw new RangeError('Invalid refreshed row count.');
    if (previousRowIds === 'values') {
      if (count !== rowCount || (selection && !Object.is(selection.rowId, dataSource.getRowId(selection.rowIndex))))
        throw new Error('Values-only refresh requires unchanged row identities and count.');
      const old = projection ?? Array.from({ length: rowCount }, (_, i) => i),
        next = buildProjection(view);
      installProjection(next);
      past.length = future.length = 0;
      pendingCut = undefined;
      notify(
        { type: 'structure', rowMap: old.map(displayRow), columnMap: columns.map((_, i) => i) },
        Object.freeze({ type: 'data:refresh', previousRowCount: rowCount, rowCount, identitiesReconciled: true }),
      );
      return;
    }
    const ids = Array.from({ length: count }, (_, i) => dataSource.getRowId(i));
    const validIds = (values: readonly RowId[]) =>
      values.every((id) => typeof id === 'string' || (typeof id === 'number' && Number.isFinite(id))) &&
      new Set(values).size === values.length;
    if (!validIds(ids) || (previousRowIds && (previousRowIds.length !== rowCount || !validIds(previousRowIds))))
      throw new TypeError('Invalid refresh row identities.');
    const lookup = new Map(ids.map((id, i) => [id, i])),
      oldIds = previousRowIds ?? Array.from({ length: rowCount }, (_, i) => i);
    const rowMap = oldIds.map((id) => (previousRowIds ? (lookup.get(id) ?? -1) : -1)),
      columnsMap = columns.map((_, i) => i);
    const previousLookup = new Map(previousRowIds?.map((id, i) => [id, i]) ?? []),
      order = ids.map((id) => previousLookup.get(id) ?? -1);
    const before = snapshotStructure(oldIds),
      contiguous = (start: number, end: number) =>
        rowMap.slice(start, end + 1).every((row, i, rows) => row >= 0 && row === rows[0]! + i);
    before.merges = before.merges.filter(
      (span) =>
        contiguous(span.startRow, span.endRow) &&
        !(rowMap[span.startRow]! < Math.min(frozenRows, count) && rowMap[span.endRow]! >= Math.min(frozenRows, count)),
    );
    before.groups = before.groups.filter(
      (group) =>
        contiguous(group.startRow, group.endRow) &&
        !(
          group.collapsed &&
          rowMap[group.startRow]! < Math.min(frozenRows, count) &&
          rowMap[group.endRow]! >= Math.min(frozenRows, count)
        ),
    );
    const oldDisplay = projection ?? Array.from({ length: rowCount }, (_, i) => i),
      next = mappedState(before, order, 'row', rowMap, columnsMap, [], ids);
    next.rowIds = ids;
    for (const cell of [next.selection, next.anchor]) if (cell) cell.rowId = ids[cell.rowIndex]!;
    const oldCount = rowCount;
    const nextProjection = buildProjection(view, count, next.merges, next.groups);
    restoreStructure(next);
    installProjection(nextProjection);
    past.length = future.length = 0;
    pendingCut = undefined;
    notify(
      {
        type: 'structure',
        rowMap: oldDisplay.map((row) => (rowMap[row]! < 0 ? -1 : displayRow(rowMap[row]!))),
        columnMap: columnsMap,
      },
      Object.freeze({
        type: 'data:refresh',
        previousRowCount: oldCount,
        rowCount: count,
        identitiesReconciled: previousRowIds !== undefined,
      }),
    );
  }

  function exportConfiguration(): GridConfiguration {
    assertAlive();
    return {
      version: 1,
      columns: columns.map((column, index) => ({ key: column.key, width: columnAxis.storedSize(index) })),
      frozenRows,
      frozenColumns,
      view: {
        ...view,
        ...(view.sort ? { sort: { ...view.sort } } : {}),
        ...(view.sorts ? { sorts: view.sorts.map((sort) => ({ ...sort })) } : {}),
        ...(view.filters ? { filters: view.filters.map((filter) => ({ ...filter })) } : {}),
      },
    };
  }
  function exportState(): GridState {
    assertAlive();
    const layers = [...formats.values()]
      .flatMap((entry) =>
        Object.entries(entry.orders).map(([property, order]) => ({
          order: order!,
          target: entry.target,
          patch: { [property]: entry.patch[property as keyof CellFormatPatch] },
        })),
      )
      .sort((a, b) => a.order - b.order);
    return {
      version: 1,
      configuration: exportConfiguration(),
      rowIds: Array.from({ length: rowCount }, (_, i) => dataSource.getRowId(i)),
      rowHeights: rowAxis.snapshot(),
      manualRows: [...manualRows],
      hiddenRows: rowAxis.hiddenIndices(),
      hiddenColumns: columnAxis.hiddenIndices(),
      activeParts,
      displayAnchor: displayAnchor ? { ...displayAnchor } : null,
      ranges: getSelectionRanges().map((range) => ({ ...range })),
      selection: selection ? { ...selection } : null,
      anchor: anchor ? { ...anchor } : null,
      merges: merges.map((span) => ({ ...span })),
      groups: groups.map((group) => ({ ...group })),
      locks: [
        ...(tableLocked ? [{ scope: 'table' as const }] : []),
        ...[...lockedRows].map((rowIndex) => ({ scope: 'row' as const, rowIndex })),
        ...[...lockedColumns].map((columnIndex) => ({ scope: 'column' as const, columnIndex })),
        ...[...lockedCells].map((key) => {
          const [rowIndex, columnIndex] = key.split(':').map(Number);
          return { scope: 'cell' as const, rowIndex: rowIndex!, columnIndex: columnIndex! };
        }),
      ],
      formats: layers.map(({ target, patch }) => ({
        target: JSON.parse(JSON.stringify(target)) as CellFormatTarget,
        patch,
      })),
    };
  }
  function restoreState(input: unknown): void {
    assertAlive();
    const saved = readGridState(input);
    if (tableLocked) throw new Error('Unlock the table before restoring state.');
    if (saved.rowIds.length !== rowCount || saved.rowIds.some((id, i) => !Object.is(id, dataSource.getRowId(i))))
      throw new Error('State row identities do not match the current source.');
    const configuration = restoreGridConfiguration(saved.configuration, columns, rowCount);
    const restoredOrder = configuration.columns.map((column) => columnIndices.get(column.key)!);
    if (restoredOrder.some((index, i) => index !== i)) {
      const request = Object.freeze({
        ...structureRequest(
          'column',
          'move',
          restoredOrder.map((_, i) => i),
          0,
          restoredOrder.length,
        ),
        order: Object.freeze(restoredOrder),
        columns: Object.freeze(configuration.columns),
      });
      if (!structureAllowed(request)) throw new Error('Structural change is disabled.');
    }
    const staged = createGridEngine({
      ...options,
      ...configuration,
      view: {},
      onEvent: () => {},
      onInvalidate: () => {},
      onObserverError: () => {},
    });
    try {
      for (const size of saved.rowHeights) {
        if (!Array.isArray(size) || size.length !== 2) throw new TypeError('Invalid row height.');
        staged.setRowHeight(size[0], size[1]);
      }
      const manual = new Set(saved.manualRows);
      if (
        manual.size !== saved.manualRows.length ||
        saved.manualRows.some((row) => !Number.isSafeInteger(row) || row < 0 || row >= rowCount)
      )
        throw new RangeError('Invalid manual rows.');
      for (const entry of saved.formats) {
        if (!entry || !entry.target || !entry.patch) throw new TypeError('Invalid state format.');
        staged.format([entry.target], entry.patch);
      }
      for (const span of saved.merges) staged.mergeCells(span);
      const ids = new Set<string>();
      for (const group of saved.groups) {
        if (
          !group ||
          typeof group.id !== 'string' ||
          !group.id ||
          ids.has(group.id) ||
          typeof group.collapsed !== 'boolean'
        )
          throw new TypeError('Invalid state group.');
        ids.add(group.id);
        const stagedGroup = staged.groupRows(group.startRow, group.endRow);
        if (group.collapsed) {
          staged.setGroupCollapsed(stagedGroup, true);
          staged.setGroupCollapsed(stagedGroup, false);
        }
      }
      const hiddenRows = saved.hiddenRows ?? [],
        hiddenColumns = saved.hiddenColumns ?? [];
      if (!Array.isArray(hiddenRows) || !Array.isArray(hiddenColumns)) throw new TypeError('Invalid saved visibility.');
      if (hiddenRows.length) staged.setRowsHidden(hiddenRows, true);
      if (hiddenColumns.length) staged.setColumnsHidden(hiddenColumns, true);
      // Restore selection in source coordinates before installing a sorted/filtered projection.
      for (const range of saved.ranges)
        if (!staged.selectRange(range, 'add')) throw new Error('State selection is not selectable.');
      for (const cell of [saved.selection, saved.anchor])
        if (cell !== null) {
          if (
            !cell ||
            !Number.isSafeInteger(cell.rowIndex) ||
            !Number.isSafeInteger(cell.columnIndex) ||
            cell.rowIndex < 0 ||
            cell.rowIndex >= rowCount ||
            cell.columnIndex < 0 ||
            cell.columnIndex >= columns.length ||
            cell.columnKey !== configuration.columns[cell.columnIndex]!.key ||
            !Object.is(cell.rowId, saved.rowIds[cell.rowIndex]) ||
            !staged.getCellPermission(cell.rowIndex, cell.columnIndex).selectable ||
            !saved.ranges.some(
              (range) =>
                cell.rowIndex >= range.startRow &&
                cell.rowIndex <= range.endRow &&
                cell.columnIndex >= range.startColumn &&
                cell.columnIndex <= range.endColumn,
            )
          )
            throw new TypeError('Invalid state selection endpoint.');
        }
      if ((saved.selection === null) !== (saved.anchor === null) || (!saved.selection && saved.ranges.length))
        throw new TypeError('Invalid state selection.');
      for (const target of saved.locks) staged.setLocked(target, true);
      staged.setView(configuration.view);
      const valid = staged.exportState();
      const nextProjection = buildProjection(
        configuration.view,
        rowCount,
        valid.merges,
        saved.groups,
        configuration.frozenRows,
      );
      const restoredParts = saved.activeParts ?? 1,
        restoredAnchor = saved.displayAnchor ?? null;
      if (!Number.isSafeInteger(restoredParts) || restoredParts < 1 || restoredParts > Math.max(1, valid.ranges.length))
        throw new TypeError('Invalid active selection parts.');
      if (
        restoredAnchor &&
        (!Number.isSafeInteger(restoredAnchor.row) ||
          !Number.isSafeInteger(restoredAnchor.col) ||
          restoredAnchor.row < 0 ||
          restoredAnchor.row >= (nextProjection?.length ?? rowCount) ||
          restoredAnchor.col < 0 ||
          restoredAnchor.col >= columns.length)
      )
        throw new TypeError('Invalid display anchor.');
      for (const span of merges)
        if (
          !saved.merges.some((next) => JSON.stringify(next) === JSON.stringify(span)) &&
          !layoutAllowed({ kind: 'unmerge', range: span })
        )
          throw new Error('Removing merged cells is disabled.');
      for (const group of groups) {
        const next = saved.groups.find(
          (item) => item.id === group.id && item.startRow === group.startRow && item.endRow === group.endRow,
        );
        if (
          (!next && !layoutAllowed({ kind: 'ungroup', group })) ||
          (next &&
            next.collapsed !== group.collapsed &&
            !layoutAllowed({ kind: next.collapsed ? 'collapse' : 'expand', group }))
        )
          throw new Error('Changing row groups is disabled.');
      }
      for (const span of valid.merges)
        for (let row = span.startRow; row <= span.endRow; row++)
          for (let col = span.startColumn; col <= span.endColumn; col++)
            requirePermission(row, restoredOrder[col]!, 'writable');
      for (const group of valid.groups)
        for (let row = group.startRow; row <= group.endRow; row++)
          if (lockedRows.has(row)) throw new Error('Changing locked row groups is disabled.');
      if (JSON.stringify(exportState().formats) !== JSON.stringify(valid.formats))
        for (const entry of formats.values()) requireFormatPermission(entry.bounds);
      const shownRows = rowAxis.hiddenIndices().filter((index) => !hiddenRows.includes(index));
      const hiddenKeys = new Set(hiddenColumns.map((index) => configuration.columns[index]!.key));
      const shownColumns = columnAxis.hiddenIndices().filter((index) => !hiddenKeys.has(columns[index]!.key));
      if (shownRows.length) requireVisibilityPolicy('row', shownRows, false);
      if (shownColumns.length) requireVisibilityPolicy('column', shownColumns, false);
      const nextFormats = new Map<string, FormatEntry>();
      let order = 0;
      for (const entry of valid.formats) {
        const target = entry.target,
          bounds: SelectionRange =
            target.scope === 'range'
              ? { ...target.range }
              : {
                  startRow: target.scope === 'row' || target.scope === 'cell' ? target.rowIndex : 0,
                  endRow: target.scope === 'row' || target.scope === 'cell' ? target.rowIndex : rowCount - 1,
                  startColumn: target.scope === 'column' || target.scope === 'cell' ? target.columnIndex : 0,
                  endColumn:
                    target.scope === 'column' || target.scope === 'cell' ? target.columnIndex : columns.length - 1,
                };
        const key = JSON.stringify([
            target.scope,
            bounds.startRow,
            bounds.endRow,
            bounds.startColumn,
            bounds.endColumn,
          ]),
          previous = nextFormats.get(key),
          orders = { ...previous?.orders };
        for (const property of Object.keys(entry.patch) as (keyof CellFormatPatch)[]) orders[property] = ++order;
        nextFormats.set(key, {
          target: Object.freeze(target),
          bounds: Object.freeze(bounds),
          patch: Object.freeze({ ...previous?.patch, ...entry.patch }),
          orders: Object.freeze(orders),
          order,
        });
      }
      const old = projection ?? Array.from({ length: rowCount }, (_, i) => i),
        oldColumns = columns;
      columns = Object.freeze([...configuration.columns]);
      columnIndices.clear();
      columns.forEach((column, i) => columnIndices.set(column.key, i));
      columnAxis.replace(
        columns.length,
        configuration.columns.map((column, i) => [i, configuration.columnWidths[column.key]!] as const),
      );
      rowAxis.replace(rowCount, valid.rowHeights);
      rowAxis.replaceHidden(valid.hiddenRows ?? []);
      columnAxis.replaceHidden(valid.hiddenColumns ?? []);
      manualRows.clear();
      for (const row of manual) manualRows.add(row);
      merges = valid.merges.map((span) => Object.freeze({ ...span }));
      groups = valid.groups.map((group, i) =>
        Object.freeze({ ...group, id: saved.groups[i]!.id, collapsed: saved.groups[i]!.collapsed }),
      );
      groupId = 0;
      lockedRows.clear();
      lockedColumns.clear();
      lockedCells.clear();
      tableLocked = false;
      for (const target of valid.locks) {
        if (target.scope === 'table') tableLocked = true;
        else if (target.scope === 'row') lockedRows.add(target.rowIndex);
        else if (target.scope === 'column') lockedColumns.add(target.columnIndex);
        else lockedCells.add(`${target.rowIndex}:${target.columnIndex}`);
      }
      formats.clear();
      for (const [key, entry] of nextFormats) formats.set(key, entry);
      orderedFormats = [...formats.values()].sort((a, b) => a.order - b.order);
      formatOrder = order;
      frozenRows = configuration.frozenRows;
      frozenColumns = configuration.frozenColumns;
      selection = anchor = null;
      retainedRanges.length = 0;
      activeParts = 1;
      displayAnchor = null;
      for (const range of valid.ranges) retainedRanges.push({ ...range });
      const active = retainedRanges.pop();
      if (active && rowCount && columns.length) {
        selection = {
          rowIndex: active.startRow,
          columnIndex: active.startColumn,
          columnKey: columns[active.startColumn]!.key,
          rowId: dataSource.getRowId(active.startRow),
        };
        anchor = {
          rowIndex: active.endRow,
          columnIndex: active.endColumn,
          columnKey: columns[active.endColumn]!.key,
          rowId: dataSource.getRowId(active.endRow),
        };
      }
      if (saved.selection && saved.anchor) {
        selection = { ...saved.selection };
        anchor = { ...saved.anchor };
      }
      view = snapshotView(configuration.view);
      installProjection(nextProjection);
      past.length = future.length = 0;
      pendingCut = undefined;
      activeParts = restoredParts;
      displayAnchor = restoredAnchor ? { ...restoredAnchor } : null;
      notify(
        {
          type: 'structure',
          rowMap: old.map(displayRow),
          columnMap: oldColumns.map((column) => columnIndices.get(column.key) ?? -1),
        },
        Object.freeze({ type: 'state:restore' }),
      );
    } finally {
      staged.destroy();
    }
  }

  const { replay } = createHistory(context, {
    get changeVisibility() {
      return changeVisibility;
    },
    get layoutAllowed() {
      return layoutAllowed;
    },
    get validateMergeFreeze() {
      return validateMergeFreeze;
    },
    get notifyOutline() {
      return notifyOutline;
    },
    get replayStructure() {
      return replayStructure;
    },
    get notifyStructure() {
      return notifyStructure;
    },
    get notify() {
      return notify;
    },
    get requireFormatPermission() {
      return requireFormatPermission;
    },
    get writeFormats() {
      return writeFormats;
    },
    get notifyFormats() {
      return notifyFormats;
    },
    get requirePermission() {
      return requirePermission;
    },
    get write() {
      return write;
    },
    get notifyCells() {
      return notifyCells;
    },
  });

  const {
    snapshotStructure,
    restoreStructure,
    mappedState,
    structureAllowed,
    structureRequest,
    notifyStructure,
    replayStructure,
    changeStructure,
    insertRows,
    deleteRows,
    insertColumns,
    deleteColumns,
    moveAxis,
  } = createStructure(context, {
    get getSelection() {
      return getSelection;
    },
    get getSelectionRange() {
      return getSelectionRange;
    },
    get validateMergeFreeze() {
      return validateMergeFreeze;
    },
    get getCellPermission() {
      return getCellPermission;
    },
    get notify() {
      return notify;
    },
    get assertAlive() {
      return assertAlive;
    },
  });

  const { getCellPermission, requirePermission, validateLockTarget, isLocked, setLocked } = createPermissions(context, {
    get assertAlive() {
      return assertAlive;
    },
    get query() {
      return query;
    },
    get mergeAt() {
      return mergeAt;
    },
    get notify() {
      return notify;
    },
  });

  const { formatBounds, requireFormatPermission, canFormat, getFormat, writeFormats, notifyFormats, format } =
    createFormatting(context, {
      get validateLockTarget() {
        return validateLockTarget;
      },
      get requirePermission() {
        return requirePermission;
      },
      get assertAlive() {
        return assertAlive;
      },
      get notify() {
        return notify;
      },
    });
  if (options.view) {
    view = snapshotView(options.view);
    installProjection(buildProjection(view));
  }
  return Object.freeze({
    subscribe: (subscriber: {
      readonly onEvent?: (event: GridEvent) => void;
      readonly onInvalidate?: (change: GridInvalidation) => void;
    }) => {
      assertAlive();
      const snapshot = Object.freeze({ ...subscriber });
      subscribers.add(snapshot);
      return () => {
        subscribers.delete(snapshot);
      };
    },
    takeObserverErrors: () => observerErrors.splice(0),
    captureRowIdentity: () =>
      query(() => {
        assertAlive();
        return Object.freeze(Array.from({ length: rowCount }, (_, i) => dataSource.getRowId(i)));
      }),
    refreshData: (previousRowIds?: readonly RowId[] | 'values') => command(() => refreshData(previousRowIds)),
    exportState: (): GridState => query(exportState),
    restoreState: (state: unknown) => command(() => restoreState(state)),
    setView: (next: LocalViewOptions) => command(() => setView(next)),
    get view() {
      return view;
    },
    exportConfiguration: (): GridConfiguration => query(exportConfiguration),
    get sourceRowCount() {
      return rowCount;
    },
    getRowId: (row: number) => dataSource.getRowId(sourceRow(row)),
    get columns() {
      return columns;
    },
    get rowCount() {
      return visibleRowCount();
    },
    get frozenRows() {
      return visibleFrozenRows();
    },
    get frozenColumns() {
      return frozenColumns;
    },
    getViewport: (viewport: ViewportOptions) => {
      assertAlive();
      return mergedViewport(viewport);
    },
    getMergedCells: () => Object.freeze(merges.map((span) => Object.freeze({ ...span }))),
    getMerge: (row: number, col: number) => {
      const span = mergeAt(sourceRow(row), col);
      return span
        ? Object.freeze({ ...span, startRow: displayRow(span.startRow), endRow: displayRow(span.endRow) })
        : null;
    },
    canMerge: (range: SelectionRange) => query(() => canMerge(range)),
    mergeCells: (range: SelectionRange) => command(() => mergeCells(range)),
    unmergeCells: (range: SelectionRange) => command(() => unmergeCells(range)),
    getRowGroups: () => Object.freeze(groups.map((group) => Object.freeze({ ...group }))),
    canChangeLayout: (request: LayoutRequest) => query(() => layoutAllowed(request)),
    getRowSourceIndex: (row: number) => sourceRow(row),
    groupRows: (start: number, end: number) => command(() => groupRows(start, end)),
    ungroupRows: (id: string) => command(() => ungroupRows(id)),
    setGroupCollapsed: (id: string, collapsed: boolean) => command(() => setGroupCollapsed(id, collapsed)),
    rows: Object.freeze({
      size: (i: number) => viewAxis().size(i),
      position: (i: number) => viewAxis().position(i),
      indexAt: (offset: number) => viewAxis().indexAt(offset),
      range: (offset: number, extent: number) => viewAxis().range(offset, extent),
    }),
    columnsLayout: axisView(columnAxis),
    getValue: (row: number, key: string): unknown => dataSource.getValue(sourceRow(row), key),
    insertColumns: (index: number, added: readonly Column[]) => command(() => insertColumns(index, added)),
    deleteColumns: (indices: readonly number[]) => command(() => deleteColumns(indices)),
    insertRows: (index: number, rows: readonly DataRow[]) => command(() => insertRows(index, rows)),
    deleteRows: (indices: readonly number[]) => command(() => deleteRows(indices)),
    moveRows: (indices: readonly number[], beforeIndex: number) => command(() => moveAxis('row', indices, beforeIndex)),
    moveColumns: (indices: readonly number[], beforeIndex: number) =>
      command(() => moveAxis('column', indices, beforeIndex)),
    canChangeStructure: (request: Readonly<StructureRequest>) => query(() => structureAllowed(request)),
    isRowHeightManual: (index: number) => manualRows.has(sourceRow(index)),
    measureRowHeight: (index: number, size: number) => command(() => resize(rowAxis, sourceRow(index), size, false)),
    getSelection: displaySelection,
    getSelectionRange: () => displaySelectionRanges().at(-1) ?? null,
    getSelectionRanges: displaySelectionRanges,
    getCellPermission: (row: number, col: number) => getCellPermission(sourceRow(row), col),
    canEdit: (row: number, col: number) =>
      !destroyed && row >= 0 && row < visibleRowCount() && canEdit(sourceRow(row), col),
    canPaste: () => displaySelectionRanges().length > 0 && canPaste(),
    select: (row: number, col: number, extend = false) => command(() => selectDisplay(row, col, extend)),
    selectRange: (range: SelectionRange, mode: 'replace' | 'add' | 'extend' = 'replace') =>
      command(() => {
        if (!projection && activeParts === 1) return selectRange(range, mode);
        return selectDisplayRange(range, mode);
      }),
    addSelection: (row: number, col: number) => command(() => selectDisplay(row, col, false, true)),
    clearSelection: () => command(clearSelection),
    editCell: (row: number, col: number, text: string) => command(() => editCell(sourceRow(row), col, text)),
    updateCells: (updates: readonly CellUpdate[]) =>
      command(() => applyUpdates(updates.map((update) => ({ ...update, rowIndex: sourceRow(update.rowIndex) })))),
    replaceText: (
      search: string,
      replacement: string,
      options: { readonly scope?: 'view' | 'selection'; readonly caseSensitive?: boolean } = {},
    ) =>
      command(() => {
        if (
          typeof search !== 'string' ||
          !search ||
          search.length > 1000 ||
          typeof replacement !== 'string' ||
          replacement.length > 10000 ||
          (options.scope !== undefined && !['view', 'selection'].includes(options.scope)) ||
          (options.caseSensitive !== undefined && typeof options.caseSensitive !== 'boolean')
        )
          throw new TypeError('Invalid replace options.');
        const ranges =
          options.scope === 'selection'
            ? displaySelectionRanges()
            : visibleRowCount() && columns.length
              ? [{ startRow: 0, endRow: visibleRowCount() - 1, startColumn: 0, endColumn: columns.length - 1 }]
              : [];
        if (options.scope === 'selection' && !ranges.length) throw new Error('Select cells before replacing text.');
        if (
          ranges.reduce(
            (count, range) => count + (range.endRow - range.startRow + 1) * (range.endColumn - range.startColumn + 1),
            0,
          ) > clipboardCellLimit
        )
          throw new RangeError('Replace cell limit reached.');
        const pattern = new RegExp(
          search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
          options.caseSensitive === false ? 'gi' : 'g',
        );
        const seen = new Set<string>(),
          updates: CellUpdate[] = [];
        let matches = 0,
          characters = 0,
          outputCharacters = 0;
        for (const range of ranges)
          for (let row = range.startRow; row <= range.endRow; row++)
            for (let col = range.startColumn; col <= range.endColumn; col++) {
              const canonical = sourceRow(row),
                column = columns[col]!,
                key = JSON.stringify([canonical, column.key]);
              if (seen.has(key)) continue;
              seen.add(key);
              const previous = dataSource.getValue(canonical, column.key);
              if (typeof previous !== 'string') continue;
              characters += previous.length;
              if (characters > clipboardTextLimit) throw new RangeError('Replace text limit reached.');
              let occurrences = 0;
              while (pattern.exec(previous)) {
                occurrences++;
                if (previous.length + occurrences * (replacement.length - search.length) > clipboardTextLimit)
                  throw new RangeError('Replace text limit reached.');
              }
              matches += occurrences;
              if (!occurrences) continue;
              outputCharacters += previous.length + occurrences * (replacement.length - search.length);
              if (outputCharacters > clipboardTextLimit) throw new RangeError('Replace text limit reached.');
              const value = previous.replace(pattern, () => replacement);
              if (value === previous) continue;
              if (value.length > clipboardTextLimit) throw new RangeError('Replace text limit reached.');
              requirePermission(canonical, col, 'editable');
              updates.push({ rowIndex: canonical, columnKey: column.key, value });
            }
        applyUpdates(updates);
        return Object.freeze({ changedCells: updates.length, matches });
      }),
    cutSelectionBlocks: () => command(cutSelectionBlocks),
    cancelCut: () =>
      command(() => {
        pendingCut = undefined;
      }),
    pasteCutSelectionBlocks: (text: string) => command(() => pasteBlocks(decodeBlocks(text), true, true)),
    copySelectionBlocks: () => query(() => encodeBlocks(clipboardBlocks())),
    pasteSelectionBlocks: (text: string, options?: PasteOptions) =>
      command(() => pasteBlocks(decodeBlocks(text), true, false, options)),
    copySelection: () => query(copySelection),
    paste: (text: string, options?: PasteOptions) => command(() => paste(text, options)),
    undo: () => command(() => replay(false)),
    redo: () => command(() => replay(true)),
    canUndo: () => !destroyed && past.length > 0,
    canRedo: () => !destroyed && future.length > 0,
    getFormat: (row: number, col: number) => getFormat(sourceRow(row), col),
    canFormat: (targets: readonly CellFormatTarget[]) => query(() => canFormat(sourceFormats(targets))),
    format: (targets: readonly CellFormatTarget[], patch: CellFormatPatch | null) =>
      command(() => format(sourceFormats(targets), patch)),
    isLocked: (target: CellLockTarget) => isLocked(sourceTarget(target)),
    canManageLocks: () => !destroyed && allowLockChanges,
    setLocked: (target: CellLockTarget, locked: boolean) => command(() => setLocked(sourceTarget(target), locked)),
    setFrozen: (rows: number, columns: number) =>
      command(() => {
        if (!Number.isSafeInteger(rows) || rows < 0 || rows > visibleRowCount())
          throw new RangeError('Invalid frozen row count.');
        setFrozen(
          projection && groups.some((group) => group.collapsed) && rows > 0 ? sourceRow(rows - 1) + 1 : rows,
          columns,
        );
      }),
    setRowsHidden: (indices: readonly number[], hidden: boolean) =>
      command(() => changeVisibility('row', indices.map(sourceRow), hidden)),
    setColumnsHidden: (indices: readonly number[], hidden: boolean) =>
      command(() => changeVisibility('column', indices, hidden)),
    getHiddenRows: () =>
      Object.freeze(
        rowAxis
          .hiddenIndices()
          .map(displayRow)
          .filter((index) => index >= 0)
          .sort((a, b) => a - b),
      ),
    getHiddenColumns: () => Object.freeze(columnAxis.hiddenIndices()),
    isRowHidden: (index: number) => rowAxis.isHidden(sourceRow(index)),
    isColumnHidden: (index: number) => columnAxis.isHidden(index),
    setColumnWidth: (index: number, size: number) => command(() => resize(columnAxis, index, size)),
    setRowHeight: (index: number, size: number) => command(() => resize(rowAxis, sourceRow(index), size)),
    destroy: () =>
      command(() => {
        if (destroyed) return;
        destroyed = true;
        onInvalidate = undefined;
        onEvent = undefined;
        resolver = undefined;
        subscribers.clear();
        observerErrors.length = 0;
        past.length = future.length = 0;
        selection = anchor = null;
        pendingCut = undefined;
        retainedRanges.length = 0;
        formats.clear();
        orderedFormats.length = 0;
        merges = [];
        groups = [];
        projection = null;
        projectedAxis = null;
        cachedRanges = null;
        reverseProjection.clear();
        displayAnchor = null;
        manualRows.clear();
        lockedRows.clear();
        lockedColumns.clear();
        lockedCells.clear();
        tableLocked = false;
      }),
  });
}

export type GridEngine = ReturnType<typeof createGridEngine>;
