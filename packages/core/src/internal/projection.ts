import { GridAxis } from '../axis.js';
import type { LocalViewOptions } from '../data-source.js';
import { LocalDataView, snapshotLocalView as snapshotView } from '../data-source.js';
import type { GridInvalidation } from '../engine.js';
import type { GridEvent } from '../events.js';
import type { CellFormatTarget, CellLockTarget, CellSelection, RowGroup, SelectionRange } from '../types.js';
import type { EngineContext } from './engine-context.js';
export function createProjection(
  context: Pick<
    EngineContext,
    | 'projectedAxis'
    | 'rowAxis'
    | 'projection'
    | 'groups'
    | 'frozenRows'
    | 'cachedFrozenRows'
    | 'rowHeight'
    | 'reverseProjection'
    | 'columnIndices'
    | 'dataSource'
    | 'rowCount'
    | 'merges'
    | 'cachedRanges'
    | 'selection'
    | 'columns'
    | 'view'
    | 'displayAnchor'
  >,
  dependencies: {
    displaySelectionRanges: () => SelectionRange[];
    assertAlive: () => void;
    notify: (change: GridInvalidation, event: GridEvent) => void;
  },
) {
  function viewAxis(): GridAxis {
    return context.projectedAxis ?? context.rowAxis;
  }
  function visibleFrozenRows(): number {
    if (!context.projection || !context.groups.some((group) => group.collapsed))
      return Math.min(context.frozenRows, visibleRowCount());
    return (context.cachedFrozenRows ??= context.projection.reduce(
      (count, row) => count + (row < context.frozenRows ? 1 : 0),
      0,
    ));
  }
  function rebuildViewAxis(): void {
    if (!context.projection) {
      context.projectedAxis = null;
      return;
    }
    const axis = new GridAxis(context.projection.length, context.rowHeight);
    axis.replace(
      context.projection.length,
      context.rowAxis.snapshot().flatMap(([row, size]) => {
        const index = context.reverseProjection.get(row);
        return index === undefined ? [] : [[index, size] as const];
      }),
    );
    context.projectedAxis = axis;
    axis.replaceHidden(
      context.rowAxis.hiddenIndices().flatMap((row) => {
        const index = context.reverseProjection.get(row);
        return index === undefined ? [] : [index];
      }),
    );
  }
  function buildProjection(
    next: LocalViewOptions,
    count = context.rowCount,
    spans: readonly Readonly<SelectionRange>[] = context.merges,
    outlines: readonly Readonly<RowGroup>[] = context.groups,
    frozen = context.frozenRows,
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
      if (key !== undefined && !context.columnIndices.has(key)) throw new Error('Unknown view column: ' + key);
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
      const matches = new LocalDataView(context.dataSource, { ...(next.filters ? { filters: next.filters } : {}) }),
        matching = new Set(Array.from({ length: matches.getRowCount() }, (_, i) => matches.getSourceIndex(i)));
      const blocks: { start: number; end: number }[] = [];
      let intervalIndex = 0;
      for (let row = 0; row < count;) {
        const interval = combined[intervalIndex];
        const end = interval?.[0] === row ? interval[1] : row;
        if (interval?.[0] === row) intervalIndex++;
        for (let member = row; member <= end; member++)
          if (matching.has(member)) {
            blocks.push({ start: row, end });
            break;
          }
        row = end + 1;
      }
      const pinned = blocks.filter((block) => block.start < frozen),
        movable = blocks.filter((block) => block.start >= frozen);
      const ordered = new LocalDataView(
        {
          getRowCount: () => movable.length,
          getRowId: (i) => i,
          getValue: (i, key) => context.dataSource.getValue(movable[i]!.start, key),
        },
        { ...(next.sort ? { sort: next.sort } : {}), ...(next.sorts ? { sorts: next.sorts } : {}) },
      );
      const hidden = outlines.filter((group) => group.collapsed);
      const result: number[] = [];
      for (let index = 0; index < pinned.length + ordered.getRowCount(); index++) {
        const block = index < pinned.length ? pinned[index]! : movable[ordered.getSourceIndex(index - pinned.length)]!;
        for (let row = block.start; row <= block.end; row++)
          if (!hidden.some((group) => row > group.startRow && row <= group.endRow)) result.push(row);
      }
      return result;
    }
    const local = new LocalDataView(context.dataSource, next);
    return next.sort || next.sorts?.length || next.filters?.length
      ? Array.from({ length: local.getRowCount() }, (_, i) => local.getSourceIndex(i))
      : null;
  }
  function installProjection(next: number[] | null): void {
    context.projection = next;
    context.reverseProjection = new Map(next?.map((row, index) => [row, index]) ?? []);
    context.cachedRanges = null;
    context.cachedFrozenRows = null;
    rebuildViewAxis();
  }
  function displayRow(row: number): number {
    return context.projection ? (context.reverseProjection.get(row) ?? -1) : row;
  }
  function displaySelection(): CellSelection | null {
    if (!context.selection) return null;
    const rowIndex = displayRow(context.selection.rowIndex);
    if (rowIndex >= 0) return { ...context.selection, rowIndex };
    const range = dependencies.displaySelectionRanges().at(-1);
    return range
      ? {
          rowIndex: range.startRow,
          rowId: context.dataSource.getRowId(sourceRow(range.startRow)),
          columnIndex: range.startColumn,
          columnKey: context.columns[range.startColumn]!.key,
        }
      : null;
  }
  function setView(next: LocalViewOptions): void {
    dependencies.assertAlive();
    const snapshot = snapshotView(next);
    const nextProjection = buildProjection(snapshot);
    const old = context.projection ?? Array.from({ length: context.rowCount }, (_, i) => i);
    context.view = snapshot;
    installProjection(nextProjection);
    context.displayAnchor = null;
    dependencies.notify(
      { type: 'structure', rowMap: old.map(displayRow), columnMap: context.columns.map((_, i) => i) },
      Object.freeze({
        type: 'view:change',
        view: context.view,
        rowCount: visibleRowCount(),
        sourceRowCount: context.rowCount,
      }),
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
      range.endColumn >= context.columns.length
    )
      throw new RangeError('Invalid selection range.');
    if (!context.projection) return [{ ...range }];
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
  function sourceRow(index: number): number {
    if (!Number.isSafeInteger(index) || index < 0 || index >= visibleRowCount())
      throw new RangeError('Invalid row index in view.');
    return context.projection ? context.projection[index]! : index;
  }
  function visibleRowCount(): number {
    return context.projection?.length ?? context.rowCount;
  }
  return {
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
  };
}
