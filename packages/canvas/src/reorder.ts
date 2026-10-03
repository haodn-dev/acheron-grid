export interface ReorderRequest {
  readonly axis: 'row' | 'column';
  readonly indices: readonly number[];
  /** Insertion boundary in the current order, before removing the moved items. */
  readonly beforeIndex: number;
}
export function reorderedIndices(count: number, indices: readonly number[], beforeIndex: number): number[] {
  if (!Number.isInteger(count) || count < 0 || !Number.isInteger(beforeIndex) || beforeIndex < 0 || beforeIndex > count || !indices.length || new Set(indices).size !== indices.length || indices.some(index => !Number.isInteger(index) || index < 0 || index >= count)) throw new RangeError('Invalid reorder coordinates.');
  const moved = new Set(indices); const order = Array.from({ length: count }, (_, index) => index).filter(index => !moved.has(index));
  const insertion = beforeIndex - indices.filter(index => index < beforeIndex).length;
  order.splice(insertion, 0, ...[...indices].sort((a, b) => a - b)); return order;
}

export type RowChangeRequest =
  | { readonly kind: 'insert'; readonly beforeIndex: number; readonly count: number }
  | { readonly kind: 'delete'; readonly indices: readonly number[] };
