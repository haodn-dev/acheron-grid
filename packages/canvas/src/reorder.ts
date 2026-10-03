export interface ReorderRequest {
  readonly axis: 'row' | 'column';
  readonly indices: readonly number[];
  /** Insertion boundary in the current order, before removing the moved items. */
  readonly beforeIndex: number;
}
export { reorderedIndices } from '@acheron-grid/core';

export type RowChangeRequest =
  | { readonly kind: 'insert'; readonly beforeIndex: number; readonly count: number }
  | { readonly kind: 'delete'; readonly indices: readonly number[] };
