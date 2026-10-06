import { GridAxis } from '../axis.js';
import type { CellUpdate, DataSource, LocalViewOptions, RowId, RowSplice } from '../data-source.js';
import type { GridEngineOptions, GridInvalidation } from '../engine.js';
import type { GridEvent } from '../events.js';
import type { CellPermissionResolver } from '../permissions.js';
import type { StructureRequest } from '../structure.js';
import type {
  CellFormat,
  CellFormatPatch,
  CellFormatTarget,
  CellSelection,
  Column,
  LayoutRequest,
  RowGroup,
  SelectionRange,
} from '../types.js';
export type Change = CellUpdate & { previous: unknown; rowId: RowId };
export type FormatEntry = {
  target: Readonly<CellFormatTarget>;
  bounds: Readonly<SelectionRange>;
  patch: Readonly<CellFormatPatch>;
  orders: Readonly<{
    background?: number;
    textColor?: number;
    contentFormat?: number;
    fontWeight?: number;
    fontStyle?: number;
    numberFormat?: number;
  }>;
  order: number;
};
export type FormatChange = { key: string; previous: FormatEntry | undefined; value: FormatEntry | undefined };
export type StructureState = {
  merges: readonly Readonly<SelectionRange>[];
  groups: readonly Readonly<RowGroup>[];
  columns: readonly Readonly<Column>[];
  rowCount: number;
  rowIds: readonly RowId[];
  rows: ReturnType<GridAxis['snapshot']>;
  widths: ReturnType<GridAxis['snapshot']>;
  selection: CellSelection | null;
  anchor: CellSelection | null;
  ranges: SelectionRange[];
  manualRows: number[];
  hiddenRows: number[];
  hiddenColumns: number[];
  lockedRows: number[];
  lockedColumns: number[];
  lockedCells: string[];
  formats: Map<string, FormatEntry>;
  frozenRows: number;
  frozenColumns: number;
};
export type HistoryCommand =
  | { kind: 'values'; changes: Change[]; formats?: FormatChange[] }
  | { kind: 'format'; changes: FormatChange[] }
  | { kind: 'visibility'; axis: 'row' | 'column'; indices: readonly number[]; hidden: boolean }
  | {
      kind: 'outline';
      requests: readonly LayoutRequest[];
      beforeMerges: readonly Readonly<SelectionRange>[];
      afterMerges: readonly Readonly<SelectionRange>[];
      beforeGroups: readonly Readonly<RowGroup>[];
      afterGroups: readonly Readonly<RowGroup>[];
    }
  | { kind: 'resize'; axis: 'row' | 'column'; index: number; previous: number; size: number; previousManual: boolean }
  | { kind: 'freeze'; previousRows: number; previousColumns: number; rows: number; columns: number }
  | {
      kind: 'structure';
      request: Readonly<StructureRequest>;
      reverseRequest: Readonly<StructureRequest>;
      before: StructureState;
      after: StructureState;
      forward: readonly RowSplice[];
      backward: readonly RowSplice[];
      rowMap: readonly number[];
      columnMap: readonly number[];
    };
export interface EngineContext {
  dataSource: DataSource;
  columns: readonly Readonly<Column>[];
  rowHeight: number;
  columnWidth: number;
  columnIndices: Map<string, number>;
  rowCount: number;
  frozenRows: number;
  frozenColumns: number;
  rowAxis: GridAxis;
  columnAxis: GridAxis;
  permissions:
    | Readonly<{
        editable?: boolean;
        selectable?: boolean;
        copyable?: boolean;
        pasteable?: boolean;
        writable?: boolean;
        formatting?: boolean;
      }>
    | undefined;
  resolver: CellPermissionResolver | undefined;
  onEvent: ((event: GridEvent) => void) | undefined;
  allowLockChanges: boolean;
  tableLocked: boolean;
  merges: Readonly<SelectionRange>[];
  groups: Readonly<RowGroup>[];
  groupId: number;
  addedColumnKeys: Set<string>;
  manualRows: Set<number>;
  lockedRows: Set<number>;
  lockedColumns: Set<number>;
  lockedCells: Set<string>;
  busy: boolean;
  destroyed: boolean;
  onInvalidate: ((change: GridInvalidation) => void) | undefined;
  subscribers: Set<{
    readonly onEvent?: (event: GridEvent) => void;
    readonly onInvalidate?: (change: GridInvalidation) => void;
  }>;
  observerErrors: unknown[];
  selection: CellSelection | null;
  anchor: CellSelection | null;
  retainedRanges: SelectionRange[];
  pendingCut:
    | { cells: readonly (CellUpdate & { rowId: RowId })[]; columnKeys: readonly string[]; blockCount: number }
    | undefined;
  formats: Map<string, FormatEntry>;
  orderedFormats: FormatEntry[];
  formatOrder: number;
  view: Readonly<LocalViewOptions>;
  projection: number[] | null;
  reverseProjection: Map<number, number>;
  projectedAxis: GridAxis | null;
  cachedRanges: SelectionRange[] | null;
  cachedFrozenRows: number | null;
  activeParts: number;
  displayAnchor: { row: number; col: number } | null;
  emptyFormat: Readonly<CellFormat>;
  options: GridEngineOptions;
  past: HistoryCommand[];
  future: HistoryCommand[];
}
