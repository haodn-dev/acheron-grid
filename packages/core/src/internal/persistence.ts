import type { GridConfiguration } from '../configuration.js';
import { restoreGridConfiguration } from '../configuration.js';
import type { LocalViewOptions, RowId } from '../data-source.js';
import { snapshotLocalView as snapshotView } from '../data-source.js';
import type { createGridEngine, GridInvalidation } from '../engine.js';
import type { GridEvent } from '../events.js';
import type { CellPermission } from '../permissions.js';
import type { GridState } from '../state.js';
import { readGridState } from '../state.js';
import type { StructureRequest } from '../structure.js';
import type { CellFormatPatch, CellFormatTarget, Column, LayoutRequest, RowGroup, SelectionRange } from '../types.js';
import type { EngineContext, FormatEntry, StructureState } from './engine-context.js';
export function createPersistence(
  context: Pick<
    EngineContext,
    | 'dataSource'
    | 'rowHeight'
    | 'rowCount'
    | 'selection'
    | 'projection'
    | 'view'
    | 'past'
    | 'future'
    | 'pendingCut'
    | 'columns'
    | 'frozenRows'
    | 'columnAxis'
    | 'frozenColumns'
    | 'formats'
    | 'rowAxis'
    | 'manualRows'
    | 'activeParts'
    | 'displayAnchor'
    | 'anchor'
    | 'merges'
    | 'groups'
    | 'tableLocked'
    | 'lockedRows'
    | 'lockedColumns'
    | 'lockedCells'
    | 'columnIndices'
    | 'options'
    | 'groupId'
    | 'orderedFormats'
    | 'formatOrder'
    | 'retainedRanges'
  >,
  dependencies: {
    assertAlive: () => void;
    buildProjection: (
      next: LocalViewOptions,
      count?: number,
      spans?: readonly Readonly<SelectionRange>[],
      outlines?: readonly Readonly<RowGroup>[],
      frozen?: number,
    ) => number[] | null;
    installProjection: (next: number[] | null) => void;
    notify: (change: GridInvalidation, event: GridEvent) => void;
    displayRow: (row: number) => number;
    snapshotStructure: (rowIds?: readonly RowId[]) => StructureState;
    mappedState: (
      before: StructureState,
      order: readonly number[],
      axis: 'row' | 'column',
      rowMap: number[],
      columnMap: number[],
      addedColumns?: readonly Column[],
      externalIds?: readonly RowId[],
    ) => StructureState;
    restoreStructure: (state: StructureState) => void;
    getSelectionRanges: () => SelectionRange[];
    structureRequest: (
      axis: 'row' | 'column',
      kind: StructureRequest['kind'],
      indices: readonly number[],
      beforeIndex: number,
      count: number,
    ) => Readonly<StructureRequest>;
    structureAllowed: (request: Readonly<StructureRequest>) => boolean;
    createGridEngine: typeof createGridEngine;
    layoutAllowed: (request: LayoutRequest) => boolean;
    requirePermission: (rowIndex: number, columnIndex: number, key: keyof CellPermission) => void;
    requireFormatPermission: (bounds: SelectionRange) => void;
    requireVisibilityPolicy: (axis: 'row' | 'column', indices: readonly number[], hidden: boolean) => void;
  },
) {
  function refreshData(previousRowIds?: readonly RowId[] | 'values'): void {
    dependencies.assertAlive();
    const count = context.dataSource.getRowCount();
    if (!Number.isSafeInteger(count) || count < 0 || !Number.isFinite(count * context.rowHeight))
      throw new RangeError('Invalid refreshed row count.');
    if (previousRowIds === 'values') {
      if (
        count !== context.rowCount ||
        (context.selection &&
          !Object.is(context.selection.rowId, context.dataSource.getRowId(context.selection.rowIndex)))
      )
        throw new Error('Values-only refresh requires unchanged row identities and count.');
      const old = context.projection ?? Array.from({ length: context.rowCount }, (_, i) => i),
        next = dependencies.buildProjection(context.view);
      dependencies.installProjection(next);
      context.past.length = context.future.length = 0;
      context.pendingCut = undefined;
      dependencies.notify(
        { type: 'structure', rowMap: old.map(dependencies.displayRow), columnMap: context.columns.map((_, i) => i) },
        Object.freeze({
          type: 'data:refresh',
          previousRowCount: context.rowCount,
          rowCount: context.rowCount,
          identitiesReconciled: true,
        }),
      );
      return;
    }
    const ids = Array.from({ length: count }, (_, i) => context.dataSource.getRowId(i));
    const validIds = (values: readonly RowId[]) =>
      values.every((id) => typeof id === 'string' || (typeof id === 'number' && Number.isFinite(id))) &&
      new Set(values).size === values.length;
    if (!validIds(ids) || (previousRowIds && (previousRowIds.length !== context.rowCount || !validIds(previousRowIds))))
      throw new TypeError('Invalid refresh row identities.');
    const lookup = new Map(ids.map((id, i) => [id, i])),
      oldIds = previousRowIds ?? Array.from({ length: context.rowCount }, (_, i) => i);
    const rowMap = oldIds.map((id) => (previousRowIds ? (lookup.get(id) ?? -1) : -1)),
      columnsMap = context.columns.map((_, i) => i);
    const previousLookup = new Map(previousRowIds?.map((id, i) => [id, i]) ?? []),
      order = ids.map((id) => previousLookup.get(id) ?? -1);
    const before = dependencies.snapshotStructure(oldIds),
      contiguous = (start: number, end: number) =>
        rowMap.slice(start, end + 1).every((row, i, rows) => row >= 0 && row === rows[0]! + i);
    before.merges = before.merges.filter(
      (span) =>
        contiguous(span.startRow, span.endRow) &&
        !(
          rowMap[span.startRow]! < Math.min(context.frozenRows, count) &&
          rowMap[span.endRow]! >= Math.min(context.frozenRows, count)
        ),
    );
    before.groups = before.groups.filter(
      (group) =>
        contiguous(group.startRow, group.endRow) &&
        !(
          group.collapsed &&
          rowMap[group.startRow]! < Math.min(context.frozenRows, count) &&
          rowMap[group.endRow]! >= Math.min(context.frozenRows, count)
        ),
    );
    const oldDisplay = context.projection ?? Array.from({ length: context.rowCount }, (_, i) => i),
      next = dependencies.mappedState(before, order, 'row', rowMap, columnsMap, [], ids);
    next.rowIds = ids;
    for (const cell of [next.selection, next.anchor]) if (cell) cell.rowId = ids[cell.rowIndex]!;
    const oldCount = context.rowCount;
    const nextProjection = dependencies.buildProjection(context.view, count, next.merges, next.groups);
    dependencies.restoreStructure(next);
    dependencies.installProjection(nextProjection);
    context.past.length = context.future.length = 0;
    context.pendingCut = undefined;
    dependencies.notify(
      {
        type: 'structure',
        rowMap: oldDisplay.map((row) => (rowMap[row]! < 0 ? -1 : dependencies.displayRow(rowMap[row]!))),
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
    dependencies.assertAlive();
    return {
      version: 1,
      columns: context.columns.map((column, index) => ({
        key: column.key,
        width: context.columnAxis.storedSize(index),
      })),
      frozenRows: context.frozenRows,
      frozenColumns: context.frozenColumns,
      view: {
        ...context.view,
        ...(context.view.sort ? { sort: { ...context.view.sort } } : {}),
        ...(context.view.sorts ? { sorts: context.view.sorts.map((sort) => ({ ...sort })) } : {}),
        ...(context.view.filters ? { filters: context.view.filters.map((filter) => ({ ...filter })) } : {}),
      },
    };
  }
  function exportState(): GridState {
    dependencies.assertAlive();
    const layers = [...context.formats.values()]
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
      rowIds: Array.from({ length: context.rowCount }, (_, i) => context.dataSource.getRowId(i)),
      rowHeights: context.rowAxis.snapshot(),
      manualRows: [...context.manualRows],
      hiddenRows: context.rowAxis.hiddenIndices(),
      hiddenColumns: context.columnAxis.hiddenIndices(),
      activeParts: context.activeParts,
      displayAnchor: context.displayAnchor ? { ...context.displayAnchor } : null,
      ranges: dependencies.getSelectionRanges().map((range) => ({ ...range })),
      selection: context.selection ? { ...context.selection } : null,
      anchor: context.anchor ? { ...context.anchor } : null,
      merges: context.merges.map((span) => ({ ...span })),
      groups: context.groups.map((group) => ({ ...group })),
      locks: [
        ...(context.tableLocked ? [{ scope: 'table' as const }] : []),
        ...[...context.lockedRows].map((rowIndex) => ({ scope: 'row' as const, rowIndex })),
        ...[...context.lockedColumns].map((columnIndex) => ({ scope: 'column' as const, columnIndex })),
        ...[...context.lockedCells].map((key) => {
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
    dependencies.assertAlive();
    const saved = readGridState(input);
    if (context.tableLocked) throw new Error('Unlock the table before restoring state.');
    if (
      saved.rowIds.length !== context.rowCount ||
      saved.rowIds.some((id, i) => !Object.is(id, context.dataSource.getRowId(i)))
    )
      throw new Error('State row identities do not match the current source.');
    const configuration = restoreGridConfiguration(saved.configuration, context.columns, context.rowCount);
    const restoredOrder = configuration.columns.map((column) => context.columnIndices.get(column.key)!);
    if (restoredOrder.some((index, i) => index !== i)) {
      const request = Object.freeze({
        ...dependencies.structureRequest(
          'column',
          'move',
          restoredOrder.map((_, i) => i),
          0,
          restoredOrder.length,
        ),
        order: Object.freeze(restoredOrder),
        columns: Object.freeze(configuration.columns),
      });
      if (!dependencies.structureAllowed(request)) throw new Error('Structural change is disabled.');
    }
    const staged = dependencies.createGridEngine({
      ...context.options,
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
        saved.manualRows.some((row) => !Number.isSafeInteger(row) || row < 0 || row >= context.rowCount)
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
            cell.rowIndex >= context.rowCount ||
            cell.columnIndex < 0 ||
            cell.columnIndex >= context.columns.length ||
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
      const nextProjection = dependencies.buildProjection(
        configuration.view,
        context.rowCount,
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
          restoredAnchor.row >= (nextProjection?.length ?? context.rowCount) ||
          restoredAnchor.col < 0 ||
          restoredAnchor.col >= context.columns.length)
      )
        throw new TypeError('Invalid display anchor.');
      for (const span of context.merges)
        if (
          !saved.merges.some((next) => JSON.stringify(next) === JSON.stringify(span)) &&
          !dependencies.layoutAllowed({ kind: 'unmerge', range: span })
        )
          throw new Error('Removing merged cells is disabled.');
      for (const group of context.groups) {
        const next = saved.groups.find(
          (item) => item.id === group.id && item.startRow === group.startRow && item.endRow === group.endRow,
        );
        if (
          (!next && !dependencies.layoutAllowed({ kind: 'ungroup', group })) ||
          (next &&
            next.collapsed !== group.collapsed &&
            !dependencies.layoutAllowed({ kind: next.collapsed ? 'collapse' : 'expand', group }))
        )
          throw new Error('Changing row groups is disabled.');
      }
      for (const span of valid.merges)
        for (let row = span.startRow; row <= span.endRow; row++)
          for (let col = span.startColumn; col <= span.endColumn; col++)
            dependencies.requirePermission(row, restoredOrder[col]!, 'writable');
      for (const group of valid.groups)
        for (let row = group.startRow; row <= group.endRow; row++)
          if (context.lockedRows.has(row)) throw new Error('Changing locked row groups is disabled.');
      if (JSON.stringify(exportState().formats) !== JSON.stringify(valid.formats))
        for (const entry of context.formats.values()) dependencies.requireFormatPermission(entry.bounds);
      const shownRows = context.rowAxis.hiddenIndices().filter((index) => !hiddenRows.includes(index));
      const hiddenKeys = new Set(hiddenColumns.map((index) => configuration.columns[index]!.key));
      const shownColumns = context.columnAxis
        .hiddenIndices()
        .filter((index) => !hiddenKeys.has(context.columns[index]!.key));
      if (shownRows.length) dependencies.requireVisibilityPolicy('row', shownRows, false);
      if (shownColumns.length) dependencies.requireVisibilityPolicy('column', shownColumns, false);
      const nextFormats = new Map<string, FormatEntry>();
      let order = 0;
      for (const entry of valid.formats) {
        const target = entry.target,
          bounds: SelectionRange =
            target.scope === 'range'
              ? { ...target.range }
              : {
                  startRow: target.scope === 'row' || target.scope === 'cell' ? target.rowIndex : 0,
                  endRow: target.scope === 'row' || target.scope === 'cell' ? target.rowIndex : context.rowCount - 1,
                  startColumn: target.scope === 'column' || target.scope === 'cell' ? target.columnIndex : 0,
                  endColumn:
                    target.scope === 'column' || target.scope === 'cell'
                      ? target.columnIndex
                      : context.columns.length - 1,
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
      const old = context.projection ?? Array.from({ length: context.rowCount }, (_, i) => i),
        oldColumns = context.columns;
      context.columns = Object.freeze([...configuration.columns]);
      context.columnIndices.clear();
      context.columns.forEach((column, i) => context.columnIndices.set(column.key, i));
      context.columnAxis.replace(
        context.columns.length,
        configuration.columns.map((column, i) => [i, configuration.columnWidths[column.key]!] as const),
      );
      context.rowAxis.replace(context.rowCount, valid.rowHeights);
      context.rowAxis.replaceHidden(valid.hiddenRows ?? []);
      context.columnAxis.replaceHidden(valid.hiddenColumns ?? []);
      context.manualRows.clear();
      for (const row of manual) context.manualRows.add(row);
      context.merges = valid.merges.map((span) => Object.freeze({ ...span }));
      context.groups = valid.groups.map((group, i) =>
        Object.freeze({ ...group, id: saved.groups[i]!.id, collapsed: saved.groups[i]!.collapsed }),
      );
      context.groupId = 0;
      context.lockedRows.clear();
      context.lockedColumns.clear();
      context.lockedCells.clear();
      context.tableLocked = false;
      for (const target of valid.locks) {
        if (target.scope === 'table') context.tableLocked = true;
        else if (target.scope === 'row') context.lockedRows.add(target.rowIndex);
        else if (target.scope === 'column') context.lockedColumns.add(target.columnIndex);
        else context.lockedCells.add(`${target.rowIndex}:${target.columnIndex}`);
      }
      context.formats.clear();
      for (const [key, entry] of nextFormats) context.formats.set(key, entry);
      context.orderedFormats = [...context.formats.values()].sort((a, b) => a.order - b.order);
      context.formatOrder = order;
      context.frozenRows = configuration.frozenRows;
      context.frozenColumns = configuration.frozenColumns;
      context.selection = context.anchor = null;
      context.retainedRanges.length = 0;
      context.activeParts = 1;
      context.displayAnchor = null;
      for (const range of valid.ranges) context.retainedRanges.push({ ...range });
      const active = context.retainedRanges.pop();
      if (active && context.rowCount && context.columns.length) {
        context.selection = {
          rowIndex: active.startRow,
          columnIndex: active.startColumn,
          columnKey: context.columns[active.startColumn]!.key,
          rowId: context.dataSource.getRowId(active.startRow),
        };
        context.anchor = {
          rowIndex: active.endRow,
          columnIndex: active.endColumn,
          columnKey: context.columns[active.endColumn]!.key,
          rowId: context.dataSource.getRowId(active.endRow),
        };
      }
      if (saved.selection && saved.anchor) {
        context.selection = { ...saved.selection };
        context.anchor = { ...saved.anchor };
      }
      context.view = snapshotView(configuration.view);
      dependencies.installProjection(nextProjection);
      context.past.length = context.future.length = 0;
      context.pendingCut = undefined;
      context.activeParts = restoredParts;
      context.displayAnchor = restoredAnchor ? { ...restoredAnchor } : null;
      dependencies.notify(
        {
          type: 'structure',
          rowMap: old.map(dependencies.displayRow),
          columnMap: oldColumns.map((column) => context.columnIndices.get(column.key) ?? -1),
        },
        Object.freeze({ type: 'state:restore' }),
      );
    } finally {
      staged.destroy();
    }
  }
  return { refreshData, exportConfiguration, exportState, restoreState };
}
