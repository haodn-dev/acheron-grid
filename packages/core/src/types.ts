import type { RowId } from './data-source.js';
import type { CellPermissionPolicy } from './permissions.js';

export interface Column { key: string; title: string; editable?: boolean; permissions?: CellPermissionPolicy; parse?: (text: string) => unknown; }
export interface CellSelection { rowIndex: number; rowId: RowId; columnIndex: number; columnKey: string; }
export interface SelectionRange { startRow: number; endRow: number; startColumn: number; endColumn: number; }
