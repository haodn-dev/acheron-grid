import type { RowId } from './data-source.js';
import type { CellPermissionPolicy } from './permissions.js';

export interface Column { defaultValue?: unknown; key: string; title: string; editable?: boolean; permissions?: CellPermissionPolicy; parse?: (text: string) => unknown; }
export interface CellSelection { rowIndex: number; rowId: RowId; columnIndex: number; columnKey: string; }
export interface SelectionRange { startRow: number; endRow: number; startColumn: number; endColumn: number; }

export type CellLockTarget =
  | { readonly scope: 'table' }
  | { readonly scope: 'row'; readonly rowIndex: number }
  | { readonly scope: 'column'; readonly columnIndex: number }
  | { readonly scope: 'cell'; readonly rowIndex: number; readonly columnIndex: number };

export type CellFormatTarget = CellLockTarget | { readonly scope: 'range'; readonly range: Readonly<SelectionRange> };
export interface CellFormat { readonly background?: string; readonly textColor?: string; readonly contentFormat?: 'plain' | 'html' | 'markdown'; readonly fontWeight?: 'normal' | 'bold'; readonly fontStyle?: 'normal' | 'italic'; }
export interface CellFormatPatch { readonly background?: string | null; readonly textColor?: string | null; readonly contentFormat?: 'plain' | 'html' | 'markdown' | null; readonly fontWeight?: 'normal' | 'bold' | null; readonly fontStyle?: 'normal' | 'italic' | null; }
export interface RowGroup { readonly id: string; readonly startRow: number; readonly endRow: number; readonly collapsed: boolean; }
export type LayoutRequest = { readonly kind: 'merge' | 'unmerge'; readonly range: Readonly<SelectionRange> }
  | { readonly kind: 'group' | 'ungroup' | 'collapse' | 'expand'; readonly group: Readonly<RowGroup> };
