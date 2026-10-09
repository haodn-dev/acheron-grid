import type { LocalViewOptions } from '../data-source.js';
import type { GridInvalidation } from '../engine.js';
import type { GridEvent } from '../events.js';
import type { CellPermission } from '../permissions.js';
import { clipboardCellLimit } from '../tsv.js';
import { recordHistory } from './history-budget.js';
import type { LayoutRequest, RowGroup, SelectionRange } from '../types.js';
import type { EngineContext, HistoryCommand } from './engine-context.js';
export function createOutline(
  context: Pick<
    EngineContext,
    | 'merges'
    | 'frozenRows'
    | 'frozenColumns'
    | 'rowCount'
    | 'columns'
    | 'tableLocked'
    | 'options'
    | 'lockedRows'
    | 'selection'
    | 'dataSource'
    | 'view'
    | 'projection'
    | 'groups'
    | 'past'
    | 'future'
    | 'groupId'
  >,
  dependencies: {
    assertAlive: () => void;
    getCellPermission: (rowIndex: number, columnIndex: number) => CellPermission;
    installProjection: (next: number[] | null) => void;
    buildProjection: (
      next: LocalViewOptions,
      count?: number,
      spans?: readonly Readonly<SelectionRange>[],
      outlines?: readonly Readonly<RowGroup>[],
      frozen?: number,
    ) => number[] | null;
    notify: (change: GridInvalidation, event: GridEvent) => void;
    displayRow: (row: number) => number;
    sourceRanges: (range: SelectionRange) => SelectionRange[];
    sourceRow: (index: number) => number;
  },
) {
  function intersects(a: Readonly<SelectionRange>, b: Readonly<SelectionRange>): boolean {
    return (
      a.startRow <= b.endRow && b.startRow <= a.endRow && a.startColumn <= b.endColumn && b.startColumn <= a.endColumn
    );
  }
  function mergeAt(row: number, col: number): Readonly<SelectionRange> | undefined {
    return context.merges.find(
      (range) => row >= range.startRow && row <= range.endRow && col >= range.startColumn && col <= range.endColumn,
    );
  }
  function expandMergedRange(
    range: SelectionRange,
    spans: readonly Readonly<SelectionRange>[] = context.merges,
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
    rows = context.frozenRows,
    cols = context.frozenColumns,
  ): void {
    if (
      spans.some(
        (span) => (span.startRow < rows && span.endRow >= rows) || (span.startColumn < cols && span.endColumn >= cols),
      )
    )
      throw new Error('A merged cell cannot cross a frozen boundary.');
  }
  function layoutAllowed(request: LayoutRequest): boolean {
    dependencies.assertAlive();
    if (!request || !['merge', 'unmerge', 'group', 'ungroup', 'collapse', 'expand'].includes(request.kind))
      return false;
    if ('range' in request) {
      const range = request.range;
      if (
        !range ||
        ![range.startRow, range.endRow, range.startColumn, range.endColumn].every(Number.isSafeInteger) ||
        range.startRow < 0 ||
        range.endRow < range.startRow ||
        range.endRow >= context.rowCount ||
        range.startColumn < 0 ||
        range.endColumn < range.startColumn ||
        range.endColumn >= context.columns.length
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
        group.endRow >= context.rowCount ||
        typeof group.collapsed !== 'boolean'
      )
        return false;
    }
    const snapshot = Object.freeze(
      'range' in request
        ? { ...request, range: Object.freeze({ ...request.range }) }
        : { ...request, group: Object.freeze({ ...request.group }) },
    );
    if (context.tableLocked || context.options.canChangeLayout?.(snapshot) === false) return false;
    if ('range' in request) {
      if (context.options.allowMerging === false) return false;
      const range = request.range;
      if ((range.endRow - range.startRow + 1) * (range.endColumn - range.startColumn + 1) > clipboardCellLimit)
        return false;
      for (let row = range.startRow; row <= range.endRow; row++)
        for (let col = range.startColumn; col <= range.endColumn; col++)
          if (!dependencies.getCellPermission(row, col).writable) return false;
    } else {
      if (context.options.allowRowGrouping === false) return false;
      for (let row = request.group.startRow; row <= request.group.endRow; row++)
        if (context.lockedRows.has(row)) return false;
    }
    return true;
  }
  function notifyOutline(kind: 'merge' | 'group', old: readonly number[], source: 'api' | 'undo' | 'redo'): void {
    if (context.selection) {
      const span = mergeAt(context.selection.rowIndex, context.selection.columnIndex);
      if (span)
        context.selection = {
          rowIndex: span.startRow,
          columnIndex: span.startColumn,
          rowId: context.dataSource.getRowId(span.startRow),
          columnKey: context.columns[span.startColumn]!.key,
        };
    }
    dependencies.installProjection(dependencies.buildProjection(context.view));
    dependencies.notify(
      { type: 'structure', rowMap: old.map(dependencies.displayRow), columnMap: context.columns.map((_, i) => i) },
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
    const old = context.projection ?? Array.from({ length: context.rowCount }, (_, i) => i);
    const entry: Extract<HistoryCommand, { kind: 'outline' }> = {
      kind: 'outline',
      requests,
      beforeMerges: context.merges,
      afterMerges: nextMerges,
      beforeGroups: context.groups,
      afterGroups: nextGroups,
    };
    context.merges = [...nextMerges];
    context.groups = [...nextGroups];
    recordHistory(context, entry);
    context.future.length = 0;
    notifyOutline(requests[0] && 'range' in requests[0] ? 'merge' : 'group', old, 'api');
  }
  function mergeRange(range: SelectionRange): Readonly<SelectionRange> {
    const parts = dependencies.sourceRanges(range);
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
        !context.merges.some(
          (other) =>
            intersects(span, other) &&
            (!(
              span.startRow <= other.startRow &&
              span.endRow >= other.endRow &&
              span.startColumn <= other.startColumn &&
              span.endColumn >= other.endColumn
            ) ||
              (span.startRow === other.startRow &&
                span.endRow === other.endRow &&
                span.startColumn === other.startColumn &&
                span.endColumn === other.endColumn)),
        ) &&
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
    changeOutline(
      [{ kind: 'merge', range: span }],
      [...context.merges.filter((other) => !intersects(span, other)), span],
      context.groups,
    );
  }
  function unmergeCells(range: SelectionRange): void {
    const parts = dependencies.sourceRanges(range),
      removed = context.merges.filter((span) => parts.some((part) => intersects(part, span)));
    if (!removed.length) return;
    changeOutline(
      removed.map((span) => ({ kind: 'unmerge', range: span })),
      context.merges.filter((span) => !removed.includes(span)),
      context.groups,
    );
  }
  function groupRows(startRow: number, endRow: number): string {
    dependencies.sourceRow(startRow);
    dependencies.sourceRow(endRow);
    if (
      context.projection ||
      context.view.sort ||
      context.view.sorts?.length ||
      context.view.filters?.length ||
      endRow <= startRow
    )
      throw new Error('Group at least two contiguous rows in an expanded, unsorted view.');
    if (
      context.groups.some(
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
      id = 'group-' + ++context.groupId;
    } while (context.groups.some((group) => group.id === id));
    const group = Object.freeze({ id, startRow, endRow, collapsed: false });
    changeOutline([{ kind: 'group', group }], context.merges, [...context.groups, group]);
    return group.id;
  }
  function findGroup(id: string): Readonly<RowGroup> {
    const group = context.groups.find((group) => group.id === id);
    if (!group) throw new Error('Unknown row group.');
    return group;
  }
  function ungroupRows(id: string): void {
    const group = findGroup(id);
    changeOutline(
      [{ kind: 'ungroup', group }],
      context.merges,
      context.groups.filter((other) => other !== group),
    );
  }
  function setGroupCollapsed(id: string, collapsed: boolean): void {
    if (typeof collapsed !== 'boolean') throw new TypeError('Collapsed must be boolean.');
    const group = findGroup(id);
    if (group.collapsed === collapsed) return;
    if (collapsed && context.merges.some((span) => span.endRow > group.startRow && span.startRow <= group.endRow))
      throw new Error('Unmerge cells in these rows before collapsing the group.');
    if (collapsed && group.startRow < context.frozenRows && group.endRow >= context.frozenRows)
      throw new Error('A collapsed group cannot cross a frozen boundary.');
    changeOutline(
      [{ kind: collapsed ? 'collapse' : 'expand', group }],
      context.merges,
      context.groups.map((other) => (other === group ? Object.freeze({ ...group, collapsed }) : other)),
    );
  }
  return {
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
  };
}
