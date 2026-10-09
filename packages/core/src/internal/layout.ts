import { GridAxis } from '../axis.js';
import type { GridInvalidation } from '../engine.js';
import type { GridEvent } from '../events.js';
import type { ViewportOptions } from '../panes.js';
import { createViewport } from '../panes.js';
import type { SelectionRange } from '../types.js';
import type { EngineContext } from './engine-context.js';
import { recordHistory } from './history-budget.js';
export function createLayout(
  context: Pick<
    EngineContext,
    | 'columnAxis'
    | 'frozenColumns'
    | 'manualRows'
    | 'rowAxis'
    | 'past'
    | 'future'
    | 'tableLocked'
    | 'options'
    | 'pendingCut'
    | 'rowCount'
    | 'columns'
    | 'frozenRows'
    | 'merges'
    | 'groups'
  >,
  dependencies: {
    viewAxis: () => GridAxis;
    visibleFrozenRows: () => number;
    mergeAt: (row: number, col: number) => Readonly<SelectionRange> | undefined;
    sourceRow: (index: number) => number;
    displayRow: (row: number) => number;
    assertAlive: () => void;
    notify: (change: GridInvalidation, event: GridEvent) => void;
    rebuildViewAxis: () => void;
    clearSelection: () => void;
    validateMergeFreeze: (spans: readonly Readonly<SelectionRange>[], rows?: number, cols?: number) => void;
  },
) {
  function mergedViewport(options: ViewportOptions) {
    const axis = dependencies.viewAxis(),
      viewport = createViewport(
        axis,
        context.columnAxis,
        dependencies.visibleFrozenRows(),
        context.frozenColumns,
        options,
      );
    return Object.freeze({
      ...viewport,
      hitTest(x: number, y: number) {
        const hit = viewport.hitTest(x, y);
        if (!hit) return null;
        const span = dependencies.mergeAt(dependencies.sourceRow(hit.row), hit.col);
        return span ? { row: dependencies.displayRow(span.startRow), col: span.startColumn } : hit;
      },
      cellRect(row: number, col: number) {
        const base = viewport.cellRect(row, col),
          span = dependencies.mergeAt(dependencies.sourceRow(row), col);
        if (!span) return base;
        const first = dependencies.displayRow(span.startRow),
          last = dependencies.displayRow(span.endRow),
          rect = viewport.cellRect(first, span.startColumn);
        return Object.freeze({
          ...rect,
          width: context.columnAxis.position(span.endColumn + 1) - context.columnAxis.position(span.startColumn),
          height: axis.position(last + 1) - axis.position(first),
        });
      },
    });
  }
  function resize(axis: GridAxis, index: number, size: number, history = true): void {
    dependencies.assertAlive();
    if (!history && context.manualRows.has(index)) return;
    const previous = axis.storedSize(index),
      previousManual = axis === context.rowAxis && context.manualRows.has(index);
    axis.setSize(index, size);
    if (previous !== size && history) {
      if (axis === context.rowAxis) context.manualRows.add(index);
      recordHistory(context, {
        kind: 'resize',
        axis: axis === context.rowAxis ? 'row' : 'column',
        index,
        previous,
        size,
        previousManual,
      });
      context.future.length = 0;
    }
    if (previous !== size)
      dependencies.notify(
        { type: 'layout' },
        Object.freeze({ type: axis === context.rowAxis ? 'row:resize' : 'column:resize', index, previous, size }),
      );
  }
  function requireVisibilityPolicy(axis: 'row' | 'column', indices: readonly number[], hidden: boolean): void {
    if (
      context.tableLocked ||
      context.options.canChangeVisibility?.(Object.freeze({ axis, indices: Object.freeze([...indices]), hidden })) ===
        false
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
    dependencies.assertAlive();
    const layout = axis === 'row' ? context.rowAxis : context.columnAxis;
    if (
      typeof hidden !== 'boolean' ||
      !Array.isArray(indices) ||
      new Set(indices).size !== indices.length ||
      [...indices].some((index) => !Number.isSafeInteger(index) || index < 0 || index >= layout.count)
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
    dependencies.rebuildViewAxis();
    dependencies.clearSelection();
    context.pendingCut = undefined;
    if (history) {
      recordHistory(context, { kind: 'visibility', axis, indices: Object.freeze(changed), hidden });
      context.future.length = 0;
    }
    dependencies.notify(
      { type: 'layout' },
      Object.freeze({ type: 'visibility:change', axis, indices: Object.freeze(changed), hidden, source }),
    );
  }
  function setFrozen(rows: number, columnCount: number): void {
    dependencies.assertAlive();
    if (
      !Number.isSafeInteger(rows) ||
      rows < 0 ||
      rows > context.rowCount ||
      !Number.isSafeInteger(columnCount) ||
      columnCount < 0 ||
      columnCount > context.columns.length
    )
      throw new RangeError('Invalid frozen row or column count.');
    if (rows === context.frozenRows && columnCount === context.frozenColumns) return;
    dependencies.validateMergeFreeze(context.merges, rows, columnCount);
    if (context.groups.some((group) => group.collapsed && group.startRow < rows && group.endRow >= rows))
      throw new Error('A collapsed group cannot cross a frozen boundary.');
    const previousRows = context.frozenRows;
    const previousColumns = context.frozenColumns;
    context.frozenRows = rows;
    context.frozenColumns = columnCount;
    recordHistory(context, { kind: 'freeze', previousRows, previousColumns, rows, columns: columnCount });
    context.future.length = 0;
    dependencies.notify(
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
  return { mergedViewport, resize, requireVisibilityPolicy, changeVisibility, setFrozen, axisView };
}
