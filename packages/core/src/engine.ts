import type {
  DisplayRow,
  GroupKey,
  LocalGroupingOptions,
  GroupingState,
  GridRowMetadata,
} from './internal/grouping.js';
import type { LocalTreeOptions, LocalTreeRow, TreeState } from './internal/tree.js';
import { createPersistence } from './internal/persistence.js';
import { createClipboard } from './internal/clipboard.js';
import { createSelection } from './internal/selection.js';
import { createProjection } from './internal/projection.js';
import { createOutline } from './internal/outline.js';
import { createLayout } from './internal/layout.js';
import { createValues } from './internal/values.js';
import { createFormatting } from './internal/formatting.js';
import { createPermissions } from './internal/permissions.js';
import { createStructure } from './internal/structure.js';
import type { GridConfiguration } from './configuration.js';
import type { GridState } from './state.js';
import { snapshotLocalView as snapshotView } from './data-source.js';
import type { LocalViewOptions } from './data-source.js';
import { encodeBlocks, decodeBlocks } from './clipboard.js';
import { clipboardTextLimit } from './tsv.js';
import type { PasteOptions } from './types.js';
import type { StructureRequest } from './structure.js';
import type { CellUpdate, DataSource, RowId, DataRow } from './data-source.js';
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
import type { CellPermission, CellPermissionPolicy, CellPermissionResolver } from './permissions.js';
import type { GridEvent, RowRefreshResult } from './events.js';
import { GridAxis } from './axis.js';
import type { ViewportOptions } from './panes.js';
import type { EngineContext, FormatEntry, HistoryCommand } from './internal/engine-context.js';
import { createHistory } from './internal/history.js';
import { drain, runSteps } from './internal/bulk.js';
import type { BulkSteps, GridBulkOptions } from './internal/bulk.js';
import type { GridHistoryLimits } from './internal/history-budget.js';

export type GridInvalidation =
  | { readonly type: 'rows'; readonly startRow: number; readonly endRow: number }
  | { readonly type: 'cells'; readonly cells: readonly { readonly rowIndex: number; readonly columnKey: string }[] }
  | { readonly type: 'selection'; readonly changed: boolean; readonly rangeChanged: boolean }
  | { readonly type: 'layout' }
  | { readonly type: 'structure'; readonly rowMap: readonly number[]; readonly columnMap: readonly number[] };

export interface GridEngineOptions {
  tree?: LocalTreeOptions;
  grouping?: LocalGroupingOptions;
  historyLimits?: GridHistoryLimits;
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
  let bulkActive = false;
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
  const historyLimits = options.historyLimits ? Object.freeze({ ...options.historyLimits }) : undefined;
  if (historyLimits && Object.values(historyLimits).some((value) => !Number.isSafeInteger(value) || value < 1))
    throw new RangeError('Invalid history limits.');
  const future: HistoryCommand[] = [];
  let pendingCut:
    | { cells: readonly (CellUpdate & { rowId: RowId })[]; columnKeys: readonly string[]; blockCount: number }
    | undefined;
  const formats = new Map<string, FormatEntry>();
  let orderedFormats: FormatEntry[] = [];
  let formatOrder = 0;
  let view: Readonly<LocalViewOptions> = Object.freeze({});
  let projection: DisplayRow[] | null = null;
  let reverseProjection = new Map<number, number>();
  let projectedAxis: GridAxis | null = null;
  let cachedRanges: SelectionRange[] | null = null;
  let cachedFrozenRows: number | null = null;
  let activeParts = 1;
  let displayAnchor: { row: number; col: number } | null = null;

