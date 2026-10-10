import { GridAxis } from '../axis.js';
import type { GridHistoryLimits } from './history-budget.js';
import type { CellUpdate, DataSource, LocalViewOptions, RowId, RowSplice } from '../data-source.js';
import type { GridEngineOptions } from '../engine.js';
import type { CellPermissionPolicy, CellPermissionResolver } from '../permissions.js';
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
  readonly historyLimits?: GridHistoryLimits;
  readonly dataSource: DataSource;
  columns: readonly Readonly<Column>[];
  readonly rowHeight: number;
  readonly columnWidth: number;
  readonly columnIndices: Map<string, number>;
  rowCount: number;
  frozenRows: number;
  frozenColumns: number;
  readonly rowAxis: GridAxis;
  readonly columnAxis: GridAxis;
  readonly permissions: Readonly<CellPermissionPolicy> | undefined;
  resolver: CellPermissionResolver | undefined;
  readonly allowLockChanges: boolean;
  tableLocked: boolean;
  merges: Readonly<SelectionRange>[];
  groups: Readonly<RowGroup>[];
  groupId: number;
  readonly addedColumnKeys: Set<string>;
  readonly manualRows: Set<number>;
  readonly lockedRows: Set<number>;
  readonly lockedColumns: Set<number>;
  readonly lockedCells: Set<string>;
  destroyed: boolean;
  selection: CellSelection | null;
  anchor: CellSelection | null;
  readonly retainedRanges: SelectionRange[];
  pendingCut:
    | { cells: readonly (CellUpdate & { rowId: RowId })[]; columnKeys: readonly string[]; blockCount: number }
    | undefined;
  readonly formats: Map<string, FormatEntry>;
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
  readonly emptyFormat: Readonly<CellFormat>;
  readonly options: GridEngineOptions;
  readonly past: HistoryCommand[];
  readonly future: HistoryCommand[];
}
