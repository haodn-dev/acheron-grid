import { LocalDataView } from '../data-source.js';
import type { DataSource, LocalViewOptions } from '../data-source.js';
import type { BulkSteps } from './bulk.js';

export function* localViewSteps(
  source: DataSource,
  criteria: LocalViewOptions,
  cooperative: boolean,
): BulkSteps<number[]> {
  if (!cooperative) {
    const local = new LocalDataView(source, criteria);
    return Array.from({ length: local.getRowCount() }, (_, index) => local.getSourceIndex(index));
  }
  const count = source.getRowCount();
  if (!Number.isSafeInteger(count) || count < 0) throw new RangeError('Invalid local row count.');
  const filters = criteria.filters ?? [];
  const sorts = criteria.sorts ?? (criteria.sort ? [criteria.sort] : []);
  const queries = filters.map((filter) => filter.query.toLocaleLowerCase());
  const matched: number[] = [];
  for (let index = 0; index < count; index++) {
    if (
      filters.every((filter, position) => {
        const value = source.getValue(index, filter.columnKey);
        const empty = value == null || value === '';
        if (filter.operator === 'empty') return empty;
        if (filter.operator === 'not-empty') return !empty;
        if (filter.query === '') return true;
        if (empty) return false;
        const text = String(value).toLocaleLowerCase();
        return filter.operator === 'equals' ? text === queries[position] : text.includes(queries[position]!);
      })
    )
      matched.push(index);
    if ((index + 1) % 256 === 0) yield { phase: 'prepare', completed: index + 1, total: count };
  }
  if (!sorts.length) return matched;
  const values: unknown[][] = [];
  for (const sort of sorts) {
    const column: unknown[] = [];
    for (const index of matched) {
      column.push(source.getValue(index, sort.columnKey));
      if (column.length % 256 === 0) yield { phase: 'prepare', completed: column.length, total: matched.length };
    }
    values.push(column);
  }
  const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  function compare(a: number, b: number): number {
    for (let index = 0; index < sorts.length; index++) {
      const left = values[index]![a],
        right = values[index]![b];
      if (left == null || right == null) {
        if (left == null && right == null) continue;
        return left == null ? 1 : -1;
      }
      const order =
        typeof left === 'number' && typeof right === 'number'
          ? left - right
          : collator.compare(String(left), String(right));
      if (order) return sorts[index]!.direction === 'asc' ? order : -order;
    }
    return matched[a]! - matched[b]!;
  }
  let positions = Array.from({ length: matched.length }, (_, index) => index);
  let output = new Array<number>(positions.length);
  let work = 0;
  const total = positions.length * Math.ceil(Math.log2(Math.max(1, positions.length)));
  for (let width = 1; width < positions.length; width *= 2) {
    for (let start = 0; start < positions.length; start += width * 2) {
      const middle = Math.min(start + width, positions.length),
        end = Math.min(start + width * 2, positions.length);
      let left = start,
        right = middle;
      for (let target = start; target < end; target++) {
        output[target] =
          right >= end || (left < middle && compare(positions[left]!, positions[right]!) <= 0)
            ? positions[left++]!
            : positions[right++]!;
        if (++work % 1024 === 0) yield { phase: 'sort', completed: work, total };
      }
    }
    [positions, output] = [output, positions];
  }
  return positions.map((position) => matched[position]!);
}