  const emptyFormat: Readonly<CellFormat> = Object.freeze({});
  const context: EngineContext = {
    ...(historyLimits ? { historyLimits } : {}),
    options,
    dataSource,
    grouping: null,
    tree: null,
    collapsedTreeIds: new Set(),
    collapsedGroupingKeys: new Set(),
    groupFocus: null,
    get columns() {
      return columns;
    },
    set columns(value) {
      columns = value;
    },
    rowHeight,
    columnWidth,
    columnIndices,
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
    rowAxis,
    columnAxis,
    permissions,
    get resolver() {
      return resolver;
    },
    set resolver(value) {
      resolver = value;
    },
    allowLockChanges,
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
    addedColumnKeys,
    manualRows,
    lockedRows,
    lockedColumns,
    lockedCells,
    get destroyed() {
      return destroyed;
    },
    set destroyed(value) {
      destroyed = value;
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
    retainedRanges,
    past,
    future,
    get pendingCut() {
      return pendingCut;
    },
    set pendingCut(value) {
      pendingCut = value;
    },
    formats,
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
    emptyFormat,
  };

  function assertAlive(): void {
    if (destroyed) throw new Error('Grid is destroyed.');
  }

  function command<T>(run: () => T, disposing = false): T {
    if (busy || (bulkActive && !disposing)) throw new Error('Nested grid mutations are not allowed.');
    busy = true;
    try {
      return run();
    } finally {
      busy = false;
    }
  }
  async function bulkCommand<T>(
    create: (guarded: boolean) => BulkSteps<T>,
    options: GridBulkOptions,
    prepare?: (captured: GridBulkOptions) => Promise<void>,
  ): Promise<T> {
    assertAlive();
    if (busy || bulkActive) throw new Error('Nested grid mutations are not allowed.');
    bulkActive = true;
    try {
      const captured = { ...options };
      const steps = create(typeof captured.getRevision === 'function');
      const guarded: BulkSteps<T> = {
        next: () => {
          busy = true;
          try {
            return steps.next();
          } finally {
            busy = false;
          }
        },
        return: (value) => steps.return(value),
        throw: (error) => steps.throw(error),
        [Symbol.iterator]() {
          return this;
        },
      };
      return await runSteps(guarded, captured, assertAlive, prepare && (() => prepare(captured)));
    } finally {
      bulkActive = false;
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

  let preparedGrouping: DisplayRow[] | undefined;
  function prepareValues(updates: readonly CellUpdate[]): (() => void) | undefined {
    if (!context.grouping && !context.tree) return undefined;
    const changed = new Map<number, Map<string, unknown>>();
    for (const update of updates) {
      const row = changed.get(update.rowIndex) ?? new Map<string, unknown>();
      row.set(update.columnKey, update.value);
      changed.set(update.rowIndex, row);
    }
    const overlay: DataSource = {
      getRowCount: () => rowCount,
      getRowId: (i) => dataSource.getRowId(i),
      getValue: (i, key) => (changed.get(i)?.has(key) ? changed.get(i)!.get(key) : dataSource.getValue(i, key)),
    };
    const next = drain(buildProjectionSteps(view, rowCount, merges, groups, frozenRows, false, overlay));
    return () => {
      preparedGrouping = next ?? undefined;
    };
  }
  function notify(change: GridInvalidation, event: GridEvent): void {
    cachedRanges = null;
    cachedFrozenRows = null;
    if ((projection || context.grouping) && change.type === 'cells') {
      const old = projection ?? [];
      installProjection(preparedGrouping ?? buildProjection(view));
      preparedGrouping = undefined;
      if (context.tree || old.length !== projection!.length || old.some((row, i) => row !== projection![i])) {
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

  const { replay, replaySteps } = createHistory(context, {
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
    notify,
    prepareValues,
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
    notify,
    assertAlive,
  });

  const { getCellPermission, requirePermission, validateLockTarget, isLocked, setLocked } = createPermissions(context, {
    assertAlive,
    query,
    get mergeAt() {
      return mergeAt;
    },
    notify,
  });

  const { requireFormatPermission, canFormat, getFormat, writeFormats, notifyFormats, format } = createFormatting(
    context,
    {
      validateLockTarget,
      requirePermission,
      assertAlive,
      notify,
    },
  );

  const { notifyCells, write, applyUpdates, applyUpdatesSteps, canEdit, editCell, replaceText } = createValues(
    context,
    {
      notify,
      prepareValues,
      assertAlive,
      isDataRow: (row) => typeof displayEntry(row) === 'number',
      requirePermission,
      writeFormats,
      notifyFormats,
      get mergeAt() {
        return mergeAt;
      },
      getCellPermission,
      get displaySelectionRanges() {
        return displaySelectionRanges;
      },
      get visibleRowCount() {
        return visibleRowCount;
      },
      get sourceRow() {
        return sourceRow;
      },
    },
  );

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
      assertAlive,
      notify,
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
    mergeAt,
    expandMergedRange,
    validateMergeFreeze,
    layoutAllowed,
    notifyOutline,
    canMerge,
    mergeCells,
    unmergeCells,
    groupRows,
    ungroupRows,
    setGroupCollapsed,
  } = createOutline(context, {
    assertAlive,
    getCellPermission,
    get installProjection() {
      return installProjection;
    },
    get buildProjection() {
      return buildProjection;
    },
    notify,
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
    getTreeRowMetadata,
    visibleFrozenRows,
    rebuildViewAxis,
    buildProjection,
    installProjection,
    displayRow,
    displaySelection,
    setView,
    setViewSteps,
    sourceTarget,
    sourceRanges,
    sourceFormats,
    sourceRow,
    visibleRowCount,
    displayEntry,
    buildProjectionSteps,
  } = createProjection(context, {
    get displaySelectionRanges() {
      return displaySelectionRanges;
    },
    assertAlive,
    notify,
  });

  const {
    selectDisplayRange,
    selectDisplay,
    toggleSelection,
    getSelection,
    getSelectionRange,
    getSelectionRanges,
    displaySelectionRanges,
    selectRange,
    clearSelection,
  } = createSelection(context, {
    assertAlive,
    expandMergedRange,
    displayRow,
    sourceRanges,
    getCellPermission,
    sourceRow,
    mergeAt,
    displaySelection,
    notify,
  });

  const { clipboardBlocks, copySelection, cutSelectionBlocks, pasteBlocks, paste, pasteSteps, canPaste } =
    createClipboard(context, {
      assertAlive,
      displaySelectionRanges,
      sourceRow,
      requirePermission,
      mergeAt,
      getFormat,
      visibleRowCount,
      requireFormatPermission,
      applyUpdates,
      applyUpdatesSteps,
      selectRange,
      selectDisplayRange,
      getSelectionRange,
      getCellPermission,
    });

  const { refreshRows, refreshData, exportConfiguration, exportState, restoreState } = createPersistence(context, {
    assertAlive,
    buildProjection,
    installProjection,
    notify,
    displayRow,
    snapshotStructure,
    mappedState,
    restoreStructure,
    getSelectionRanges,
    clearSelection,
    structureRequest,
    structureAllowed,
    createGridEngine,
    layoutAllowed,
    requirePermission,
    requireFormatPermission,
    requireVisibilityPolicy,
  });
  if (options.view) {
    view = snapshotView(options.view);
    installProjection(buildProjection(view));
  }
  function groupingChanged(next: DisplayRow[] | null): void {
    const old = projection ?? Array.from({ length: rowCount }, (_, i) => i);
    installProjection(next);
    context.groupFocus = null;
    clearSelection();
    pendingCut = undefined;
    notify(
      { type: 'structure', rowMap: old.map(displayRow), columnMap: columns.map((_, i) => i) },
      Object.freeze({ type: 'view:change', view, rowCount: visibleRowCount(), sourceRowCount: rowCount }),
    );
  }
  function setGrouping(
    next: LocalGroupingOptions | null,
    collapsedKeys: readonly GroupKey[] = [],
    initial = false,
  ): void {
    assertAlive();
    if (next && context.tree) throw new Error('Clear tree before grouping.');
    if (next !== null && (!next || typeof next !== 'object' || Array.isArray(next)))
      throw new TypeError('Invalid grouping.');
    if (next?.sumColumns !== undefined && !Array.isArray(next.sumColumns))
      throw new TypeError('Invalid grouping sum columns.');
    if (
      next &&
      (frozenRows ||
        merges.length ||
        groups.length ||
        rowAxis.hiddenIndices().length ||
        manualRows.size ||
        past.some((entry) => entry.kind !== 'values') ||
        future.some((entry) => entry.kind !== 'values'))
    )
      throw new Error('Clear row layout and non-value history before grouping.');
    const criteria =
      next === null
        ? null
        : Object.freeze({
            columnKey: next.columnKey,
            ...(next.sumColumns !== undefined ? { sumColumns: Object.freeze(Array.from(next.sumColumns)) } : {}),
          });
    const nextProjection = drain(
      buildProjectionSteps(
        view,
        rowCount,
        merges,
        groups,
        frozenRows,
        false,
        dataSource,
        criteria,
        new Set(collapsedKeys),
      ),
    );
    context.grouping = criteria;
    context.collapsedGroupingKeys = new Set(collapsedKeys);
    if (initial) installProjection(nextProjection);
    else groupingChanged(nextProjection);
  }
  function focusGroup(row: number): boolean {
    const entry = displayEntry(row);
    if (typeof entry === 'number') return false;
    clearSelection();
    context.groupFocus = { key: entry.key };
    notify(
      { type: 'selection', changed: true, rangeChanged: true },
      Object.freeze({ type: 'selection:change', selection: null, range: null, ranges: Object.freeze([]) }),
    );
    return true;
  }
  function setDataGroupExpanded(key: GroupKey, expanded: boolean): void {
    assertAlive();
    if (!context.grouping || typeof expanded !== 'boolean') throw new Error('No active data grouping.');
    if (!projection?.some((row) => typeof row !== 'number' && Object.is(row.key, key)))
      throw new Error('Unknown data group.');
    const collapsed = new Set(context.collapsedGroupingKeys);
    if (expanded) collapsed.delete(key);
    else collapsed.add(key);
    const next = drain(
      buildProjectionSteps(view, rowCount, merges, groups, frozenRows, false, dataSource, context.grouping, collapsed),
    );
    context.collapsedGroupingKeys = collapsed;
    groupingChanged(next);
    const index = projection?.findIndex((row) => typeof row !== 'number' && Object.is(row.key, key)) ?? -1;
    if (index >= 0) focusGroup(index);
  }
  function setTree(next: LocalTreeOptions | null, collapsedIds: readonly RowId[] = [], initial = false): void {
    assertAlive();
    if (
      next !== null &&
      (!next || typeof next !== 'object' || Array.isArray(next) || typeof next.parentColumnKey !== 'string')
    )
      throw new TypeError('Invalid tree criteria.');
    if (
      next &&
      (context.grouping ||
        frozenRows ||
        merges.length ||
        groups.length ||
        rowAxis.hiddenIndices().length ||
        manualRows.size ||
        past.some((entry) => entry.kind !== 'values') ||
        future.some((entry) => entry.kind !== 'values'))
    )
      throw new Error('Clear grouping, row layout and non-value history before tree.');
    if (next === null && collapsedIds.length) throw new TypeError('No tree for collapsed IDs.');
    const criteria = next === null ? null : Object.freeze({ parentColumnKey: next.parentColumnKey });
    const nextProjection = drain(
      buildProjectionSteps(
        view,
        rowCount,
        merges,
        groups,
        frozenRows,
        false,
        dataSource,
        context.grouping,
        context.collapsedGroupingKeys,
        criteria,
        new Set(collapsedIds),
      ),
    );
    context.tree = criteria;
    context.collapsedTreeIds = new Set(collapsedIds);
    if (initial) installProjection(nextProjection);
    else groupingChanged(nextProjection);
  }
  function setTreeExpanded(rowId: RowId, expanded: boolean): void {
    assertAlive();
    if (!context.tree || typeof expanded !== 'boolean') throw new TypeError('No active tree or invalid expansion.');
    const index = projection?.findIndex((row) => typeof row === 'number' && dataSource.getRowId(row) === rowId) ?? -1;
    const node = index < 0 ? null : getTreeRowMetadata(index);
    if (!node?.hasChildren) throw new Error('Unknown visible tree branch.');
    if (node.expanded === expanded) return;
    const collapsed = new Set(context.collapsedTreeIds);
    if (expanded) collapsed.delete(rowId);
    else collapsed.add(rowId);
    const next = drain(
      buildProjectionSteps(
        view,
        rowCount,
        merges,
        groups,
        frozenRows,
        false,
        dataSource,
        context.grouping,
        context.collapsedGroupingKeys,
        context.tree,
        collapsed,
      ),
    );
    const active = selection;
    context.collapsedTreeIds = collapsed;
    groupingChanged(next);
    if (active) {
      const target = displayRow(active.rowIndex);
      const fallback = displayRow(node.sourceIndex);
      if (target >= 0 || fallback >= 0) selectDisplay(target >= 0 ? target : fallback, active.columnIndex);
    }
  }
  if (options.grouping !== undefined) setGrouping(options.grouping, [], true);
  if (options.tree !== undefined) setTree(options.tree, [], true);
  return Object.freeze({
    setTree: (next: LocalTreeOptions | null) => command(() => setTree(next)),
    get tree() {
      return context.tree;
    },
    getTreeRowMetadata: (row: number): LocalTreeRow | null => getTreeRowMetadata(row),
    setTreeExpanded: (rowId: RowId, expanded: boolean) => command(() => setTreeExpanded(rowId, expanded)),
    exportTreeState: (): TreeState =>
      query(() =>
        Object.freeze({ version: 1, tree: context.tree, collapsedIds: Object.freeze([...context.collapsedTreeIds]) }),
      ),
    restoreTreeState: (state: unknown) =>
      command(() => {
        if (
          !state ||
          typeof state !== 'object' ||
          !('version' in state) ||
          state.version !== 1 ||
          !('tree' in state) ||
          !('collapsedIds' in state) ||
          !Array.isArray(state.collapsedIds)
        )
          throw new TypeError('Invalid tree state.');
        const ids: RowId[] = Array.from(state.collapsedIds, (id: unknown) => {
          if (typeof id !== 'string' && !(typeof id === 'number' && Number.isFinite(id)))
            throw new TypeError('Invalid collapsed tree ID.');
          return id;
        });
        if (new Set(ids).size !== ids.length) throw new TypeError('Duplicate collapsed tree ID.');
        const criteria = state.tree;
        if (criteria === null) setTree(null, ids);
        else {
          if (
            typeof criteria !== 'object' ||
            !criteria ||
            !('parentColumnKey' in criteria) ||
            typeof criteria.parentColumnKey !== 'string'
          )
            throw new TypeError('Invalid tree state criteria.');
          setTree({ parentColumnKey: criteria.parentColumnKey }, ids);
        }
      }),
    setGrouping: (next: LocalGroupingOptions | null) => command(() => setGrouping(next)),
    exportGroupingState: (): GroupingState =>
      query(() =>
        Object.freeze({
          version: 1,
          grouping: context.grouping,
          collapsedKeys: Object.freeze([...context.collapsedGroupingKeys]),
        }),
      ),
    restoreGroupingState: (state: unknown) =>
      command(() => {
        if (
          !state ||
          typeof state !== 'object' ||
          !('version' in state) ||
          state.version !== 1 ||
          !('grouping' in state) ||
          !('collapsedKeys' in state) ||
          !Array.isArray(state.collapsedKeys)
        )
          throw new TypeError('Invalid grouping state.');
        const keys: GroupKey[] = [];
        const collapsedKeys: readonly unknown[] = state.collapsedKeys;
        for (const key of collapsedKeys) {
          if (
            key !== null &&
            typeof key !== 'string' &&
            typeof key !== 'boolean' &&
            !(typeof key === 'number' && Number.isFinite(key))
          )
            throw new TypeError('Invalid collapsed group key.');
          keys.push(key);
        }
        if (new Set(keys).size !== keys.length || (state.grouping === null && keys.length))
          throw new TypeError('Invalid collapsed group keys.');
        const criteria = state.grouping;
        if (criteria === null) {
          setGrouping(null, keys);
          return;
        }
        if (
          typeof criteria !== 'object' ||
          !criteria ||
          !('columnKey' in criteria) ||
          typeof criteria.columnKey !== 'string' ||
          ('sumColumns' in criteria && !Array.isArray(criteria.sumColumns))
        )
          throw new TypeError('Invalid grouping state criteria.');
        setGrouping(
          {
            columnKey: criteria.columnKey,
            ...('sumColumns' in criteria
              ? {
                  sumColumns: Array.from(criteria.sumColumns as unknown[], (key) => {
                    if (typeof key !== 'string') throw new TypeError('Invalid grouping sum column.');
                    return key;
                  }),
                }
              : {}),
          },
          keys,
        );
      }),
    get grouping() {
      return context.grouping;
    },
    getRowMetadata: (row: number): GridRowMetadata => {
      const entry = displayEntry(row);
      return typeof entry === 'number'
        ? Object.freeze({ kind: 'leaf' as const, sourceIndex: entry, rowId: dataSource.getRowId(entry) })
        : entry;
    },
    focusGroup: (row: number) => command(() => focusGroup(row)),
    getFocusedGroup: () =>
      context.groupFocus && projection
        ? projection.findIndex((row) => typeof row !== 'number' && Object.is(row.key, context.groupFocus!.key))
        : -1,
    setDataGroupExpanded: (key: GroupKey, expanded: boolean) => command(() => setDataGroupExpanded(key, expanded)),
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
    refreshRows: (startRow: number, endRow: number): RowRefreshResult => command(() => refreshRows(startRow, endRow)),
    refreshData: (previousRowIds?: readonly RowId[] | 'values') =>
      command(() => {
        if (context.grouping || context.tree) throw new Error('Clear grouping/tree before external refresh.');
        refreshData(previousRowIds);
      }),
    exportState: (): GridState =>
      query(() => {
        if (context.grouping || context.tree)
          throw new Error('Clear grouping/tree before exporting legacy grid state.');
        return exportState();
      }),
    restoreState: (state: unknown) =>
      command(() => {
        if (context.grouping || context.tree)
          throw new Error('Clear grouping/tree before restoring legacy grid state.');
        restoreState(state);
      }),
    setView: (next: LocalViewOptions) => command(() => setView(next)),
    setViewAsync: (next: LocalViewOptions, options: GridBulkOptions) =>
      bulkCommand(() => setViewSteps(snapshotView(next), true), options),
    get view() {
      return view;
    },
    exportConfiguration: (): GridConfiguration =>
      query(() => {
        if (context.grouping || context.tree)
          throw new Error('Clear grouping/tree before exporting legacy grid configuration.');
        return exportConfiguration();
      }),
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
      const entry = displayEntry(row);
      const span = typeof entry === 'number' ? mergeAt(entry, col) : undefined;
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
    getValue: (row: number, key: string): unknown => {
      const entry = displayEntry(row);
      return typeof entry === 'number'
        ? dataSource.getValue(entry, key)
        : key === context.grouping?.columnKey
          ? entry.key
          : Object.hasOwn(entry.sums, key)
            ? entry.sums[key]
            : undefined;
    },
    insertColumns: (index: number, added: readonly Column[]) => command(() => insertColumns(index, added)),
    deleteColumns: (indices: readonly number[]) => command(() => deleteColumns(indices)),
    insertRows: (index: number, rows: readonly DataRow[]) => command(() => insertRows(index, rows)),
    deleteRows: (indices: readonly number[]) => command(() => deleteRows(indices)),
    moveRows: (indices: readonly number[], beforeIndex: number) => command(() => moveAxis('row', indices, beforeIndex)),
    moveColumns: (indices: readonly number[], beforeIndex: number) =>
      command(() => moveAxis('column', indices, beforeIndex)),
    canChangeStructure: (request: Readonly<StructureRequest>) => query(() => structureAllowed(request)),
    isRowHeightManual: (index: number) => typeof displayEntry(index) === 'number' && manualRows.has(sourceRow(index)),
    measureRowHeight: (index: number, size: number) =>
      command(() => {
        if (!context.grouping && !context.tree) resize(rowAxis, sourceRow(index), size, false);
      }),
    getSelection: displaySelection,
    getSelectionRange: () => displaySelectionRanges().at(-1) ?? null,
    getSelectionRanges: displaySelectionRanges,
    getCellPermission: (row: number, col: number): CellPermission =>
      typeof displayEntry(row) === 'number'
        ? getCellPermission(sourceRow(row), col)
        : Object.freeze({
            editable: false,
            writable: false,
            pasteable: false,
            copyable: false,
            formatting: false,
            selectable: false,
          }),
    canEdit: (row: number, col: number) =>
      !destroyed &&
      row >= 0 &&
      row < visibleRowCount() &&
      typeof displayEntry(row) === 'number' &&
      canEdit(sourceRow(row), col),
    canPaste: () => displaySelectionRanges().length > 0 && canPaste(),
    select: (row: number, col: number, extend = false) =>
      command(() => {
        if (context.grouping && typeof displayEntry(row) !== 'number') return focusGroup(row);
        context.groupFocus = null;
        return selectDisplay(row, col, extend);
      }),
    selectRange: (range: SelectionRange, mode: 'replace' | 'add' | 'extend' = 'replace') =>
      command(() => {
        if (!projection && activeParts === 1) return selectRange(range, mode);
        return selectDisplayRange(range, mode);
      }),
    addSelection: (row: number, col: number) =>
      command(() => (typeof displayEntry(row) !== 'number' ? focusGroup(row) : selectDisplay(row, col, false, true))),
    toggleSelection: (row: number, col: number) =>
      command(() => (typeof displayEntry(row) !== 'number' ? focusGroup(row) : toggleSelection(row, col))),
    clearSelection: () => command(clearSelection),
    editCell: (row: number, col: number, text: string) => command(() => editCell(sourceRow(row), col, text)),
    updateCells: (updates: readonly CellUpdate[]) =>
      command(() => applyUpdates(updates.map((update) => ({ ...update, rowIndex: sourceRow(update.rowIndex) })))),
    updateCellsAsync: (updates: readonly CellUpdate[], options: GridBulkOptions) =>
      bulkCommand((guarded) => {
        if (!Array.isArray(updates)) throw new TypeError('Invalid bulk updates.');
        const snapshot = updates.map((update) => ({ ...update }));
        return (function* () {
          const mapped: CellUpdate[] = [];
          for (let index = 0; index < snapshot.length; index++) {
            const update = snapshot[index]!;
            mapped.push({ ...update, rowIndex: sourceRow(update.rowIndex) });
            if ((index + 1) % 256 === 0)
              yield { phase: 'prepare' as const, completed: index + 1, total: snapshot.length };
          }
          yield* applyUpdatesSteps(mapped, 'api', [], true, undefined, guarded);
        })();
      }, options),
    replaceText: (
      search: string,
      replacement: string,
      options: { readonly scope?: 'view' | 'selection'; readonly caseSensitive?: boolean } = {},
    ) => command(() => replaceText(search, replacement, options)),
    cutSelectionBlocks: () =>
      command(() => {
        if (context.grouping || context.tree)
          throw new Error('Cut is unavailable while grouping/tree; copy visible records instead.');
        return cutSelectionBlocks();
      }),
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
    pasteAsync: (text: string, bulk: GridBulkOptions, options?: PasteOptions) => {
      let decoded: unknown;
      const pasteOptions = options && { ...options };
      const decoder = bulk?.tsvDecoder;
      const decode = typeof decoder?.decodeTsv === 'function' ? decoder.decodeTsv.bind(decoder) : undefined;
      return bulkCommand(
        (guarded) => pasteSteps(text, pasteOptions, guarded, decoder ? () => decoded : undefined),
        bulk,
        bulk?.tsvDecoder
          ? async (captured) => {
              if (typeof text !== 'string' || text.length > clipboardTextLimit)
                throw new RangeError('Clipboard text is too large.');
              if (typeof captured.tsvDecoder?.decodeTsv !== 'function') throw new TypeError('Invalid TSV decoder.');
              decoded = await decode!(text, captured.signal);
            }
          : undefined,
      );
    },
    undo: () => command(() => replay(false)),
    redo: () => command(() => replay(true)),
    undoAsync: (options: GridBulkOptions) => bulkCommand((guarded) => replaySteps(false, true, guarded), options),
    redoAsync: (options: GridBulkOptions) => bulkCommand((guarded) => replaySteps(true, true, guarded), options),
    canUndo: () => !destroyed && past.length > 0,
    canRedo: () => !destroyed && future.length > 0,
    getFormat: (row: number, col: number) =>
      typeof displayEntry(row) === 'number' ? getFormat(sourceRow(row), col) : emptyFormat,
    canFormat: (targets: readonly CellFormatTarget[]) => query(() => canFormat(sourceFormats(targets))),
    format: (targets: readonly CellFormatTarget[], patch: CellFormatPatch | null) =>
      command(() => format(sourceFormats(targets), patch)),
    isLocked: (target: CellLockTarget) =>
      (target.scope === 'row' || target.scope === 'cell') && typeof displayEntry(target.rowIndex) !== 'number'
        ? true
        : isLocked(sourceTarget(target)),
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
    isRowHidden: (index: number) => typeof displayEntry(index) === 'number' && rowAxis.isHidden(sourceRow(index)),
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
      }, true),
  });
}

export type GridEngine = ReturnType<typeof createGridEngine>;
