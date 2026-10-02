import type { CellUpdate, RowId } from './data-source.js';
import type { CellSelection, SelectionRange } from './types.js';

export type GridChangeSource = 'api' | 'edit' | 'paste' | 'undo' | 'redo';
export type GridEvent =
  | { readonly type: 'cell:change'; readonly source: GridChangeSource;
      readonly changes: readonly Readonly<CellUpdate & { rowId: RowId; previous: unknown }>[] }
  | { readonly type: 'selection:change'; readonly selection: Readonly<CellSelection> | null; readonly range: Readonly<SelectionRange> | null; readonly ranges: readonly Readonly<SelectionRange>[] }
  | { readonly type: 'column:resize' | 'row:resize'; readonly index: number; readonly previous: number; readonly size: number };
