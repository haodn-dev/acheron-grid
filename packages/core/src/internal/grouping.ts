import type { DataSource, RowId } from '../data-source.js';
import type { BulkSteps } from './bulk.js';

export type GroupKey = string | number | boolean | null;
export interface GroupDisplayRow extends LocalGroup {
  readonly kind: 'group';
  readonly expanded: boolean;
}
export type DisplayRow = number | GroupDisplayRow;
export interface LocalGroupingOptions {
  readonly columnKey: string;
  readonly sumColumns?: readonly string[];
}
export interface GroupingState {
  readonly version: 1;
  readonly grouping: Readonly<LocalGroupingOptions> | null;
  readonly collapsedKeys: readonly GroupKey[];
}
export interface LocalGroup {
  readonly key: GroupKey;
  readonly sourceIndices: readonly number[];
  readonly count: number;
  readonly sums: Readonly<Record<string, number>>;
}

/** Groups an ordered retained working set; it neither filters nor mutates the source. */
export function* groupLocalRowsSteps(
  source: DataSource,
  columnKeys: readonly string[],
  sourceIndices: readonly number[],
  options: LocalGroupingOptions,
): BulkSteps<readonly LocalGroup[]> {
  const count = source.getRowCount();
  if (!Number.isSafeInteger(count) || count < 0) throw new RangeError('Invalid grouping source count.');
  if (
    !Array.isArray(columnKeys) ||
    Array.from(columnKeys).some((key) => typeof key !== 'string' || !key) ||
    new Set(columnKeys).size !== columnKeys.length ||
    !Array.isArray(sourceIndices) ||
    !options ||
    typeof options !== 'object' ||
    Array.isArray(options) ||
    typeof options.columnKey !== 'string' ||
    !columnKeys.includes(options.columnKey) ||
    (options.sumColumns !== undefined && !Array.isArray(options.sumColumns))
  )
    throw new TypeError('Invalid grouping criteria.');
  const columnKey = options.columnKey,
    sumColumns = Array.from(options.sumColumns ?? []),
    indices = Array.from(sourceIndices);
  if (
    sumColumns.some((key) => typeof key !== 'string' || !columnKeys.includes(key)) ||
    new Set(sumColumns).size !== sumColumns.length
  )
    throw new TypeError('Invalid grouping sum columns.');

  const seenIndices = new Set<number>(),
    seenIds = new Set<RowId>();
  const groups = new Map<GroupKey, { key: GroupKey; sourceIndices: number[]; sums: Record<string, number> }>();
  for (const [position, index] of indices.entries()) {
    if (!Number.isSafeInteger(index) || index < 0 || index >= count || seenIndices.has(index))
      throw new RangeError('Invalid or duplicate grouping source index.');
    seenIndices.add(index);
    const id = source.getRowId(index);
    if ((typeof id !== 'string' && (typeof id !== 'number' || !Number.isFinite(id))) || seenIds.has(id))
      throw new TypeError('Invalid or duplicate grouping row ID.');
    seenIds.add(id);
    const rawKey = source.getValue(index, columnKey);
    if (
      rawKey != null &&
      typeof rawKey !== 'string' &&
      typeof rawKey !== 'boolean' &&
      (typeof rawKey !== 'number' || !Number.isFinite(rawKey))
    )
      throw new TypeError('Grouping keys must be scalar finite values or missing.');
    const key = rawKey == null ? null : rawKey === 0 ? 0 : rawKey;
    let group = groups.get(key);
    if (!group) {
      group = { key, sourceIndices: [], sums: Object.fromEntries(sumColumns.map((column) => [column, 0])) };
      groups.set(key, group);
    }
    group.sourceIndices.push(index);
    for (const column of sumColumns) {
      const value = column === columnKey ? rawKey : source.getValue(index, column);
      if (typeof value !== 'number') continue;
      const sum = group.sums[column]! + value;
      if (!Number.isFinite(value) || !Number.isFinite(sum)) throw new RangeError('Nonfinite grouping sum.');
      group.sums[column] = sum;
    }
    if ((position + 1) % 256 === 0) yield { phase: 'prepare', completed: position + 1, total: indices.length };
  }
  const result: LocalGroup[] = [];
  for (const group of groups.values()) {
    result.push(
      Object.freeze({
        key: group.key,
        sourceIndices: Object.freeze(group.sourceIndices),
        count: group.sourceIndices.length,
        sums: Object.freeze(group.sums),
      }),
    );
    if (result.length % 256 === 0) yield { phase: 'validate', completed: result.length, total: groups.size };
  }
  if (source.getRowCount() !== count) throw new Error('Grouping source count changed.');
  // The final yield lets the shared runner recheck cancellation/revision after the last source read.
  yield { phase: 'validate', completed: result.length, total: result.length };
  return Object.freeze(result);
}
