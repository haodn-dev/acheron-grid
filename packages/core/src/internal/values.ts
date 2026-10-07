import type { CellUpdate } from '../data-source.js';
import type { GridInvalidation } from '../engine.js';
import type { GridChangeSource, GridEvent } from '../events.js';
import type { CellPermission } from '../permissions.js';
import { clipboardCellLimit, clipboardTextLimit } from '../tsv.js';
import type { SelectionRange } from '../types.js';
import type { Change, EngineContext, FormatChange } from './engine-context.js';
import { drain } from './bulk.js';
import type { BulkSteps } from './bulk.js';
import { assertHistoryCapacity, recordHistory } from './history-budget.js';
export function createValues(
  context: Pick<
    EngineContext,
    'dataSource' | 'rowCount' | 'columnIndices' | 'columns' | 'past' | 'future' | 'destroyed'
  >,
  dependencies: {
    notify: (change: GridInvalidation, event: GridEvent) => void;
    assertAlive: () => void;
    requirePermission: (rowIndex: number, columnIndex: number, key: keyof CellPermission) => void;
    writeFormats: (changes: readonly FormatChange[]) => void;
    notifyFormats: (changes: readonly FormatChange[], source: 'api' | 'paste' | 'undo' | 'redo') => void;
    mergeAt: (row: number, col: number) => Readonly<SelectionRange> | undefined;
    getCellPermission: (rowIndex: number, columnIndex: number) => CellPermission;
    displaySelectionRanges: () => SelectionRange[];
    visibleRowCount: () => number;
    sourceRow: (index: number) => number;
  },
) {
  function notifyCells(changes: readonly Change[], source: GridChangeSource): void {
    dependencies.notify(
      { type: 'cells', cells: changes.map(({ rowIndex, columnKey }) => ({ rowIndex, columnKey })) },
      Object.freeze({
        type: 'cell:change',
        source,
        changes: Object.freeze(changes.map((change) => Object.freeze({ ...change }))),
      }),
    );
  }
  function write(changes: readonly CellUpdate[]): void {
    if (changes.length === 1 && context.dataSource.setValue) {
      const change = changes[0]!;
      context.dataSource.setValue(change.rowIndex, change.columnKey, change.value);
    } else if (context.dataSource.setValues) context.dataSource.setValues(changes);
    else throw new Error('An atomic setValues method is required for batch writes.');
  }
  function* applyUpdatesSteps(
    updates: readonly CellUpdate[],
    source: GridChangeSource = 'api',
    formatChanges: FormatChange[] = [],
    cooperative = false,
    finalCheck?: () => void,
  ): BulkSteps<void> {
    dependencies.assertAlive();
    const unique = new Map<string | number, CellUpdate>();
    let completed = 0;
    for (const update of updates) {
      if (!Number.isSafeInteger(update.rowIndex) || update.rowIndex < 0 || update.rowIndex >= context.rowCount)
        throw new RangeError('Invalid row index.');
      if (!context.columnIndices.has(update.columnKey)) throw new Error(`Unknown column: ${update.columnKey}`);
      const rowIndex = update.rowIndex,
        columnKey = update.columnKey;
      const coordinate = rowIndex * context.columns.length + context.columnIndices.get(columnKey)!;
      // Numeric coordinates avoid string allocations; oversized layouts retain collision-free string keys.
      unique.set(Number.isSafeInteger(coordinate) ? coordinate : `${rowIndex}:${columnKey}`, { ...update });
      if (cooperative && ++completed % 256 === 0) yield { phase: 'prepare', completed, total: updates.length };
    }
    const changes: Change[] = [];
    completed = 0;
    for (const update of unique.values()) {
      const change = {
        ...update,
        previous: context.dataSource.getValue(update.rowIndex, update.columnKey),
        rowId: context.dataSource.getRowId(update.rowIndex),
      };
      if (!Object.is(change.previous, change.value)) changes.push(change);
      if (cooperative && ++completed % 256 === 0) yield { phase: 'prepare', completed, total: unique.size };
    }
    if (!changes.length && !formatChanges.length) return;
    for (const change of changes)
      dependencies.requirePermission(change.rowIndex, context.columnIndices.get(change.columnKey)!, 'writable');
    completed = 0;
    for (const change of changes) {
      const column = context.columns[context.columnIndices.get(change.columnKey)!]!;
      const message = column.validate?.(change.value);
      if (message && column.invalidInput !== 'allow') throw new Error(message);
      if (cooperative && ++completed % 256 === 0) yield { phase: 'validate', completed, total: changes.length };
    }
    // Recheck identity, values and authority after preparation may have yielded to the host.
    if (cooperative)
      for (const change of changes) {
        if (
          context.dataSource.getRowId(change.rowIndex) !== change.rowId ||
          !Object.is(context.dataSource.getValue(change.rowIndex, change.columnKey), change.previous)
        )
          throw new Error('Bulk values conflict with external data changes.');
        dependencies.requirePermission(change.rowIndex, context.columnIndices.get(change.columnKey)!, 'writable');
      }
    finalCheck?.();
    const entry = { kind: 'values' as const, changes, formats: formatChanges };
    assertHistoryCapacity(context, entry);
    if (changes.length) write(changes);
    dependencies.writeFormats(formatChanges);
    recordHistory(context, entry);
    context.future.length = 0;
    if (changes.length) notifyCells(changes, source);
    if (formatChanges.length) dependencies.notifyFormats(formatChanges, source === 'paste' ? 'paste' : 'api');
  }
  function applyUpdates(
    updates: readonly CellUpdate[],
    source: GridChangeSource = 'api',
    formats: FormatChange[] = [],
  ): void {
    drain(applyUpdatesSteps(updates, source, formats));
  }
  function canEdit(rowIndex: number, columnIndex: number): boolean {
    const span = dependencies.mergeAt(rowIndex, columnIndex);
    if (span) {
      rowIndex = span.startRow;
      columnIndex = span.startColumn;
      for (let row = span.startRow; row <= span.endRow; row++)
        for (let col = span.startColumn; col <= span.endColumn; col++)
          if (!dependencies.getCellPermission(row, col).writable) return false;
    }
    const column = context.columns[columnIndex];
    if (
      context.destroyed ||
      !Number.isSafeInteger(rowIndex) ||
      !Number.isSafeInteger(columnIndex) ||
      !(context.dataSource.setValue || context.dataSource.setValues) ||
      !column ||
      rowIndex < 0 ||
      rowIndex >= context.rowCount
    )
      return false;
    if (!dependencies.getCellPermission(rowIndex, columnIndex).editable) return false;
    const value = context.dataSource.getValue(rowIndex, column.key);
    return column.parse !== undefined || value == null || typeof value === 'string';
  }
  function editCell(rowIndex: number, columnIndex: number, text: string): void {
    dependencies.assertAlive();
    const span = dependencies.mergeAt(rowIndex, columnIndex);
    if (span) {
      rowIndex = span.startRow;
      columnIndex = span.startColumn;
    }
    if (!canEdit(rowIndex, columnIndex)) throw new Error('Cell cannot be edited.');
    const column = context.columns[columnIndex]!;
    const previous = context.dataSource.getValue(rowIndex, column.key);
    if (text !== (previous == null ? '' : String(previous))) {
      applyUpdates([{ rowIndex, columnKey: column.key, value: column.parse ? column.parse(text) : text }], 'edit');
    }
  }
  function replaceText(
    search: string,
    replacement: string,
    options: { readonly scope?: 'view' | 'selection'; readonly caseSensitive?: boolean } = {},
  ) {
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
        ? dependencies.displaySelectionRanges()
        : dependencies.visibleRowCount() && context.columns.length
          ? [
              {
                startRow: 0,
                endRow: dependencies.visibleRowCount() - 1,
                startColumn: 0,
                endColumn: context.columns.length - 1,
              },
            ]
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
          const canonical = dependencies.sourceRow(row),
            column = context.columns[col]!,
            key = JSON.stringify([canonical, column.key]);
          if (seen.has(key)) continue;
          seen.add(key);
          const previous = context.dataSource.getValue(canonical, column.key);
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
          dependencies.requirePermission(canonical, col, 'editable');
          updates.push({ rowIndex: canonical, columnKey: column.key, value });
        }
    applyUpdates(updates);
    return Object.freeze({ changedCells: updates.length, matches });
  }
  return { notifyCells, write, applyUpdates, applyUpdatesSteps, canEdit, editCell, replaceText };
}
