import type { GridInvalidation } from '../engine.js';
import type { GridEvent } from '../events.js';
import type { CellPermission } from '../permissions.js';
import type { CellSelection, SelectionRange } from '../types.js';
import type { EngineContext } from './engine-context.js';
export function createSelection(
  context: Pick<
    EngineContext,
    | 'merges'
    | 'activeParts'
    | 'retainedRanges'
    | 'selection'
    | 'dataSource'
    | 'columns'
    | 'anchor'
    | 'cachedRanges'
    | 'displayAnchor'
    | 'projection'
    | 'rowCount'
  >,
  dependencies: {
    assertAlive: () => void;
    expandMergedRange: (range: SelectionRange, spans?: readonly Readonly<SelectionRange>[]) => SelectionRange;
    displayRow: (row: number) => number;
    sourceRanges: (range: SelectionRange) => SelectionRange[];
    getCellPermission: (rowIndex: number, columnIndex: number) => CellPermission;
    sourceRow: (index: number) => number;
    mergeAt: (row: number, col: number) => Readonly<SelectionRange> | undefined;
    displaySelection: () => CellSelection | null;
    notify: (change: GridInvalidation, event: GridEvent) => void;
  },
) {
  function selectDisplayRange(range: SelectionRange, mode: 'replace' | 'add' | 'extend' = 'replace'): boolean {
    dependencies.assertAlive();
    if (context.merges.length)
      range = dependencies.expandMergedRange(
        range,
        context.merges.map((span) => ({
          ...span,
          startRow: dependencies.displayRow(span.startRow),
          endRow: dependencies.displayRow(span.endRow),
        })),
      );
    const parts = dependencies.sourceRanges(range);
    if (
      !dependencies.getCellPermission(dependencies.sourceRow(range.startRow), range.startColumn).selectable ||
      !dependencies.getCellPermission(dependencies.sourceRow(range.endRow), range.endColumn).selectable
    )
      return false;
    if (!['replace', 'add', 'extend'].includes(mode)) throw new TypeError('Invalid selection mode.');
    if (mode === 'add' && displaySelectionRanges().length >= 128)
      throw new RangeError('Selection supports at most 128 ranges.');
    const old = getSelectionRanges();
    const keep =
      mode === 'replace' ? [] : mode === 'extend' ? old.slice(0, Math.max(0, old.length - context.activeParts)) : old;
    const row = dependencies.sourceRow(range.startRow);
    const changed = context.selection?.rowIndex !== row || context.selection?.columnIndex !== range.startColumn;
    const others = parts.flatMap((part) =>
      row < part.startRow || row > part.endRow
        ? [part]
        : [
            ...(part.startRow < row ? [{ ...part, endRow: row - 1 }] : []),
            ...(row < part.endRow ? [{ ...part, startRow: row + 1 }] : []),
          ],
    );
    if (keep.length + others.length + 1 > 128) throw new RangeError('Selection supports at most 128 source ranges.');
    context.retainedRanges.splice(0, context.retainedRanges.length, ...keep, ...others);
    context.selection = {
      rowIndex: row,
      rowId: context.dataSource.getRowId(row),
      columnIndex: range.startColumn,
      columnKey: context.columns[range.startColumn]!.key,
    };
    context.anchor = {
      rowIndex: row,
      rowId: context.selection.rowId,
      columnIndex: range.endColumn,
      columnKey: context.columns[range.endColumn]!.key,
    };
    context.activeParts = others.length + 1;
    context.cachedRanges = null;
    context.displayAnchor = { row: range.startRow, col: range.startColumn };
    const rangeChanged = JSON.stringify(old) !== JSON.stringify(getSelectionRanges());
    if (changed || rangeChanged) notifySelection(changed, rangeChanged);
    return changed || rangeChanged;
  }
  function selectDisplay(row: number, col: number, extend = false, add = false): boolean {
    if (!context.projection && context.activeParts === 1) {
      const result = select(row, col, extend, add);
      if (result) context.displayAnchor = { row, col };
      return result;
    }
    const span = dependencies.mergeAt(dependencies.sourceRow(row), col);
    if (span) {
      row = dependencies.displayRow(span.startRow);
      col = span.startColumn;
    }
    const from = extend
      ? (context.displayAnchor ?? {
          row: dependencies.displaySelection()?.rowIndex ?? row,
          col: dependencies.displaySelection()?.columnIndex ?? col,
        })
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
    if (result) context.displayAnchor = from;
    return result;
  }
  function toggleSelection(row: number, col: number): boolean {
    dependencies.assertAlive();
    if (
      !Number.isSafeInteger(row) ||
      row < 0 ||
      row >= (context.projection?.length ?? context.rowCount) ||
      !Number.isSafeInteger(col) ||
      col < 0 ||
      col >= context.columns.length
    )
      throw new RangeError('Invalid cell position.');
    if (!dependencies.getCellPermission(dependencies.sourceRow(row), col).selectable) return false;
    const span = dependencies.mergeAt(dependencies.sourceRow(row), col);
    if (span && !dependencies.getCellPermission(span.startRow, span.startColumn).selectable) return false;
    const beforeSelection = dependencies.displaySelection();
    const source = dependencies.sourceRow(row);
    const cut = span ?? { startRow: source, endRow: source, startColumn: col, endColumn: col };
    // Subtract in source coordinates so filtered-out selections remain attached to their records.
    const old = getSelectionRanges();
    if (
      !old.some(
        (range) =>
          range.startRow <= cut.endRow &&
          range.endRow >= cut.startRow &&
          range.startColumn <= cut.endColumn &&
          range.endColumn >= cut.startColumn,
      )
    )
      return selectDisplay(row, col, false, true);
    const remaining = old.flatMap((range) => {
      const top = Math.max(range.startRow, cut.startRow),
        bottom = Math.min(range.endRow, cut.endRow);
      const left = Math.max(range.startColumn, cut.startColumn),
        right = Math.min(range.endColumn, cut.endColumn);
      if (top > bottom || left > right) return [range];
      return [
        { ...range, endRow: top - 1 },
        { ...range, startRow: bottom + 1 },
        { startRow: top, endRow: bottom, startColumn: range.startColumn, endColumn: left - 1 },
        { startRow: top, endRow: bottom, startColumn: right + 1, endColumn: range.endColumn },
      ].filter((part) => part.startRow <= part.endRow && part.startColumn <= part.endColumn);
    });
    const parts = remaining;
    if (parts.length > 128) throw new RangeError('Selection supports at most 128 source ranges.');
    const active = parts.at(-1);
    if (!active) {
      clearSelection();
      return true;
    }
    context.retainedRanges.splice(0, context.retainedRanges.length, ...parts.slice(0, -1));
    context.selection = {
      rowIndex: active.startRow,
      rowId: context.dataSource.getRowId(active.startRow),
      columnIndex: active.startColumn,
      columnKey: context.columns[active.startColumn]!.key,
    };
    context.anchor = {
      rowIndex: active.endRow,
      rowId: context.dataSource.getRowId(active.endRow),
      columnIndex: active.endColumn,
      columnKey: context.columns[active.endColumn]!.key,
    };
    context.activeParts = 1;
    context.cachedRanges = null;
    const afterSelection = dependencies.displaySelection();
    context.displayAnchor = afterSelection ? { row: afterSelection.rowIndex, col: afterSelection.columnIndex } : null;
    notifySelection(
      beforeSelection?.rowIndex !== afterSelection?.rowIndex ||
        beforeSelection?.columnIndex !== afterSelection?.columnIndex,
      true,
    );
    return true;
  }
  function getSelection(): CellSelection | null {
    return context.selection ? { ...context.selection } : null;
  }
  function getSelectionRange(): SelectionRange | null {
    if (!context.selection || !context.anchor) return null;
    return dependencies.expandMergedRange({
      startRow: Math.min(context.anchor.rowIndex, context.selection.rowIndex),
      endRow: Math.max(context.anchor.rowIndex, context.selection.rowIndex),
      startColumn: Math.min(context.anchor.columnIndex, context.selection.columnIndex),
      endColumn: Math.max(context.anchor.columnIndex, context.selection.columnIndex),
    });
  }
  function getSelectionRanges(): SelectionRange[] {
    const range = getSelectionRange();
    return range ? [...context.retainedRanges.map((range) => ({ ...range })), range] : [];
  }
  function displaySelectionRanges(): SelectionRange[] {
    if (!context.projection && context.activeParts === 1) return getSelectionRanges();
    if (context.cachedRanges) return context.cachedRanges.map((range) => ({ ...range }));
    const grouped = new Map<string, Set<number>>();
    for (const range of getSelectionRanges()) {
      const key = range.startColumn + ':' + range.endColumn;
      const rows = grouped.get(key) ?? new Set<number>();
      grouped.set(key, rows);
      for (let row = range.startRow; row <= range.endRow; row++) {
        const index = dependencies.displayRow(row);
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
    if (context.selection) {
      const row = dependencies.displayRow(context.selection.rowIndex),
        col = context.selection.columnIndex;
      const index = result.findIndex(
        (range) => row >= range.startRow && row <= range.endRow && col >= range.startColumn && col <= range.endColumn,
      );
      if (index >= 0) result.push(...result.splice(index, 1));
    }
    context.cachedRanges = result;
    return result.map((range) => ({ ...range }));
  }
  function select(rowIndex: number, columnIndex: number, extend = false, add = false): boolean {
    dependencies.assertAlive();
    if (
      !Number.isSafeInteger(rowIndex) ||
      rowIndex < 0 ||
      rowIndex >= context.rowCount ||
      !Number.isSafeInteger(columnIndex) ||
      columnIndex < 0 ||
      columnIndex >= context.columns.length
    )
      throw new RangeError('Invalid cell position.');
    if (!dependencies.getCellPermission(rowIndex, columnIndex).selectable) return false;
    const span = dependencies.mergeAt(rowIndex, columnIndex);
    if (span) {
      rowIndex = span.startRow;
      columnIndex = span.startColumn;
      if (!dependencies.getCellPermission(rowIndex, columnIndex).selectable) return false;
    }
    if (add && extend) throw new Error('Adding and extending a selection are separate operations.');
    if (add && context.selection && context.retainedRanges.length >= 127)
      throw new RangeError('Selection supports at most 128 ranges.');
    const nextSelection = {
      rowIndex,
      rowId: context.dataSource.getRowId(rowIndex),
      columnIndex,
      columnKey: context.columns[columnIndex]!.key,
    };
    const previousRanges = JSON.stringify(getSelectionRanges());
    const previous = getSelectionRange();
    if (add && previous) context.retainedRanges.push(previous);
    else if (!extend) context.retainedRanges.length = 0;
    const changed = context.selection?.rowIndex !== rowIndex || context.selection?.columnIndex !== columnIndex;
    const previousRange = JSON.stringify(getSelectionRange());
    context.selection = nextSelection;
    if (!extend || !context.anchor) context.anchor = { ...context.selection };
    const rangeChanged = previousRange !== JSON.stringify(getSelectionRange());
    const rangesChanged = previousRanges !== JSON.stringify(getSelectionRanges());
    if (changed || rangeChanged || rangesChanged) notifySelection(changed, rangeChanged || rangesChanged);
    return changed || rangeChanged || rangesChanged;
  }
  function selectRange(range: SelectionRange, mode: 'replace' | 'add' | 'extend' = 'replace'): boolean {
    dependencies.assertAlive();
    range = dependencies.expandMergedRange(range);
    const { startRow, endRow, startColumn, endColumn } = range;
    for (const [value, limit] of [
      [startRow, context.rowCount],
      [endRow, context.rowCount],
      [startColumn, context.columns.length],
      [endColumn, context.columns.length],
    ]) {
      if (!Number.isSafeInteger(value) || value! < 0 || value! >= limit!)
        throw new RangeError('Invalid selection range.');
    }
    if (startRow > endRow || startColumn > endColumn) throw new RangeError('Invalid selection range order.');
    if (
      !dependencies.getCellPermission(startRow, startColumn).selectable ||
      !dependencies.getCellPermission(endRow, endColumn).selectable
    )
      return false;
    if (mode !== 'replace' && mode !== 'add' && mode !== 'extend') throw new TypeError('Invalid selection mode.');
    if (mode === 'add' && context.selection && context.retainedRanges.length >= 127)
      throw new RangeError('Selection supports at most 128 ranges.');
    const previous = JSON.stringify(getSelectionRanges());
    const previousRange = getSelectionRange();
    if (mode === 'add' && previousRange) context.retainedRanges.push(previousRange);
    else if (mode === 'replace') context.retainedRanges.length = 0;
    const changed = context.selection?.rowIndex !== startRow || context.selection?.columnIndex !== startColumn;
    context.selection = {
      rowIndex: startRow,
      rowId: context.dataSource.getRowId(startRow),
      columnIndex: startColumn,
      columnKey: context.columns[startColumn]!.key,
    };
    context.anchor = {
      rowIndex: endRow,
      rowId: context.dataSource.getRowId(endRow),
      columnIndex: endColumn,
      columnKey: context.columns[endColumn]!.key,
    };
    const rangeChanged = previous !== JSON.stringify(getSelectionRanges());
    if (changed || rangeChanged) notifySelection(changed, rangeChanged);
    return changed || rangeChanged;
  }
  function notifySelection(changed: boolean, rangeChanged: boolean): void {
    context.cachedRanges = null;
    const endpoint = dependencies.displaySelection();
    const range = displaySelectionRanges().at(-1) ?? null;
    dependencies.notify(
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
    dependencies.assertAlive();
    if (!context.selection) return;
    context.selection = context.anchor = null;
    context.activeParts = 1;
    context.displayAnchor = null;
    context.cachedRanges = null;
    context.retainedRanges.length = 0;
    notifySelection(true, true);
  }
  return {
    selectDisplayRange,
    selectDisplay,
    toggleSelection,
    getSelection,
    getSelectionRange,
    getSelectionRanges,
    displaySelectionRanges,
    select,
    selectRange,
    notifySelection,
    clearSelection,
  };
}
