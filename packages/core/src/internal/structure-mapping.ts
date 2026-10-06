import type { SelectionRange } from '../types.js';
import type { DataRow, RowSplice } from '../data-source.js';
export function mappedIntervals(start: number, end: number, mapping: readonly number[]): [number, number][] {
  const sorted = mapping
      .slice(start, end + 1)
      .filter((i) => i >= 0)
      .sort((a, b) => a - b),
    result: [number, number][] = [];
  for (const index of sorted) {
    const last = result.at(-1);
    if (last && index === last[1] + 1) last[1] = index;
    else result.push([index, index]);
  }
  return result;
}
export function mappedRanges(
  range: SelectionRange,
  rows: readonly number[],
  cols: readonly number[],
): SelectionRange[] {
  return mappedIntervals(range.startRow, range.endRow, rows).flatMap(([startRow, endRow]) =>
    mappedIntervals(range.startColumn, range.endColumn, cols).map(([startColumn, endColumn]) => ({
      startRow,
      endRow,
      startColumn,
      endColumn,
    })),
  );
}
export function inverseMap(map: readonly number[], count: number): number[] {
  const result = Array<number>(count).fill(-1);
  map.forEach((next, old) => {
    if (next >= 0) result[next] = old;
  });
  return result;
}
export function rowBlocks(indices: readonly number[], rows: readonly DataRow[]): RowSplice[] {
  const blocks: RowSplice[] = [];
  let start = 0;
  while (start < indices.length) {
    let end = start + 1;
    while (end < indices.length && indices[end] === indices[end - 1]! + 1) end++;
    blocks.push({ index: indices[start]!, deleteCount: end - start, rows: rows.slice(start, end) });
    start = end;
  }
  return blocks;
}
