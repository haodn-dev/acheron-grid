import type { Column } from './types.js';
export interface StructureRequest {
  readonly columns?: readonly Column[];
  readonly order?: readonly number[];
  readonly axis: 'row' | 'column';
  readonly kind: 'insert' | 'delete' | 'move';
  readonly indices: readonly number[];
  readonly beforeIndex: number;
  readonly count: number;
}
export function reorderedIndices(count: number, indices: readonly number[], beforeIndex: number): number[] {
  if (
    !Number.isSafeInteger(count) ||
    count < 0 ||
    !Number.isSafeInteger(beforeIndex) ||
    beforeIndex < 0 ||
    beforeIndex > count ||
    !indices.length ||
    new Set(indices).size !== indices.length ||
    [...indices].some((index) => !Number.isSafeInteger(index) || index < 0 || index >= count)
  )
    throw new RangeError('Invalid reorder coordinates.');
  const moved = new Set(indices),
    selected = [...indices].sort((a, b) => a - b);
  const remaining = Array.from({ length: count }, (_, i) => i).filter((i) => !moved.has(i));
  const insertion = beforeIndex - selected.filter((i) => i < beforeIndex).length;
  return remaining.slice(0, insertion).concat(selected, remaining.slice(insertion));
}
