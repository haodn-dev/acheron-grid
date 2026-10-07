import { GridAxis } from '../axis.js';
import { recordHistory } from './history-budget.js';
import type { DataRow, RowId, RowSplice } from '../data-source.js';
import type { GridInvalidation } from '../engine.js';
import type { GridEvent } from '../events.js';
import type { CellPermission } from '../permissions.js';
import type { StructureRequest } from '../structure.js';
import { reorderedIndices } from '../structure.js';
import type { CellFormatTarget, CellSelection, Column, SelectionRange } from '../types.js';
import type { EngineContext, FormatEntry, HistoryCommand, StructureState } from './engine-context.js';
import { inverseMap, mappedRanges, rowBlocks } from './structure-mapping.js';
export function createStructure(
  context: Pick<
    EngineContext,
    | 'rowCount'
    | 'dataSource'
    | 'rowAxis'
    | 'columnAxis'
    | 'anchor'
    | 'retainedRanges'
    | 'manualRows'
    | 'lockedRows'
    | 'lockedColumns'
    | 'lockedCells'
    | 'formats'
    | 'merges'
    | 'groups'
    | 'activeParts'
    | 'displayAnchor'
    | 'cachedRanges'
    | 'columns'
    | 'columnIndices'
    | 'selection'
    | 'orderedFormats'
    | 'frozenRows'
    | 'frozenColumns'
    | 'destroyed'
    | 'projection'
    | 'tableLocked'
    | 'options'
    | 'addedColumnKeys'
    | 'rowHeight'
    | 'columnWidth'
    | 'past'
    | 'future'
  >,
  dependencies: {
    getSelection: () => CellSelection | null;
    getSelectionRange: () => SelectionRange | null;
    validateMergeFreeze: (spans: readonly Readonly<SelectionRange>[], rows?: number, cols?: number) => void;
    getCellPermission: (rowIndex: number, columnIndex: number) => CellPermission;
    notify: (change: GridInvalidation, event: GridEvent) => void;
    assertAlive: () => void;
  },
) {
  function snapshotStructure(rowIds?: readonly RowId[]): StructureState {
    return {
      merges: context.merges,
      groups: context.groups,
      columns: context.columns,
      rowCount: context.rowCount,
      rowIds: rowIds ?? Array.from({ length: context.rowCount }, (_, i) => context.dataSource.getRowId(i)),
      rows: context.rowAxis.snapshot(),
      widths: context.columnAxis.snapshot(),
      selection: dependencies.getSelection(),
      anchor: context.anchor ? { ...context.anchor } : null,
      ranges: context.retainedRanges.map((range) => ({ ...range })),
      manualRows: [...context.manualRows],
      hiddenRows: context.rowAxis.hiddenIndices(),
      hiddenColumns: context.columnAxis.hiddenIndices(),
      lockedRows: [...context.lockedRows],
      lockedColumns: [...context.lockedColumns],
      lockedCells: [...context.lockedCells],
      formats: new Map(context.formats),
      frozenRows: context.frozenRows,
      frozenColumns: context.frozenColumns,
    };
  }
  function restoreStructure(state: StructureState): void {
    context.merges = [...state.merges];
    context.groups = [...state.groups];
    context.activeParts = 1;
    context.displayAnchor = null;
    context.cachedRanges = null;
    context.columns = state.columns;
    context.rowCount = state.rowCount;
    context.columnIndices.clear();
    context.columns.forEach((column, i) => context.columnIndices.set(column.key, i));
    context.rowAxis.replace(context.rowCount, state.rows);
    context.columnAxis.replace(context.columns.length, state.widths);
    context.rowAxis.replaceHidden(state.hiddenRows);
    context.columnAxis.replaceHidden(state.hiddenColumns);
    context.selection = state.selection ? { ...state.selection } : null;
    context.anchor = state.anchor ? { ...state.anchor } : null;
    context.retainedRanges.length = 0;
    context.retainedRanges.push(...state.ranges.map((range) => ({ ...range })));
    context.manualRows.clear();
    for (const index of state.manualRows) context.manualRows.add(index);
    context.lockedRows.clear();
    for (const index of state.lockedRows) context.lockedRows.add(index);
    context.lockedColumns.clear();
    for (const index of state.lockedColumns) context.lockedColumns.add(index);
    context.lockedCells.clear();
    for (const key of state.lockedCells) context.lockedCells.add(key);
    context.formats.clear();
    for (const [key, entry] of state.formats) context.formats.set(key, entry);
    context.orderedFormats = [...context.formats.values()].sort((a, b) => a.order - b.order);
    context.frozenRows = state.frozenRows;
    context.frozenColumns = state.frozenColumns;
  }
  function mappedState(
    before: StructureState,
    order: readonly number[],
    axis: 'row' | 'column',
    rowMap: number[],
    columnMap: number[],
    addedColumns: readonly Column[] = [],
    externalIds?: readonly RowId[],
  ): StructureState {
    let inserted = 0;
    const nextColumns =
      axis === 'column'
        ? Object.freeze(order.map((i) => (i < 0 ? addedColumns[inserted++]! : context.columns[i]!)))
        : context.columns;
    const nextCount = axis === 'row' ? order.length : context.rowCount;
    const mapCell = (cell: CellSelection | null): CellSelection | null => {
      if (
        !cell ||
        rowMap[cell.rowIndex] === undefined ||
        rowMap[cell.rowIndex]! < 0 ||
        columnMap[cell.columnIndex] === undefined ||
        columnMap[cell.columnIndex]! < 0
      )
        return null;
      return { ...cell, rowIndex: rowMap[cell.rowIndex]!, columnIndex: columnMap[cell.columnIndex]! };
    };
    const ranges = before.ranges.flatMap((range) => mappedRanges(range, rowMap, columnMap));
    const currentRange = dependencies.getSelectionRange(),
      activeRanges = currentRange ? mappedRanges(currentRange, rowMap, columnMap) : [];
    const nextSelection = mapCell(context.selection),
      nextAnchor = mapCell(context.anchor);
    const active = activeRanges.findIndex(
      (range) =>
        nextSelection &&
        nextSelection.rowIndex >= range.startRow &&
        nextSelection.rowIndex <= range.endRow &&
        nextSelection.columnIndex >= range.startColumn &&
        nextSelection.columnIndex <= range.endColumn,
    );
    if (active >= 0) activeRanges.push(...activeRanges.splice(active, 1));
    ranges.push(...activeRanges);
    if (ranges.length > 128) throw new RangeError('Structural change would exceed the selection range limit.');
    const activeRange = ranges.pop();
    const cellAt = (rowIndex: number, columnIndex: number): CellSelection => ({
      rowIndex,
      columnIndex,
      columnKey: nextColumns[columnIndex]!.key,
      rowId:
        externalIds?.[rowIndex] ??
        (axis === 'row' ? context.dataSource.getRowId(order[rowIndex]!) : context.dataSource.getRowId(rowIndex)),
    });
    let mappedSelection = nextSelection,
      mappedAnchor = nextAnchor;
    if (activeRange && nextCount && nextColumns.length) {
      const exact =
        nextSelection &&
        nextAnchor &&
        Math.min(nextSelection.rowIndex, nextAnchor.rowIndex) === activeRange.startRow &&
        Math.max(nextSelection.rowIndex, nextAnchor.rowIndex) === activeRange.endRow &&
        Math.min(nextSelection.columnIndex, nextAnchor.columnIndex) === activeRange.startColumn &&
        Math.max(nextSelection.columnIndex, nextAnchor.columnIndex) === activeRange.endColumn;
      if (!exact) {
        mappedSelection = cellAt(activeRange.startRow, activeRange.startColumn);
        mappedAnchor = cellAt(activeRange.endRow, activeRange.endColumn);
      }
    } else mappedSelection = mappedAnchor = null;
    const nextFormats = new Map<string, FormatEntry>();
    for (const entry of before.formats.values()) {
      const targets: CellFormatTarget[] = [];
      if (entry.target.scope === 'table') targets.push(entry.target);
      else if (entry.target.scope === 'row') {
        const row = rowMap[entry.target.rowIndex]!;
        if (row >= 0) targets.push({ scope: 'row', rowIndex: row });
      } else if (entry.target.scope === 'column') {
        const col = columnMap[entry.target.columnIndex]!;
        if (col >= 0) targets.push({ scope: 'column', columnIndex: col });
      } else if (entry.target.scope === 'cell') {
        const row = rowMap[entry.target.rowIndex]!,
          col = columnMap[entry.target.columnIndex]!;
        if (row >= 0 && col >= 0) targets.push({ scope: 'cell', rowIndex: row, columnIndex: col });
      } else
        for (const range of mappedRanges(entry.bounds, rowMap, columnMap))
          targets.push({ scope: 'range', range: Object.freeze(range) });
      for (const target of targets) {
        const bounds: SelectionRange =
          target.scope === 'range'
            ? { ...target.range }
            : {
                startRow: target.scope === 'row' || target.scope === 'cell' ? target.rowIndex : 0,
                endRow: target.scope === 'row' || target.scope === 'cell' ? target.rowIndex : nextCount - 1,
                startColumn: target.scope === 'column' || target.scope === 'cell' ? target.columnIndex : 0,
                endColumn:
                  target.scope === 'column' || target.scope === 'cell' ? target.columnIndex : nextColumns.length - 1,
              };
        const nextKey = JSON.stringify([
          target.scope,
          bounds.startRow,
          bounds.endRow,
          bounds.startColumn,
          bounds.endColumn,
        ]);
        const existing = nextFormats.get(nextKey),
          patch = { ...existing?.patch },
          orders = { ...existing?.orders };
        for (const property of [
          'background',
          'textColor',
          'contentFormat',
          'fontWeight',
          'fontStyle',
          'numberFormat',
        ] as const)
          if ((entry.orders[property] ?? 0) > (orders[property] ?? 0)) {
            orders[property] = entry.orders[property]!;
            Object.assign(patch, { [property]: entry.patch[property]! });
          }
        nextFormats.set(nextKey, {
          ...entry,
          target: Object.freeze(target),
          bounds: Object.freeze(bounds),
          patch: Object.freeze(patch),
          orders: Object.freeze(orders),
          order: Math.max(existing?.order ?? 0, entry.order),
        });
      }
    }
    const mapSizes = (sizes: StructureState['rows'], map: readonly number[]) =>
      sizes.filter(([i]) => map[i]! >= 0).map(([i, size]) => [map[i]!, size] as const);
    function contiguous(start: number, end: number, map: readonly number[]): [number, number] | null {
      const values = map.slice(start, end + 1);
      if (values.some((i) => i < 0)) return null;
      if (values.some((value, i) => value !== values[0]! + i))
        throw new Error('This change would split a merged cell or row group. Remove it first.');
      return [values[0]!, values.at(-1)!];
    }
    const nextMerges = before.merges.flatMap((span) => {
      const rows = contiguous(span.startRow, span.endRow, rowMap),
        cols = contiguous(span.startColumn, span.endColumn, columnMap);
      return rows && cols
        ? [Object.freeze({ startRow: rows[0], endRow: rows[1], startColumn: cols[0], endColumn: cols[1] })]
        : [];
    });
    const nextGroups = before.groups.flatMap((group) => {
      const rows = contiguous(group.startRow, group.endRow, rowMap);
      return rows ? [Object.freeze({ ...group, startRow: rows[0], endRow: rows[1] })] : [];
    });
    dependencies.validateMergeFreeze(
      nextMerges,
      Math.min(context.frozenRows, nextCount),
      Math.min(context.frozenColumns, nextColumns.length),
    );
    return {
      ...before,
      columns: nextColumns,
      rowCount: nextCount,
      rowIds: axis === 'row' ? order.map((i) => (i < 0 ? '' : before.rowIds[i]!)) : before.rowIds,
      rows: mapSizes(before.rows, rowMap),
      widths: mapSizes(before.widths, columnMap),
      selection: mappedSelection,
      anchor: mappedAnchor,
      ranges,
      merges: nextMerges,
      groups: nextGroups,
      hiddenRows: before.hiddenRows.map((i) => rowMap[i]!).filter((i) => i >= 0),
      hiddenColumns: before.hiddenColumns.map((i) => columnMap[i]!).filter((i) => i >= 0),
      manualRows: before.manualRows.map((i) => rowMap[i]!).filter((i) => i >= 0),
      lockedRows: before.lockedRows.map((i) => rowMap[i]!).filter((i) => i >= 0),
      lockedColumns: before.lockedColumns.map((i) => columnMap[i]!).filter((i) => i >= 0),
      lockedCells: before.lockedCells.flatMap((key) => {
        const [r, c] = key.split(':').map(Number);
        const row = rowMap[r!]!,
          col = columnMap[c!]!;
        return row >= 0 && col >= 0 ? [`${row}:${col}`] : [];
      }),
      formats: nextFormats,
      frozenRows: Math.min(context.frozenRows, nextCount),
      frozenColumns: Math.min(context.frozenColumns, nextColumns.length),
    };
  }
  function structureAllowed(request: Readonly<StructureRequest>): boolean {
    const limit = request?.axis === 'row' ? context.rowCount : context.columns.length;
    if (
      !request ||
      !['row', 'column'].includes(request.axis) ||
      !['insert', 'delete', 'move'].includes(request.kind) ||
      !Array.isArray(request.indices) ||
      !Number.isSafeInteger(request.beforeIndex) ||
      request.beforeIndex < 0 ||
      request.beforeIndex > limit ||
      !Number.isSafeInteger(request.count) ||
      request.count < 1 ||
      new Set(request.indices).size !== request.indices.length ||
      request.indices.some((i) => !Number.isSafeInteger(i) || i < 0 || i >= limit)
    )
      return false;
    if (
      context.destroyed ||
      context.projection ||
      context.tableLocked ||
      context.options.canChangeStructure?.(request) === false
    )
      return false;
    if (request.axis === 'row' && (!context.dataSource.getRow || !context.dataSource.spliceRows)) return false;
    if (request.axis === 'column' && request.kind !== 'move' && !context.dataSource.addColumns) return false;
    if (request.kind === 'delete') {
      if (request.axis === 'row') {
        if (request.indices.some((row) => context.lockedRows.has(row))) return false;
        for (const row of request.indices)
          for (let col = 0; col < context.columns.length; col++)
            if (!dependencies.getCellPermission(row, col).writable) return false;
      } else {
        if (request.indices.some((col) => context.lockedColumns.has(col))) return false;
      }
    }
    return true;
  }
  function structureRequest(
    axis: 'row' | 'column',
    kind: StructureRequest['kind'],
    indices: readonly number[],
    beforeIndex: number,
    count: number,
  ): Readonly<StructureRequest> {
    return Object.freeze({ axis, kind, indices: Object.freeze([...indices]), beforeIndex, count });
  }
  function notifyStructure(
    entry: Extract<HistoryCommand, { kind: 'structure' }>,
    redo: boolean,
    source: 'api' | 'undo' | 'redo',
  ): void {
    const state = redo ? entry.after : entry.before;
    dependencies.notify(
      {
        type: 'structure',
        rowMap: redo ? entry.rowMap : Object.freeze(inverseMap(entry.rowMap, entry.after.rowCount)),
        columnMap: redo ? entry.columnMap : Object.freeze(inverseMap(entry.columnMap, entry.after.columns.length)),
      },
      Object.freeze({
        type: 'structure:change',
        source,
        request: redo ? entry.request : entry.reverseRequest,
        rowCount: state.rowCount,
        columnKeys: Object.freeze(state.columns.map((col) => col.key)),
      }),
    );
  }
  function replayStructure(entry: Extract<HistoryCommand, { kind: 'structure' }>, redo: boolean): void {
    const request = redo ? entry.request : entry.reverseRequest;
    if (!structureAllowed(request)) throw new Error('Structural change is disabled.');
    if (context.dataSource.getRowCount() !== context.rowCount)
      throw new Error('Structural history conflicts with external row count.');
    const expectedState = redo ? entry.before : entry.after;
    if (expectedState.rowIds.some((id, i) => context.dataSource.getRowId(i) !== id))
      throw new Error('Structural history conflicts with external row identity.');
    const splices = redo ? entry.forward : entry.backward;
    // Validate snapshots that this direction removes, before any source mutation.
    if (request.axis === 'row') {
      const removed = splices.flatMap((splice) =>
        Array.from({ length: splice.deleteCount }, (_, i) => splice.index + i),
      );
      const removedById = new Map(removed.map((i) => [context.dataSource.getRowId(i), i]));
      const inserted = (redo ? entry.backward : entry.forward).flatMap((splice) => splice.rows);
      for (const row of inserted)
        if (removedById.has(row.id)) {
          const index = removedById.get(row.id)!;
          const current = context.dataSource.getRow!(index);
          if (
            Object.keys(current.values).some(
              (key) =>
                !Object.hasOwn(row.values, key) &&
                !context.addedColumnKeys.has(key) &&
                current.values[key] !== undefined,
            ) ||
            Object.keys(row.values).some((key) => !Object.is(current.values[key], row.values[key]))
          )
            throw new Error('Structural history conflicts with external data changes.');
        }
      const liveRows = new Map(removed.map((i) => [context.dataSource.getRowId(i), context.dataSource.getRow!(i)]));
      context.dataSource.spliceRows!(
        splices.map((splice) => ({
          ...splice,
          rows: splice.rows.map((row) => ({ id: row.id, values: { ...liveRows.get(row.id)?.values, ...row.values } })),
        })),
      );
    }
    const state = redo ? entry.after : entry.before;
    const rMap = redo ? entry.rowMap : inverseMap(entry.rowMap, entry.after.rowCount),
      cMap = redo ? entry.columnMap : inverseMap(entry.columnMap, entry.after.columns.length);
    // Locks are outside history: preserve changes made since the structural command.
    const previousLocks = {
      rows: [...context.lockedRows],
      columns: [...context.lockedColumns],
      cells: [...context.lockedCells],
    };
    restoreStructure(state);
    context.lockedRows.clear();
    previousLocks.rows.forEach((i) => {
      if (rMap[i]! >= 0) context.lockedRows.add(rMap[i]!);
    });
    context.lockedColumns.clear();
    previousLocks.columns.forEach((i) => {
      if (cMap[i]! >= 0) context.lockedColumns.add(cMap[i]!);
    });
    context.lockedCells.clear();
    previousLocks.cells.forEach((key) => {
      const [r, c] = key.split(':').map(Number);
      if (rMap[r!]! >= 0 && cMap[c!]! >= 0) context.lockedCells.add(`${rMap[r!]}:${cMap[c!]}`);
    });
    if (!redo) {
      for (const row of state.lockedRows) if (entry.rowMap[row] === -1) context.lockedRows.add(row);
      for (const col of state.lockedColumns) if (entry.columnMap[col] === -1) context.lockedColumns.add(col);
      for (const key of state.lockedCells) {
        const [r, c] = key.split(':').map(Number);
        if (entry.rowMap[r!] === -1 || entry.columnMap[c!] === -1) context.lockedCells.add(key);
      }
    }
  }
  function changeStructure(
    request: Readonly<StructureRequest>,
    reverseRequest: Readonly<StructureRequest>,
    order: readonly number[],
    forward: readonly RowSplice[],
    backward: readonly RowSplice[],
    addedColumns: readonly Column[] = [],
  ): void {
    dependencies.assertAlive();
    if (context.dataSource.getRowCount() !== context.rowCount) throw new Error('External row count changed.');
    const rowMap = Array.from({ length: context.rowCount }, (_, i) => i),
      columnMap = Array.from({ length: context.columns.length }, (_, i) => i);
    const map = request.axis === 'row' ? rowMap : columnMap;
    map.fill(-1);
    order.forEach((old, index) => {
      if (old >= 0) map[old] = index;
    });
    const before = snapshotStructure(),
      after = mappedState(before, order, request.axis, rowMap, columnMap, addedColumns);
    request = Object.freeze({ ...request, order: Object.freeze([...order]), columns: after.columns });
    reverseRequest = Object.freeze({ ...reverseRequest, order: Object.freeze([...map]), columns: before.columns });
    if (!structureAllowed(request)) throw new Error('Structural change is disabled.');
    const checkRows = new GridAxis(after.rowCount, context.rowHeight),
      checkColumns = new GridAxis(after.columns.length, context.columnWidth);
    checkRows.replace(after.rowCount, after.rows);
    checkColumns.replace(after.columns.length, after.widths);
    if (addedColumns.length) {
      context.dataSource.addColumns!(
        addedColumns.map((column) => column.key),
        Object.fromEntries(
          addedColumns
            .filter((column) => Object.hasOwn(column, 'defaultValue'))
            .map((column) => [column.key, column.defaultValue]),
        ),
      );
      addedColumns.forEach((column) => context.addedColumnKeys.add(column.key));
    }
    if (request.axis === 'row') {
      let inserted = 0;
      const newRows = forward.flatMap((splice) => splice.rows);
      after.rowIds = order.map((old) => (old >= 0 ? before.rowIds[old]! : newRows[inserted++]!.id));
      context.dataSource.spliceRows!(forward);
    }
    restoreStructure(after);
    const entry: Extract<HistoryCommand, { kind: 'structure' }> = {
      kind: 'structure',
      request,
      reverseRequest,
      before,
      after,
      forward,
      backward,
      rowMap: Object.freeze(rowMap),
      columnMap: Object.freeze(columnMap),
    };
    recordHistory(context, entry);
    context.future.length = 0;
    notifyStructure(entry, true, 'api');
  }
  function insertRows(beforeIndex: number, rows: readonly DataRow[]): void {
    dependencies.assertAlive();
    if (!Number.isSafeInteger(beforeIndex) || beforeIndex < 0 || beforeIndex > context.rowCount || !Array.isArray(rows))
      throw new RangeError('Invalid row insertion.');
    if (!rows.length) return;
    const snapshots = Object.freeze(
      rows.map((row) => Object.freeze({ id: row.id, values: Object.freeze({ ...row.values }) })),
    );
    const previous = Array.from({ length: context.rowCount }, (_, i) => i),
      order = previous.slice(0, beforeIndex).concat(Array<number>(rows.length).fill(-1), previous.slice(beforeIndex));
    changeStructure(
      structureRequest('row', 'insert', [], beforeIndex, rows.length),
      structureRequest(
        'row',
        'delete',
        rows.map((_, i) => beforeIndex + i),
        beforeIndex,
        rows.length,
      ),
      order,
      [{ index: beforeIndex, deleteCount: 0, rows: snapshots }],
      [{ index: beforeIndex, deleteCount: rows.length, rows: [] }],
    );
  }
  function deleteRows(indices: readonly number[]): void {
    dependencies.assertAlive();
    if (!indices.length) return;
    const ordered = [...indices].sort((a, b) => a - b);
    if (
      new Set(ordered).size !== ordered.length ||
      ordered.some((i) => !Number.isSafeInteger(i) || i < 0 || i >= context.rowCount)
    )
      throw new RangeError('Invalid row deletion.');
    if (!context.dataSource.getRow || !context.dataSource.spliceRows)
      throw new Error('Atomic structural source methods are required.');
    const deleted = new Set(ordered),
      rows = ordered.map((i) => context.dataSource.getRow!(i)),
      blocks = rowBlocks(ordered, rows);
    changeStructure(
      structureRequest('row', 'delete', ordered, ordered[0]!, ordered.length),
      structureRequest('row', 'insert', [], ordered[0]!, ordered.length),
      Array.from({ length: context.rowCount }, (_, i) => i).filter((i) => !deleted.has(i)),
      blocks.map((block) => ({ ...block, rows: [] })).reverse(),
      blocks.map((block) => ({ ...block, deleteCount: 0 })),
    );
  }
  function insertColumns(beforeIndex: number, added: readonly Column[]): void {
    dependencies.assertAlive();
    if (
      !Number.isSafeInteger(beforeIndex) ||
      beforeIndex < 0 ||
      beforeIndex > context.columns.length ||
      !Array.isArray(added)
    )
      throw new RangeError('Invalid column insertion.');
    if (!added.length) return;
    const snapshots = Object.freeze(
      added.map((column) => {
        if (!column || typeof column.key !== 'string' || !column.key || typeof column.title !== 'string')
          throw new TypeError('Invalid inserted column.');
        return Object.freeze({
          ...column,
          ...(column.permissions ? { permissions: Object.freeze({ ...column.permissions }) } : {}),
        });
      }),
    );
    if (
      new Set([...context.columns, ...snapshots].map((c) => c.key)).size !==
      context.columns.length + snapshots.length
    )
      throw new Error('Column keys must be unique.');
    const previous = Array.from({ length: context.columns.length }, (_, i) => i),
      order = previous
        .slice(0, beforeIndex)
        .concat(Array<number>(snapshots.length).fill(-1), previous.slice(beforeIndex));
    changeStructure(
      structureRequest('column', 'insert', [], beforeIndex, added.length),
      structureRequest(
        'column',
        'delete',
        added.map((_, i) => beforeIndex + i),
        beforeIndex,
        added.length,
      ),
      order,
      [],
      [],
      snapshots,
    );
  }
  function deleteColumns(indices: readonly number[]): void {
    dependencies.assertAlive();
    if (!indices.length) return;
    const selected = [...indices].sort((a, b) => a - b);
    if (
      new Set(selected).size !== selected.length ||
      selected.some((i) => !Number.isSafeInteger(i) || i < 0 || i >= context.columns.length)
    )
      throw new RangeError('Invalid column deletion.');
    const removed = new Set(selected),
      order = Array.from({ length: context.columns.length }, (_, i) => i).filter((i) => !removed.has(i));
    changeStructure(
      structureRequest('column', 'delete', selected, selected[0]!, selected.length),
      structureRequest('column', 'insert', [], selected[0]!, selected.length),
      order,
      [],
      [],
    );
  }
  function moveAxis(axis: 'row' | 'column', indices: readonly number[], beforeIndex: number): void {
    dependencies.assertAlive();
    const count = axis === 'row' ? context.rowCount : context.columns.length,
      order = reorderedIndices(count, indices, beforeIndex);
    if (order.every((old, i) => old === i)) return;
    const selected = [...indices].sort((a, b) => a - b),
      insertion = beforeIndex - selected.filter((i) => i < beforeIndex).length;
    let forward: RowSplice[] = [],
      backward: RowSplice[] = [];
    if (axis === 'row') {
      if (!context.dataSource.getRow || !context.dataSource.spliceRows)
        throw new Error('Atomic structural source methods are required.');
      const rows = selected.map((i) => context.dataSource.getRow!(i)),
        blocks = rowBlocks(selected, rows);
      forward = blocks.map((block) => ({ ...block, rows: [] })).reverse();
      forward.push({ index: insertion, deleteCount: 0, rows });
      backward = [
        { index: insertion, deleteCount: selected.length, rows: [] },
        ...blocks.map((block) => ({ ...block, deleteCount: 0 })),
      ];
    }
    changeStructure(
      structureRequest(axis, 'move', selected, beforeIndex, selected.length),
      structureRequest(
        axis,
        'move',
        selected.map((_, i) => insertion + i),
        selected[0]!,
        selected.length,
      ),
      order,
      forward,
      backward,
    );
  }
  return {
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
  };
}
