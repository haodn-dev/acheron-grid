import type { LocalViewOptions } from './data-source.js';
import type { StructureRequest } from './structure.js';
import type { CellUpdate, RowId } from './data-source.js';
import type { CellSelection, SelectionRange, CellLockTarget, CellFormatTarget, CellFormatPatch } from './types.js';

export type GridChangeSource = 'api' | 'edit' | 'paste' | 'undo' | 'redo';
export type GridEvent =
  | { readonly type: 'merge:change' | 'group:change'; readonly source: 'api' | 'undo' | 'redo' }
  | {readonly type:'view:change'; readonly view:Readonly<LocalViewOptions>; readonly rowCount:number; readonly sourceRowCount:number}
  | { readonly type: 'structure:change'; readonly source: 'api' | 'undo' | 'redo'; readonly request: Readonly<StructureRequest>; readonly rowCount: number; readonly columnKeys: readonly string[] }
  | { readonly type: 'cell:change'; readonly source: GridChangeSource;
      readonly changes: readonly Readonly<CellUpdate & { rowId: RowId; previous: unknown }>[] }
  | { readonly type: 'selection:change'; readonly selection: Readonly<CellSelection> | null; readonly range: Readonly<SelectionRange> | null; readonly ranges: readonly Readonly<SelectionRange>[] }
  | { readonly type: 'format:change'; readonly source: 'api' | 'paste' | 'undo' | 'redo'; readonly changes: readonly { readonly target: Readonly<CellFormatTarget>; readonly previous: Readonly<CellFormatPatch> | null; readonly value: Readonly<CellFormatPatch> | null }[] }
  | { readonly type: 'lock:change'; readonly target: Readonly<CellLockTarget>; readonly locked: boolean }
  | { readonly type: 'freeze:change'; readonly previousRows: number; readonly previousColumns: number; readonly rows: number; readonly columns: number }
  | { readonly type: 'column:resize' | 'row:resize'; readonly index: number; readonly previous: number; readonly size: number };
