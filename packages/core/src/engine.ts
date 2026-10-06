import { createClipboard } from './internal/clipboard.js';
import { createSelection } from './internal/selection.js';
import { createProjection } from './internal/projection.js';
import { createOutline } from './internal/outline.js';
import { createLayout } from './internal/layout.js';
import { createValues } from './internal/values.js';
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

  const { notifyCells, write, applyUpdates, canEdit, editCell, replaceText } = createValues(context, {
    get notify() {
      return notify;
    },
    get assertAlive() {
      return assertAlive;
    },
    get requirePermission() {
      return requirePermission;
    },
    get writeFormats() {
      return writeFormats;
    },
    get notifyFormats() {
      return notifyFormats;
    },
    get mergeAt() {
      return mergeAt;
    },
    get getCellPermission() {
      return getCellPermission;
    },
    get displaySelectionRanges() {
      return displaySelectionRanges;
    },
    get visibleRowCount() {
      return visibleRowCount;
    },
    get sourceRow() {
      return sourceRow;
    },
  });

  const { mergedViewport, resize, requireVisibilityPolicy, changeVisibility, setFrozen, axisView } = createLayout(
    context,
    {
      get viewAxis() {
        return viewAxis;
      },
      get visibleFrozenRows() {
        return visibleFrozenRows;
      },
      get mergeAt() {
        return mergeAt;
      },
      get sourceRow() {
        return sourceRow;
      },
      get displayRow() {
        return displayRow;
      },
      get assertAlive() {
        return assertAlive;
      },
      get notify() {
        return notify;
      },
      get rebuildViewAxis() {
        return rebuildViewAxis;
      },
      get clearSelection() {
        return clearSelection;
      },
      get validateMergeFreeze() {
        return validateMergeFreeze;
      },
    },
  );

  const {
    intersects,
    mergeAt,
    expandMergedRange,
    validateMergeFreeze,
    layoutAllowed,
    notifyOutline,
    changeOutline,
    mergeRange,
    canMerge,
    mergeCells,
    unmergeCells,
    groupRows,
    findGroup,
    ungroupRows,
    setGroupCollapsed,
  } = createOutline(context, {
    get assertAlive() {
      return assertAlive;
    },
    get getCellPermission() {
      return getCellPermission;
    },
    get installProjection() {
      return installProjection;
    },
    get buildProjection() {
      return buildProjection;
    },
    get notify() {
      return notify;
    },
    get displayRow() {
      return displayRow;
    },
    get sourceRanges() {
      return sourceRanges;
    },
    get sourceRow() {
      return sourceRow;
    },
  });

  const {
    viewAxis,
    visibleFrozenRows,
    rebuildViewAxis,
    buildProjection,
    installProjection,
    displayRow,
    displaySelection,
    setView,
    sourceTarget,
    sourceRanges,
    sourceFormats,
    sourceRow,
    visibleRowCount,
  } = createProjection(context, {
    get displaySelectionRanges() {
      return displaySelectionRanges;
    },
    get assertAlive() {
      return assertAlive;
    },
    get notify() {
      return notify;
    },
  });

  const {
    selectDisplayRange,
    selectDisplay,
    getSelection,
    getSelectionRange,
    getSelectionRanges,
    displaySelectionRanges,
    select,
    selectRange,
    notifySelection,
    clearSelection,
  } = createSelection(context, {
    get assertAlive() {
      return assertAlive;
    },
    get expandMergedRange() {
      return expandMergedRange;
    },
    get displayRow() {
      return displayRow;
    },
    get sourceRanges() {
      return sourceRanges;
    },
    get getCellPermission() {
      return getCellPermission;
    },
    get sourceRow() {
      return sourceRow;
    },
    get mergeAt() {
      return mergeAt;
    },
    get displaySelection() {
      return displaySelection;
    },
    get notify() {
      return notify;
    },
  });

  const { clipboardBlocks, copySelection, cutSelectionBlocks, pasteBlocks, paste, canPaste } = createClipboard(
    context,
    {
      get assertAlive() {
        return assertAlive;
      },
      get displaySelectionRanges() {
        return displaySelectionRanges;
      },
      get sourceRow() {
        return sourceRow;
      },
      get requirePermission() {
        return requirePermission;
      },
      get mergeAt() {
        return mergeAt;
      },
      get getFormat() {
        return getFormat;
      },
      get visibleRowCount() {
        return visibleRowCount;
      },
      get requireFormatPermission() {
        return requireFormatPermission;
      },
      get applyUpdates() {
        return applyUpdates;
      },
      get selectRange() {
        return selectRange;
      },
      get selectDisplayRange() {
        return selectDisplayRange;
      },
      get getSelectionRange() {
        return getSelectionRange;
      },
      get getCellPermission() {
        return getCellPermission;
      },
    },
  );
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
    ) => command(() => replaceText(search, replacement, options)),
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
