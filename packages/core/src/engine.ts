import { LocalDataView } from './data-source.js';
import type { LocalViewOptions } from './data-source.js';
import { blocksToTsv, encodeBlocks, decodeBlocks } from './clipboard.js';
import type { ClipboardBlock } from './clipboard.js';
import { reorderedIndices } from './structure.js';
import type { StructureRequest } from './structure.js';
import type { CellUpdate, DataSource, RowId, DataRow, RowSplice } from './data-source.js';
import type { Column, CellSelection, SelectionRange, CellLockTarget, CellFormatTarget, CellFormat, CellFormatPatch, RowGroup, LayoutRequest } from './types.js';
import { resolvePermissions } from './permissions.js';
import type { CellPermission, CellPermissionPolicy, CellPermissionResolver } from './permissions.js';
import type { GridEvent, GridChangeSource } from './events.js';
import { GridAxis } from './axis.js';
import { createViewport } from './panes.js';
import type { ViewportOptions } from './panes.js';
import { clipboardCellLimit, clipboardTextLimit, decodeTsv } from './tsv.js';

export type GridInvalidation =
  | { readonly type: 'cells'; readonly cells: readonly { readonly rowIndex: number; readonly columnKey: string }[] }
  | { readonly type: 'selection'; readonly changed: boolean; readonly rangeChanged: boolean }
  | { readonly type: 'layout' }
  | { readonly type: 'structure'; readonly rowMap: readonly number[]; readonly columnMap: readonly number[] };

export interface GridEngineOptions {
  allowMerging?: boolean;
  allowRowGrouping?: boolean;
  canChangeLayout?: (request: Readonly<LayoutRequest>) => boolean;
  columns: readonly Column[];
  view?: LocalViewOptions;
  canChangeStructure?: (request: Readonly<StructureRequest>) => boolean;
  dataSource: DataSource;
  permissions?: CellPermissionPolicy;
  resolveCellPermission?: CellPermissionResolver;
  onEvent?: (event: GridEvent) => void;
  rowHeight?: number;
  columnWidth?: number;
  columnWidths?: Readonly<Record<string, number>>;
  allowLockChanges?: boolean;
  frozenRows?: number;
  frozenColumns?: number;
  /** Synchronous renderer notification after state and history have committed. */
  onInvalidate?: (change: GridInvalidation) => void;
}

/** Domain state and operations. No browser globals or per-cell state allocation. */
export function createGridEngine(options: GridEngineOptions) {
  const { dataSource } = options;
  let columns = Object.freeze(options.columns.map(column => Object.freeze({ ...column, ...(column.permissions ? { permissions: Object.freeze({ ...column.permissions }) } : {}) })));
  const rowHeight = options.rowHeight ?? 32;
  const columnWidth = options.columnWidth ?? 160;
  for (const size of [rowHeight, columnWidth]) {
    if (!Number.isFinite(size) || size <= 0) throw new RangeError('Grid sizes must be positive finite numbers.');
  }
  if (new Set(columns.map(column => column.key)).size !== columns.length) throw new Error('Column keys must be unique.');
  const columnIndices = new Map(columns.map((column, index) => [column.key, index]));
  let rowCount = dataSource.getRowCount();
  if (!Number.isSafeInteger(rowCount) || rowCount < 0) throw new RangeError('Invalid row count.');
  let frozenRows = options.frozenRows ?? 0;
  let frozenColumns = options.frozenColumns ?? 0;
  for (const [count, limit] of [[frozenRows, rowCount], [frozenColumns, columns.length]] as const) {
    if (!Number.isSafeInteger(count) || count < 0 || count > limit) throw new RangeError('Invalid frozen row or column count.');
  }
  if (!Number.isFinite(rowCount * rowHeight) || !Number.isFinite(columns.length * columnWidth)) throw new RangeError('Grid dimensions overflow.');
  const rowAxis = new GridAxis(rowCount, rowHeight);
  const columnAxis = new GridAxis(columns.length, columnWidth);
  for (const [key,size] of Object.entries(options.columnWidths ?? {})) {
    const index=columnIndices.get(key); if(index===undefined)throw new Error('Unknown initial column width.');
    columnAxis.setSize(index,size);
  }
  const permissions = options.permissions ? Object.freeze({ ...options.permissions }) : undefined;
  let resolver = options.resolveCellPermission;
  let onEvent = options.onEvent;
  const allowLockChanges = options.allowLockChanges ?? true;
  if (typeof allowLockChanges !== 'boolean') throw new TypeError('allowLockChanges must be boolean.');
  let tableLocked = false;
  let merges: Readonly<SelectionRange>[] = [];
  let groups: Readonly<RowGroup>[] = [];
  let groupId = 0;
  const addedColumnKeys=new Set<string>();
  const manualRows=new Set<number>();
  const lockedRows = new Set<number>();
  const lockedColumns = new Set<number>();
  const lockedCells = new Set<string>();
  let busy = false;
  let destroyed = false;
  let onInvalidate = options.onInvalidate;
  let selection: CellSelection | null = null;
  let anchor: CellSelection | null = null;
  const retainedRanges: SelectionRange[] = [];
  type Change = CellUpdate & { previous: unknown; rowId: RowId };
  type FormatEntry = { target: Readonly<CellFormatTarget>; bounds: Readonly<SelectionRange>; patch: Readonly<CellFormatPatch>; orders: Readonly<{ background?: number; textColor?: number; contentFormat?: number }>; order: number };
  type FormatChange = { key: string; previous: FormatEntry | undefined; value: FormatEntry | undefined };
  type StructureState = {
    merges: readonly Readonly<SelectionRange>[]; groups: readonly Readonly<RowGroup>[];
    columns: typeof columns; rowCount: number; rowIds: readonly RowId[]; rows: ReturnType<GridAxis['snapshot']>; widths: ReturnType<GridAxis['snapshot']>;
    selection: CellSelection | null; anchor: CellSelection | null; ranges: SelectionRange[];
    manualRows:number[]; lockedRows: number[]; lockedColumns: number[]; lockedCells: string[]; formats: Map<string, FormatEntry>;
    frozenRows: number; frozenColumns: number;
  };
  type HistoryCommand = { kind: 'values'; changes: Change[]; formats?: FormatChange[] } | { kind: 'format'; changes: FormatChange[] }
    | { kind: 'outline'; requests: readonly LayoutRequest[]; beforeMerges: readonly Readonly<SelectionRange>[]; afterMerges: readonly Readonly<SelectionRange>[]; beforeGroups: readonly Readonly<RowGroup>[]; afterGroups: readonly Readonly<RowGroup>[] }
    | { kind: 'resize'; axis: 'row' | 'column'; index: number; previous: number; size: number; previousManual:boolean }
    | { kind: 'freeze'; previousRows: number; previousColumns: number; rows: number; columns: number }
    | { kind: 'structure'; request: Readonly<StructureRequest>; reverseRequest: Readonly<StructureRequest>; before: StructureState; after: StructureState; forward: readonly RowSplice[]; backward: readonly RowSplice[]; rowMap: readonly number[]; columnMap: readonly number[] };
  const past: HistoryCommand[] = [];
  const future: HistoryCommand[] = [];
  const formats = new Map<string, FormatEntry>();
  let orderedFormats: FormatEntry[] = [];
  let formatOrder = 0;
  let view: Readonly<LocalViewOptions> = Object.freeze({});
  let projection: number[] | null = null;
  let reverseProjection = new Map<number, number>();
  let projectedAxis: GridAxis | null = null;
  let cachedRanges: SelectionRange[] | null = null;
  let activeParts = 1;
  let displayAnchor: { row: number; col: number } | null = null;

  function viewAxis(): GridAxis { return projectedAxis ?? rowAxis; }
  function visibleFrozenRows():number {
    if(!projection||!groups.some(group=>group.collapsed))return Math.min(frozenRows,visibleRowCount());
    let low=0,high=projection.length;while(low<high){const mid=(low+high)>>>1;if(projection[mid]!<frozenRows)low=mid+1;else high=mid;}return low;
  }
  function rebuildViewAxis(): void {
    if (!projection) { projectedAxis = null; return; }
    const axis = new GridAxis(projection.length, rowHeight);
    axis.replace(projection.length, rowAxis.snapshot().flatMap(([row, size]) => {
      const index = reverseProjection.get(row); return index === undefined ? [] : [[index, size] as const];
    }));
    projectedAxis = axis;
  }
  function buildProjection(next: LocalViewOptions): number[] | null {
    if (!next.sort && !next.filters?.length) {
      const hidden = groups.filter(group => group.collapsed);
      return hidden.length ? Array.from({length:rowCount}, (_,i)=>i).filter(row => !hidden.some(group => row>group.startRow && row<=group.endRow)) : null;
    }
    if (merges.length || groups.length) throw new Error('Unmerge cells and remove row groups before sorting or filtering.');
    for (const key of [next.sort?.columnKey, ...(next.filters ?? []).map(filter => filter.columnKey)]) {
      if (key !== undefined && !columnIndices.has(key)) throw new Error('Unknown view column: ' + key);
    }
    const local = new LocalDataView(dataSource, next);
    return next.sort || next.filters?.length ? Array.from({length: local.getRowCount()}, (_, i) => local.getSourceIndex(i)) : null;
  }
  function installProjection(next: number[] | null): void {
    projection = next; reverseProjection = new Map(next?.map((row, index) => [row, index]) ?? []);
    cachedRanges = null; rebuildViewAxis();
  }
  function displayRow(row: number): number { return projection ? reverseProjection.get(row) ?? -1 : row; }
  function displaySelection(): CellSelection | null {
    if (!selection) return null;
    const rowIndex = displayRow(selection.rowIndex);
    if (rowIndex >= 0) return {...selection, rowIndex};
    const range = displaySelectionRanges().at(-1);
    return range ? { rowIndex: range.startRow, rowId: dataSource.getRowId(sourceRow(range.startRow)), columnIndex: range.startColumn, columnKey: columns[range.startColumn]!.key } : null;
  }
  function setView(next: LocalViewOptions): void {
    assertAlive();
    const snapshot = Object.freeze({...next, ...(next.sort ? {sort:Object.freeze({...next.sort})} : {}), ...(next.filters ? {filters:Object.freeze(next.filters.map(filter => Object.freeze({...filter})))} : {})});
    const nextProjection = buildProjection(snapshot);
    const old = projection ?? Array.from({length:rowCount}, (_, i) => i);
    view = snapshot; installProjection(nextProjection); displayAnchor = null;
    notify({type:'structure', rowMap:old.map(displayRow), columnMap:columns.map((_, i) => i)}, Object.freeze({type:'view:change', view, rowCount:visibleRowCount(), sourceRowCount:rowCount}));
  }
  function sourceTarget<T extends CellLockTarget>(target: T): T {
    return target.scope === 'row' || target.scope === 'cell' ? {...target, rowIndex:sourceRow(target.rowIndex)} : target;
  }
  function sourceRanges(range: SelectionRange): SelectionRange[] {
    if (![range.startRow,range.endRow,range.startColumn,range.endColumn].every(Number.isSafeInteger) || range.startRow<0 || range.endRow<range.startRow || range.endRow>=visibleRowCount() || range.startColumn<0 || range.endColumn<range.startColumn || range.endColumn>=columns.length) throw new RangeError('Invalid selection range.');
    if(!projection)return [{...range}];
    const rows = Array.from({length:range.endRow-range.startRow+1}, (_,i)=>sourceRow(range.startRow+i)).sort((a,b)=>a-b);
    const result:SelectionRange[]=[];
    for (const row of rows) { const last=result.at(-1); if(last && last.endRow+1===row)last.endRow=row; else result.push({...range,startRow:row,endRow:row}); }
    return result;
  }
  function sourceFormats(targets: readonly CellFormatTarget[]): CellFormatTarget[] {
    return targets.flatMap<CellFormatTarget>(target => target.scope === 'range' ? sourceRanges(target.range).map(range=>({scope:'range' as const,range})) : [sourceTarget(target)]);
  }
  function selectDisplayRange(range:SelectionRange, mode:'replace'|'add'|'extend'='replace'):boolean {
    assertAlive();
    if(merges.length)range=expandMergedRange(range,merges.map(span=>({...span,startRow:displayRow(span.startRow),endRow:displayRow(span.endRow)})));
    const parts=sourceRanges(range);
    if (!getCellPermission(sourceRow(range.startRow),range.startColumn).selectable || !getCellPermission(sourceRow(range.endRow),range.endColumn).selectable) return false;
    if (!['replace','add','extend'].includes(mode)) throw new TypeError('Invalid selection mode.');
    if (mode==='add' && displaySelectionRanges().length>=128) throw new RangeError('Selection supports at most 128 ranges.');
    const old=getSelectionRanges();
    const keep=mode==='replace' ? [] : mode==='extend' ? old.slice(0, Math.max(0,old.length-activeParts)) : old;
    const row=sourceRow(range.startRow);
    const others=parts.flatMap(part=>row<part.startRow||row>part.endRow ? [part] : [
      ...(part.startRow<row ? [{...part,endRow:row-1}] : []),
      ...(row<part.endRow ? [{...part,startRow:row+1}] : []),
    ]);
    retainedRanges.splice(0,retainedRanges.length,...keep,...others);
    selection={rowIndex:row,rowId:dataSource.getRowId(row),columnIndex:range.startColumn,columnKey:columns[range.startColumn]!.key};
    anchor={rowIndex:row,rowId:selection.rowId,columnIndex:range.endColumn,columnKey:columns[range.endColumn]!.key};
    activeParts=others.length+1; cachedRanges=null;
    displayAnchor={row:range.startRow,col:range.startColumn};
    notifySelection(true,true); return true;
  }
  function selectDisplay(row:number,col:number,extend=false,add=false):boolean {
    if (!projection && activeParts===1) { displayAnchor={row,col}; return select(row,col,extend,add); }
    const span=mergeAt(sourceRow(row),col);if(span){row=displayRow(span.startRow);col=span.startColumn;}
    const from=extend ? displayAnchor ?? {row:displaySelection()?.rowIndex ?? row,col:displaySelection()?.columnIndex ?? col} : {row,col};
    const result=selectDisplayRange({startRow:Math.min(from.row,row),endRow:Math.max(from.row,row),startColumn:Math.min(from.col,col),endColumn:Math.max(from.col,col)},add?'add':extend?'extend':'replace');
    displayAnchor=from; return result;
  }

  function intersects(a: Readonly<SelectionRange>, b: Readonly<SelectionRange>): boolean {
    return a.startRow<=b.endRow && b.startRow<=a.endRow && a.startColumn<=b.endColumn && b.startColumn<=a.endColumn;
  }
  function mergeAt(row: number, col: number): Readonly<SelectionRange> | undefined {
    return merges.find(range => row>=range.startRow && row<=range.endRow && col>=range.startColumn && col<=range.endColumn);
  }
  function expandMergedRange(range: SelectionRange, spans: readonly Readonly<SelectionRange>[]=merges): SelectionRange {
    const result={...range}; let changed=true;
    while(changed) { changed=false; for(const span of spans) if(intersects(result,span)) {
      const next={startRow:Math.min(result.startRow,span.startRow),endRow:Math.max(result.endRow,span.endRow),startColumn:Math.min(result.startColumn,span.startColumn),endColumn:Math.max(result.endColumn,span.endColumn)};
      if(JSON.stringify(next)!==JSON.stringify(result)){Object.assign(result,next);changed=true;}
    } }
    return result;
  }
  function validateMergeFreeze(spans: readonly Readonly<SelectionRange>[], rows=frozenRows, cols=frozenColumns): void {
    if(spans.some(span => span.startRow<rows && span.endRow>=rows || span.startColumn<cols && span.endColumn>=cols)) throw new Error('A merged cell cannot cross a frozen boundary.');
  }
  function layoutAllowed(request: LayoutRequest): boolean {
    assertAlive();
    if(!request||!['merge','unmerge','group','ungroup','collapse','expand'].includes(request.kind))return false;
    if('range' in request){const range=request.range;if(!range||![range.startRow,range.endRow,range.startColumn,range.endColumn].every(Number.isSafeInteger)||range.startRow<0||range.endRow<range.startRow||range.endRow>=rowCount||range.startColumn<0||range.endColumn<range.startColumn||range.endColumn>=columns.length)return false;}
    else {const group=request.group;if(!group||typeof group.id!=='string'||!Number.isSafeInteger(group.startRow)||!Number.isSafeInteger(group.endRow)||group.startRow<0||group.endRow<=group.startRow||group.endRow>=rowCount||typeof group.collapsed!=='boolean')return false;}
    const snapshot=Object.freeze('range' in request?{...request,range:Object.freeze({...request.range})}:{...request,group:Object.freeze({...request.group})});
    if(tableLocked || options.canChangeLayout?.(snapshot)===false) return false;
    if('range' in request) {
      if(options.allowMerging===false) return false;
      const range=request.range;
      if((range.endRow-range.startRow+1)*(range.endColumn-range.startColumn+1)>clipboardCellLimit) return false;
      for(let row=range.startRow;row<=range.endRow;row++) for(let col=range.startColumn;col<=range.endColumn;col++) if(!getCellPermission(row,col).writable) return false;
    } else {
      if(options.allowRowGrouping===false) return false;
      for(let row=request.group.startRow;row<=request.group.endRow;row++) if(lockedRows.has(row)) return false;
    }
    return true;
  }
  function notifyOutline(kind:'merge'|'group', old:readonly number[], source:'api'|'undo'|'redo'):void {
    if(selection){const span=mergeAt(selection.rowIndex,selection.columnIndex);if(span)selection={rowIndex:span.startRow,columnIndex:span.startColumn,rowId:dataSource.getRowId(span.startRow),columnKey:columns[span.startColumn]!.key};}
    installProjection(buildProjection(view));
    notify({type:'structure',rowMap:old.map(displayRow),columnMap:columns.map((_,i)=>i)}, Object.freeze({type:kind==='merge'?'merge:change':'group:change',source}));
  }
  function changeOutline(requests: readonly LayoutRequest[], nextMerges: readonly Readonly<SelectionRange>[], nextGroups: readonly Readonly<RowGroup>[]):void {
    if(nextMerges.length>1024||nextGroups.length>1024)throw new RangeError('At most 1024 merged regions and row groups are supported.');
    if(requests.some(request=>!layoutAllowed(request))) throw new Error('Changing merged cells or row groups is disabled.');
    const old=projection ?? Array.from({length:rowCount},(_,i)=>i);
    const entry:Extract<HistoryCommand,{kind:'outline'}>={kind:'outline',requests,beforeMerges:merges,afterMerges:nextMerges,beforeGroups:groups,afterGroups:nextGroups};
    merges=[...nextMerges];groups=[...nextGroups];past.push(entry);if(past.length>100)past.shift();future.length=0;
    notifyOutline(requests[0] && 'range' in requests[0] ? 'merge':'group',old,'api');
  }
  function mergeRange(range: SelectionRange): Readonly<SelectionRange> {
    const parts=sourceRanges(range);
    if(parts.length!==1 || parts[0]!.endRow-parts[0]!.startRow!==range.endRow-range.startRow) throw new Error('Merged rows must be contiguous and visible.');
    return Object.freeze(parts[0]!);
  }
  function canMerge(range:SelectionRange):boolean {
    try {
      if((range.endRow-range.startRow+1)*(range.endColumn-range.startColumn+1)>clipboardCellLimit)return false;
      const span=mergeRange(range);validateMergeFreeze([span]);
      return !view.sort && !view.filters?.length && (span.startRow!==span.endRow || span.startColumn!==span.endColumn) && !merges.some(other=>intersects(span,other)) && layoutAllowed({kind:'merge',range:span});
    } catch {return false;}
  }
  function mergeCells(range:SelectionRange):void {
    if(!canMerge(range))throw new Error('This range cannot be merged. Check locks, existing merges and frozen boundaries.');
    const span=mergeRange(range);changeOutline([{kind:'merge',range:span}],[...merges,span],groups);
  }
  function unmergeCells(range:SelectionRange):void {
    const parts=sourceRanges(range), removed=merges.filter(span=>parts.some(part=>intersects(part,span)));
    if(!removed.length)return;
    changeOutline(removed.map(span=>({kind:'unmerge',range:span})),merges.filter(span=>!removed.includes(span)),groups);
  }
  function groupRows(startRow:number,endRow:number):string {
    sourceRow(startRow);sourceRow(endRow);
    if(projection || view.sort || view.filters?.length || endRow<=startRow) throw new Error('Group at least two contiguous rows in an expanded, unsorted view.');
    if(groups.some(group=>group.startRow===startRow&&group.endRow===endRow || group.startRow<=endRow&&startRow<=group.endRow && !(startRow<=group.startRow&&endRow>=group.endRow || group.startRow<=startRow&&group.endRow>=endRow)))throw new Error('Row groups must be nested or disjoint.');
    const group=Object.freeze({id:'group-'+(++groupId),startRow,endRow,collapsed:false});
    changeOutline([{kind:'group',group}],merges,[...groups,group]);return group.id;
  }
  function findGroup(id:string):Readonly<RowGroup> {const group=groups.find(group=>group.id===id);if(!group)throw new Error('Unknown row group.');return group;}
  function ungroupRows(id:string):void {const group=findGroup(id);changeOutline([{kind:'ungroup',group}],merges,groups.filter(other=>other!==group));}
  function setGroupCollapsed(id:string,collapsed:boolean):void {
    if(typeof collapsed!=='boolean')throw new TypeError('Collapsed must be boolean.');
    const group=findGroup(id);if(group.collapsed===collapsed)return;
    if(collapsed && merges.some(span=>span.endRow>group.startRow && span.startRow<=group.endRow))throw new Error('Unmerge cells in these rows before collapsing the group.');
    if(collapsed && group.startRow<frozenRows && group.endRow>=frozenRows)throw new Error('A collapsed group cannot cross a frozen boundary.');
    changeOutline([{kind:collapsed?'collapse':'expand',group}],merges,groups.map(other=>other===group?Object.freeze({...group,collapsed}):other));
  }
  function mergedViewport(options:ViewportOptions) {
    const axis=viewAxis(), viewport=createViewport(axis,columnAxis,visibleFrozenRows(),frozenColumns,options);
    return Object.freeze({...viewport,
      hitTest(x:number,y:number) {const hit=viewport.hitTest(x,y);if(!hit)return null;const span=mergeAt(sourceRow(hit.row),hit.col);return span?{row:displayRow(span.startRow),col:span.startColumn}:hit;},
      cellRect(row:number,col:number) {const base=viewport.cellRect(row,col),span=mergeAt(sourceRow(row),col);if(!span)return base;
        const first=displayRow(span.startRow),last=displayRow(span.endRow),rect=viewport.cellRect(first,span.startColumn);
        return Object.freeze({...rect,width:columnAxis.position(span.endColumn+1)-columnAxis.position(span.startColumn),height:axis.position(last+1)-axis.position(first)});
      }
    });
  }

  const emptyFormat: Readonly<CellFormat> = Object.freeze({});

  function assertAlive(): void {
    if (destroyed) throw new Error('Grid is destroyed.');
  }

  function command<T>(run: () => T): T {
    if (busy) throw new Error('Nested grid mutations are not allowed.');
    busy = true;
    try { return run(); } finally { busy = false; }
  }

  function query<T>(run: () => T): T {
    const wasBusy = busy;
    busy = true;
    try { return run(); } finally { busy = wasBusy; }
  }

  function notify(change: GridInvalidation, event: GridEvent): void {
    cachedRanges = null;
    if (projection && change.type === 'cells') {
      const old = projection;
      installProjection(buildProjection(view));
      if (old.length !== projection!.length || old.some((row,i)=>row !== projection![i])) {
        displayAnchor=null;
        change={type:'structure',rowMap:old.map(displayRow),columnMap:columns.map((_,i)=>i)};
      } else change={type:'cells',cells:change.cells.flatMap(cell=> {const rowIndex=displayRow(cell.rowIndex);return rowIndex<0?[]:[{...cell,rowIndex}];})};
    } else if (change.type === 'layout') rebuildViewAxis();
    let failed = false;
    let firstError: unknown;
    try { onInvalidate?.(change); } catch (error) { failed = true; firstError = error; }
    try { onEvent?.(event); } catch (error) { if (!failed) { failed = true; firstError = error; } }
    if (failed) throw firstError;
  }

  function getCellPermission(rowIndex: number, columnIndex: number): CellPermission {
    assertAlive();
    if (!Number.isSafeInteger(rowIndex) || rowIndex < 0 || rowIndex >= rowCount || !Number.isSafeInteger(columnIndex) || columnIndex < 0 || columnIndex >= columns.length) throw new RangeError('Invalid cell position.');
    const column = columns[columnIndex]!;
    return query(() => {
      const cell = Object.freeze({ rowIndex, rowId: dataSource.getRowId(rowIndex), columnIndex, columnKey: column.key });
      return resolvePermissions(column.editable ?? false, permissions, column.permissions, resolver?.(cell), tableLocked || lockedRows.has(rowIndex) || lockedColumns.has(columnIndex) || lockedCells.has(`${rowIndex}:${columnIndex}`) ? { writable: false } : undefined);
    });
  }

  function requirePermission(rowIndex: number, columnIndex: number, key: keyof CellPermission): void {
    if (!getCellPermission(rowIndex, columnIndex)[key]) throw new Error(`Cell is read-only or permission denied: ${key}.`);
    const span=mergeAt(rowIndex,columnIndex);
    if(span&&rowIndex===span.startRow&&columnIndex===span.startColumn&&(key==='writable'||key==='pasteable')) {
      for(let row=span.startRow;row<=span.endRow;row++)for(let col=span.startColumn;col<=span.endColumn;col++)if(!getCellPermission(row,col).writable)throw new Error('Merged cell contains a locked or read-only cell.');
    }
  }

  function notifyCells(changes: readonly Change[], source: GridChangeSource): void {
    notify({ type: 'cells', cells: changes.map(({ rowIndex, columnKey }) => ({ rowIndex, columnKey })) },
      Object.freeze({ type: 'cell:change', source, changes: Object.freeze(changes.map(change => Object.freeze({ ...change }))) }));
  }

  function write(changes: readonly CellUpdate[]): void {
    if (changes.length === 1 && dataSource.setValue) {
      const change = changes[0]!;
      dataSource.setValue(change.rowIndex, change.columnKey, change.value);
    } else if (dataSource.setValues) dataSource.setValues(changes);
    else throw new Error('An atomic setValues method is required for batch writes.');
  }

  function applyUpdates(updates: readonly CellUpdate[], source: GridChangeSource = 'api', formatChanges: FormatChange[] = []): void {
    assertAlive();
    const unique = new Map<string, CellUpdate>();
    for (const update of updates) {
      if (!Number.isSafeInteger(update.rowIndex) || update.rowIndex < 0 || update.rowIndex >= rowCount) throw new RangeError('Invalid row index.');
      if (!columnIndices.has(update.columnKey)) throw new Error(`Unknown column: ${update.columnKey}`);
      unique.set(JSON.stringify([update.rowIndex, update.columnKey]), { ...update });
    }
    const changes: Change[] = [...unique.values()].map(update => ({ ...update,
      previous: dataSource.getValue(update.rowIndex, update.columnKey), rowId: dataSource.getRowId(update.rowIndex),
    })).filter(change => !Object.is(change.previous, change.value));
    if (!changes.length && !formatChanges.length) return;
    for (const change of changes) requirePermission(change.rowIndex, columnIndices.get(change.columnKey)!, 'writable');
    if (changes.length) write(changes);
    writeFormats(formatChanges);
    past.push({ kind: 'values', changes, formats: formatChanges });
    // keep the latest 100 commands; large values remain shallow caller-owned references.
    if (past.length > 100) past.shift();
    future.length = 0;
    if (changes.length) notifyCells(changes, source);
    if (formatChanges.length) notifyFormats(formatChanges, source === 'paste' ? 'paste' : 'api');
  }

  function replay(redo: boolean): boolean {
    if (destroyed) return false;
    const from = redo ? future : past;
    const to = redo ? past : future;
    const entry = from.at(-1);
    if (!entry) return false;
    if(entry.kind==='outline') {
      const requests=entry.requests.map(request=>redo?request:'range' in request?{...request,kind:request.kind==='merge'?'unmerge' as const:'merge' as const}:{...request,kind:({group:'ungroup',ungroup:'group',collapse:'expand',expand:'collapse'} as const)[request.kind]});
      if(requests.some(request=>!layoutAllowed(request)))throw new Error('Changing merged cells or row groups is disabled.');
      const nextMerges=redo?entry.afterMerges:entry.beforeMerges,nextGroups=redo?entry.afterGroups:entry.beforeGroups;
      if((nextMerges.length||nextGroups.length)&&(view.sort||view.filters?.length))throw new Error('Clear sort and filters before restoring merged cells or row groups.');
      validateMergeFreeze(nextMerges);
      if(nextGroups.some(group=>group.collapsed&&group.startRow<frozenRows&&group.endRow>=frozenRows))throw new Error('A collapsed group cannot cross a frozen boundary.');
      const old=projection ?? Array.from({length:rowCount},(_,i)=>i);
      merges=[...nextMerges];groups=[...nextGroups];from.pop();to.push(entry);
      notifyOutline('range' in entry.requests[0]!?'merge':'group',old,redo?'redo':'undo');return true;
    }
    if (entry.kind === 'structure') {
      replayStructure(entry, redo);
      from.pop(); to.push(entry);
      notifyStructure(entry, redo, redo ? 'redo' : 'undo');
      return true;
    }
    if (entry.kind === 'resize') {
      const axis = entry.axis === 'row' ? rowAxis : columnAxis;
      if ((entry.axis!=='row'||manualRows.has(entry.index)) && axis.size(entry.index) !== (redo ? entry.previous : entry.size)) throw new Error('Layout history conflicts with external changes.');
      axis.setSize(entry.index, redo ? entry.size : entry.previous);
      if(entry.axis==='row'){if(redo||entry.previousManual)manualRows.add(entry.index);else manualRows.delete(entry.index);}
      from.pop(); to.push(entry);
      notify({type:'layout'}, Object.freeze({type:entry.axis === 'row' ? 'row:resize' : 'column:resize', index:entry.index, previous:redo ? entry.previous : entry.size, size:redo ? entry.size : entry.previous}));
      return true;
    }
    if (entry.kind === 'freeze') {
      if (frozenRows !== (redo ? entry.previousRows : entry.rows) || frozenColumns !== (redo ? entry.previousColumns : entry.columns)) throw new Error('Frozen history conflicts with external changes.');
      const previousRows=frozenRows, previousColumns=frozenColumns;
      validateMergeFreeze(merges,redo?entry.rows:entry.previousRows,redo?entry.columns:entry.previousColumns);
      if(groups.some(group=>group.collapsed&&group.startRow<(redo?entry.rows:entry.previousRows)&&group.endRow>=(redo?entry.rows:entry.previousRows)))throw new Error('A collapsed group cannot cross a frozen boundary.');
      frozenRows=redo ? entry.rows : entry.previousRows; frozenColumns=redo ? entry.columns : entry.previousColumns;
      from.pop(); to.push(entry);
      notify({type:'layout'}, Object.freeze({type:'freeze:change', previousRows, previousColumns, rows:frozenRows, columns:frozenColumns}));
      return true;
    }
    if (entry.kind === 'format') {
      for (const change of entry.changes) {
        if (formats.get(change.key) !== (redo ? change.previous : change.value)) throw new Error('Formatting history conflicts with external changes.');
        requireFormatPermission((change.value ?? change.previous)!.bounds);
      }
      const changes = entry.changes.map(change => ({ ...change, previous: redo ? change.previous : change.value, value: redo ? change.value : change.previous }));
      writeFormats(changes); from.pop(); to.push(entry); notifyFormats(changes, redo ? 'redo' : 'undo'); return true;
    }
    const changes = entry.changes;
    for (const change of entry.formats ?? []) {
      if (formats.get(change.key) !== (redo ? change.previous : change.value)) throw new Error('Formatting history conflicts with external changes.');
      requireFormatPermission((change.value ?? change.previous)!.bounds);
    }
    for (const change of changes) {
      if (dataSource.getRowId(change.rowIndex) !== change.rowId || !Object.is(dataSource.getValue(change.rowIndex, change.columnKey), redo ? change.previous : change.value)) {
        throw new Error('History conflicts with external data changes.');
      }
    }
    for (const change of changes) requirePermission(change.rowIndex, columnIndices.get(change.columnKey)!, 'writable');
    const updates = changes.map(change => ({ ...change, previous: redo ? change.previous : change.value, value: redo ? change.value : change.previous }));
    if (updates.length) write(updates);
    const formatChanges = (entry.formats ?? []).map(change => ({ ...change, previous: redo ? change.previous : change.value, value: redo ? change.value : change.previous }));
    writeFormats(formatChanges);
    from.pop();
    to.push(entry);
    if (updates.length) notifyCells(updates, redo ? 'redo' : 'undo');
    if (formatChanges.length) notifyFormats(formatChanges, redo ? 'redo' : 'undo');
    return true;
  }

  function getSelection(): CellSelection | null {
    return selection ? { ...selection } : null;
  }

  function getSelectionRange(): SelectionRange | null {
    if (!selection || !anchor) return null;
    return expandMergedRange({ startRow: Math.min(anchor.rowIndex, selection.rowIndex), endRow: Math.max(anchor.rowIndex, selection.rowIndex),
      startColumn: Math.min(anchor.columnIndex, selection.columnIndex), endColumn: Math.max(anchor.columnIndex, selection.columnIndex) });
  }

  function getSelectionRanges(): SelectionRange[] {
    const range = getSelectionRange();
    return range ? [...retainedRanges.map(range => ({ ...range })), range] : [];
  }

  function displaySelectionRanges():SelectionRange[] {
    if (!projection && activeParts===1) return getSelectionRanges();
    if (cachedRanges) return cachedRanges.map(range=>({...range}));
    const grouped=new Map<string,Set<number>>();
    for(const range of getSelectionRanges()) {
      const key=range.startColumn+':'+range.endColumn;
      const rows=grouped.get(key) ?? new Set<number>(); grouped.set(key,rows);
      for(let row=range.startRow;row<=range.endRow;row++){const index=displayRow(row);if(index>=0)rows.add(index);}
    }
    const result:SelectionRange[]=[];
    for(const [key,rows] of grouped) {
      const [startColumn,endColumn]=key.split(':').map(Number); let last:SelectionRange|undefined;
      for(const row of [...rows].sort((a,b)=>a-b)){if(last&&last.endRow+1===row)last.endRow=row;else {last={startRow:row,endRow:row,startColumn:startColumn!,endColumn:endColumn!};result.push(last);}}
    }
    if(selection) {
      const row=displayRow(selection.rowIndex),col=selection.columnIndex;
      const index=result.findIndex(range=>row>=range.startRow&&row<=range.endRow&&col>=range.startColumn&&col<=range.endColumn);
      if(index>=0)result.push(...result.splice(index,1));
    }
    cachedRanges=result;return result.map(range=>({...range}));
  }
  function sourceRow(index:number):number {
    if (!Number.isSafeInteger(index)||index<0||index>=visibleRowCount())throw new RangeError('Invalid row index in view.');
    return projection ? projection[index]! : index;
  }
  function visibleRowCount():number { return projection?.length ?? rowCount; }
  function clipboardBlocks():ClipboardBlock[] {
    assertAlive();
    const ranges=displaySelectionRanges().sort((a,b)=>a.startRow-b.startRow||a.startColumn-b.startColumn);
    if(!ranges.length)return [];
    const firstRow=Math.min(...ranges.map(range=>range.startRow)),firstColumn=Math.min(...ranges.map(range=>range.startColumn));
    let cells=0,length=0;
    return ranges.map(range=>{
      cells+=(range.endRow-range.startRow+1)*(range.endColumn-range.startColumn+1);
      if(cells>clipboardCellLimit)throw new RangeError('Selection has too many cells.');
      const values:string[][]=[],cellFormats:CellFormat[][]=[];
      for(let row=range.startRow;row<=range.endRow;row++) {
        const line:string[]=[],formatLine:CellFormat[]=[];
        for(let col=range.startColumn;col<=range.endColumn;col++) {
          const index=sourceRow(row);requirePermission(index,col,'copyable');
          const span=mergeAt(index,col),value=span&&(index!==span.startRow||col!==span.startColumn)?null:dataSource.getValue(index,columns[col]!.key),text=value==null?'':String(value);
          length+=text.length;if(length>clipboardTextLimit)throw new RangeError('Selection text is too large.');line.push(text);
          formatLine.push(getFormat(index,col));
        }
        values.push(line);
        cellFormats.push(formatLine);
      }
      return {row:range.startRow-firstRow,column:range.startColumn-firstColumn,values,...(cellFormats.some(line=>line.some(format=>Object.keys(format).length)) ? {formats:cellFormats} : {})};
    });
  }
  function copySelection():string { return blocksToTsv(clipboardBlocks()); }
  function pasteBlocks(blocks:readonly ClipboardBlock[],structured:boolean):void {
    assertAlive();
    const ranges=displaySelectionRanges().sort((a,b)=>a.startRow-b.startRow||a.startColumn-b.startColumn);
    if(!ranges.length)return;
    if(structured&&ranges.length>1&&ranges.length!==blocks.length)throw new Error('Clipboard and target range counts must match.');
    const placements=structured
      ? ranges.length===1 ? blocks.map(block=>({...block,row:ranges[0]!.startRow+block.row,col:ranges[0]!.startColumn+block.column}))
        : blocks.map((block,i)=>({...block,row:ranges[i]!.startRow,col:ranges[i]!.startColumn}))
      : ranges.map(range=>({...blocks[0]!,row:range.startRow,col:range.startColumn}));
    let cells=0;
    const texts=new Map<string,{rowIndex:number;columnKey:string;columnIndex:number;text:string;format?:CellFormat}>();
    for(const place of placements) {
      const height=place.values.length,width=place.values[0]!.length;
      cells+=height*width;if(cells>clipboardCellLimit)throw new RangeError('Paste has too many cells.');
      if(place.row+height>visibleRowCount()||place.col+width>columns.length)throw new RangeError('Paste extends beyond grid bounds.');
      for(let row=0;row<height;row++)for(let col=0;col<width;col++){
        const rowIndex=sourceRow(place.row+row),columnIndex=place.col+col,columnKey=columns[columnIndex]!.key,text=place.values[row]![col]!,key=JSON.stringify([rowIndex,columnKey]),previous=texts.get(key);
        const span=mergeAt(rowIndex,columnIndex);
        if(span&&(rowIndex!==span.startRow||columnIndex!==span.startColumn)) {
          if(text!=='')throw new Error('Paste would overwrite a hidden merged value. Unmerge first.');
          continue;
        }
        if(previous&&previous.text!==text)throw new Error('Overlapping paste targets contain conflicting values.');
        const format = place.formats?.[row]?.[col];
        if (previous && JSON.stringify(previous.format) !== JSON.stringify(format)) throw new Error('Overlapping paste targets contain conflicting formats.');
        texts.set(key,{rowIndex,columnKey,columnIndex,text,...(format ? { format } : {})});
      }
    }
    for(const cell of texts.values()) {
      requirePermission(cell.rowIndex,cell.columnIndex,'pasteable');
      if (cell.format && Object.keys(cell.format).length) requireFormatPermission({ startRow: cell.rowIndex, endRow: cell.rowIndex, startColumn: cell.columnIndex, endColumn: cell.columnIndex });
    }
    const updates=[...texts.values()].map(cell=>{
      const column=columns[cell.columnIndex]!,current=dataSource.getValue(cell.rowIndex,column.key);
      if(!column.parse&&current!=null&&typeof current!=='string')throw new Error('Column requires a parser: '+column.key);
      return {rowIndex:cell.rowIndex,columnKey:column.key,value:column.parse?column.parse(cell.text):cell.text};
    });
    const formatChanges: FormatChange[] = [];
    for (const cell of texts.values()) if (cell.format && Object.keys(cell.format).length) {
      const bounds = { startRow: cell.rowIndex, endRow: cell.rowIndex, startColumn: cell.columnIndex, endColumn: cell.columnIndex };
      requireFormatPermission(bounds);
      const target = { scope: 'cell' as const, rowIndex: cell.rowIndex, columnIndex: cell.columnIndex };
      const key = JSON.stringify(['cell', cell.rowIndex, cell.rowIndex, cell.columnIndex, cell.columnIndex]);
      const previous = formats.get(key), orders = { ...previous?.orders };
      for (const property of Object.keys(cell.format) as (keyof CellFormat)[]) orders[property] = ++formatOrder;
      formatChanges.push({ key, previous, value: { target, bounds: Object.freeze(bounds), patch: Object.freeze({ ...previous?.patch, ...cell.format }), orders: Object.freeze(orders), order: formatOrder } });
    }
    applyUpdates(updates,'paste',formatChanges);
  }
  function paste(text:string):void { pasteBlocks([{row:0,column:0,values:decodeTsv(text)}],false); }

  function select(rowIndex: number, columnIndex: number, extend = false, add = false): boolean {
    assertAlive();
    if (!Number.isSafeInteger(rowIndex) || rowIndex < 0 || rowIndex >= rowCount || !Number.isSafeInteger(columnIndex) || columnIndex < 0 || columnIndex >= columns.length) throw new RangeError('Invalid cell position.');
    if (!getCellPermission(rowIndex, columnIndex).selectable) return false;
    const span=mergeAt(rowIndex,columnIndex);
    if(span){rowIndex=span.startRow;columnIndex=span.startColumn;if(!getCellPermission(rowIndex,columnIndex).selectable)return false;}
    if (add && extend) throw new Error('Adding and extending a selection are separate operations.');
    if (add && selection && retainedRanges.length >= 127) throw new RangeError('Selection supports at most 128 ranges.');
    const nextSelection = { rowIndex, rowId: dataSource.getRowId(rowIndex), columnIndex, columnKey: columns[columnIndex]!.key };
    const previousRanges = JSON.stringify(getSelectionRanges());
    const previous = getSelectionRange();
    if (add && previous) retainedRanges.push(previous);
    else if (!extend) retainedRanges.length = 0;
    const changed = selection?.rowIndex !== rowIndex || selection?.columnIndex !== columnIndex;
    const previousRange = JSON.stringify(getSelectionRange());
    selection = nextSelection;
    if (!extend || !anchor) anchor = { ...selection };
    const rangeChanged = previousRange !== JSON.stringify(getSelectionRange());
    const rangesChanged = previousRanges !== JSON.stringify(getSelectionRanges());
    if (changed || rangeChanged || rangesChanged) notifySelection(changed, rangeChanged || rangesChanged);
    return changed || rangeChanged || rangesChanged;
  }

  function selectRange(range: SelectionRange, mode: 'replace' | 'add' | 'extend' = 'replace'): boolean {
    assertAlive();
    range=expandMergedRange(range);
    const { startRow, endRow, startColumn, endColumn } = range;
    for (const [value, limit] of [[startRow, rowCount], [endRow, rowCount], [startColumn, columns.length], [endColumn, columns.length]]) {
      if (!Number.isSafeInteger(value) || value! < 0 || value! >= limit!) throw new RangeError('Invalid selection range.');
    }
    if (startRow > endRow || startColumn > endColumn) throw new RangeError('Invalid selection range order.');
    if (!getCellPermission(startRow, startColumn).selectable || !getCellPermission(endRow, endColumn).selectable) return false;
    if (mode !== 'replace' && mode !== 'add' && mode !== 'extend') throw new TypeError('Invalid selection mode.');
    if (mode === 'add' && selection && retainedRanges.length >= 127) throw new RangeError('Selection supports at most 128 ranges.');
    const previous = JSON.stringify(getSelectionRanges());
    const previousRange = getSelectionRange();
    if (mode === 'add' && previousRange) retainedRanges.push(previousRange);
    else if (mode === 'replace') retainedRanges.length = 0;
    const changed = selection?.rowIndex !== startRow || selection?.columnIndex !== startColumn;
    selection = { rowIndex: startRow, rowId: dataSource.getRowId(startRow), columnIndex: startColumn, columnKey: columns[startColumn]!.key };
    anchor = { rowIndex: endRow, rowId: dataSource.getRowId(endRow), columnIndex: endColumn, columnKey: columns[endColumn]!.key };
    const rangeChanged = previous !== JSON.stringify(getSelectionRanges());
    if (changed || rangeChanged) notifySelection(changed, rangeChanged);
    return changed || rangeChanged;
  }

  function notifySelection(changed: boolean, rangeChanged: boolean): void {
    cachedRanges=null;
    const endpoint = displaySelection();
    const range = displaySelectionRanges().at(-1) ?? null;
    notify({ type: 'selection', changed, rangeChanged }, Object.freeze({ type: 'selection:change',
      selection: endpoint ? Object.freeze(endpoint) : null, range: range ? Object.freeze(range) : null,
      ranges: Object.freeze(displaySelectionRanges().map(range => Object.freeze(range))) }));
  }

  function clearSelection(): void {
    assertAlive();
    if (!selection) return;
    selection = anchor = null;
    activeParts=1;displayAnchor=null;cachedRanges=null;
    retainedRanges.length = 0;
    notifySelection(true, true);
  }

  function canEdit(rowIndex: number, columnIndex: number): boolean {
    const span=mergeAt(rowIndex,columnIndex);
    if(span){rowIndex=span.startRow;columnIndex=span.startColumn;for(let row=span.startRow;row<=span.endRow;row++)for(let col=span.startColumn;col<=span.endColumn;col++)if(!getCellPermission(row,col).writable)return false;}
    const column = columns[columnIndex];
    if (destroyed || !Number.isSafeInteger(rowIndex) || !Number.isSafeInteger(columnIndex) || !dataSource.setValue || !column || rowIndex < 0 || rowIndex >= rowCount) return false;
    if (!getCellPermission(rowIndex, columnIndex).editable) return false;
    const value = dataSource.getValue(rowIndex, column.key);
    return column.parse !== undefined || value == null || typeof value === 'string';
  }

  function canPaste(): boolean {
    const range = getSelectionRange();
    return !destroyed && !!range && !!(dataSource.setValue || dataSource.setValues) && getCellPermission(range.startRow, range.startColumn).pasteable;
  }

  function editCell(rowIndex: number, columnIndex: number, text: string): void {
    assertAlive();
    const span=mergeAt(rowIndex,columnIndex);if(span){rowIndex=span.startRow;columnIndex=span.startColumn;}
    if (!canEdit(rowIndex, columnIndex)) throw new Error('Cell cannot be edited.');
    const column = columns[columnIndex]!;
    const previous = dataSource.getValue(rowIndex, column.key);
    if (text !== (previous == null ? '' : String(previous))) {
      applyUpdates([{ rowIndex, columnKey: column.key, value: column.parse ? column.parse(text) : text }], 'edit');
    }
  }

  function resize(axis: GridAxis, index: number, size: number, history = true): void {
    assertAlive();
    if(!history&&manualRows.has(index))return;
    const previous = axis.size(index), previousManual=axis===rowAxis&&manualRows.has(index);
    axis.setSize(index, size);
    if (previous !== size && history) { if(axis===rowAxis)manualRows.add(index); past.push({kind:'resize', axis:axis === rowAxis ? 'row' : 'column', index, previous, size, previousManual}); if (past.length > 100) past.shift(); future.length=0; }
    if (previous !== size) notify({ type: 'layout' }, Object.freeze({ type: axis === rowAxis ? 'row:resize' : 'column:resize', index, previous, size }));
  }

  function formatBounds(target: CellFormatTarget): SelectionRange {
    if (target.scope !== 'range') {
      validateLockTarget(target);
      return { startRow: target.scope === 'row' || target.scope === 'cell' ? target.rowIndex : 0,
        endRow: target.scope === 'row' || target.scope === 'cell' ? target.rowIndex : rowCount - 1,
        startColumn: target.scope === 'column' || target.scope === 'cell' ? target.columnIndex : 0,
        endColumn: target.scope === 'column' || target.scope === 'cell' ? target.columnIndex : columns.length - 1 };
    }
    const range = target.range;
    if (!range || ![range.startRow, range.endRow, range.startColumn, range.endColumn].every(Number.isSafeInteger) || range.startRow < 0 || range.endRow < range.startRow || range.endRow >= rowCount || range.startColumn < 0 || range.endColumn < range.startColumn || range.endColumn >= columns.length) throw new RangeError('Invalid formatting range.');
    return { startRow: range.startRow, endRow: range.endRow, startColumn: range.startColumn, endColumn: range.endColumn };
  }

  function requireFormatPermission(bounds: SelectionRange): void {
    if (permissions?.formatting === false) throw new Error('Cell does not permit formatting.');
    if (!resolver) {
      for (let col = bounds.startColumn; col <= bounds.endColumn; col++) if (!resolvePermissions(columns[col]!.editable ?? false, permissions, columns[col]!.permissions).formatting) throw new Error('Cell does not permit formatting.');
    } else for (let row = bounds.startRow; row <= bounds.endRow; row++) for (let col = bounds.startColumn; col <= bounds.endColumn; col++) requirePermission(row, col, 'formatting');
  }

  function canFormat(targets: readonly CellFormatTarget[]): boolean {
    if (destroyed) return false;
    const bounds = targets.map(formatBounds);
    try { for (const range of bounds) requireFormatPermission(range); return bounds.length > 0; } catch { return false; }
  }

  function getFormat(rowIndex: number, columnIndex: number): Readonly<CellFormat> {
    assertAlive(); validateLockTarget({ scope: 'cell', rowIndex, columnIndex });
    if (!orderedFormats.length) return emptyFormat;
    const result: Record<string, string> = {};
    const orders = { background: 0, textColor: 0, contentFormat: 0 };
    // Scan sparse overlays; index regions if large formatting sets become costly.
    for (const entry of orderedFormats) {
      const range = entry.bounds;
      if (rowIndex < range.startRow || rowIndex > range.endRow || columnIndex < range.startColumn || columnIndex > range.endColumn) continue;
      for (const key of ['background', 'textColor', 'contentFormat'] as const) {
        if ((entry.orders[key] ?? 0) <= orders[key]) continue;
        orders[key] = entry.orders[key]!;
        const value = entry.patch[key];
        if (value === null) delete result[key]; else if (value !== undefined) result[key] = value;
      }
    }
    return Object.freeze(result);
  }

  function writeFormats(changes: readonly FormatChange[]): void {
    for (const change of changes) { if (change.value) formats.set(change.key, change.value); else formats.delete(change.key); }
    orderedFormats = [...formats.values()].sort((a, b) => a.order - b.order);
  }

  function notifyFormats(changes: readonly FormatChange[], source: 'api' | 'paste' | 'undo' | 'redo'): void {
    notify({ type: 'layout' }, Object.freeze({ type: 'format:change', source, changes: Object.freeze(changes.map(change => Object.freeze({ target: (change.value ?? change.previous)!.target, previous: change.previous?.patch ?? null, value: change.value?.patch ?? null }))) }));
  }

  function format(targets: readonly CellFormatTarget[], patch: CellFormatPatch | null): void {
    assertAlive();
    if (patch !== null) {
      if (!patch || typeof patch !== 'object') throw new TypeError('Invalid formatting patch.');
      patch = Object.freeze({ ...patch });
      for (const [key, value] of Object.entries(patch)) if (!['contentFormat','background','textColor'].includes(key) || value !== null && (key === 'contentFormat' ? !['plain','html','markdown'].includes(value) : typeof value !== 'string' || !/^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i.test(value))) throw new TypeError('Invalid cell format.');
      if (!Object.keys(patch).length) return;
    }
    const unique = new Map<string, { target: CellFormatTarget; bounds: SelectionRange }>();
    for (const target of targets) {
      const bounds = formatBounds(target);
      if (bounds.endRow < bounds.startRow || bounds.endColumn < bounds.startColumn) continue;
      const snapshot = Object.freeze(target.scope === 'range' ? { scope: 'range' as const, range: Object.freeze({ ...bounds }) } : { ...target });
      unique.set(JSON.stringify([target.scope, bounds.startRow, bounds.endRow, bounds.startColumn, bounds.endColumn]), { target: snapshot, bounds });
    }
    for (const entry of unique.values()) requireFormatPermission(entry.bounds);
    const changes: FormatChange[] = [];
    for (const [key, entry] of unique) {
      const previous = formats.get(key);
      const nextPatch = patch === null ? undefined : Object.freeze({ ...previous?.patch, ...patch });
      if ((!previous && !nextPatch) || (previous && previous === orderedFormats.at(-1) && JSON.stringify(previous.patch) === JSON.stringify(nextPatch))) continue;
      const orders = { ...previous?.orders };
      if (patch) for (const key of ['background', 'textColor', 'contentFormat'] as const) if (patch[key] !== undefined) orders[key] = ++formatOrder;
      changes.push({ key, previous, value: nextPatch ? { ...entry, bounds: Object.freeze(entry.bounds), patch: nextPatch, orders: Object.freeze(orders), order: formatOrder } : undefined });
    }
    if (!changes.length) return;
    writeFormats(changes); past.push({ kind: 'format', changes }); if (past.length > 100) past.shift(); future.length = 0;
    notifyFormats(changes, 'api');
  }

  function validateLockTarget(target: CellLockTarget): void {
    if (!target || !['table', 'row', 'column', 'cell'].includes(target.scope)) throw new TypeError('Invalid lock scope.');
    if ((target.scope === 'row' || target.scope === 'cell') && (!Number.isSafeInteger(target.rowIndex) || target.rowIndex < 0 || target.rowIndex >= rowCount)) throw new RangeError('Invalid lock row.');
    if ((target.scope === 'column' || target.scope === 'cell') && (!Number.isSafeInteger(target.columnIndex) || target.columnIndex < 0 || target.columnIndex >= columns.length)) throw new RangeError('Invalid lock column.');
  }

  function isLocked(target: CellLockTarget): boolean {
    assertAlive(); validateLockTarget(target);
    if (target.scope === 'table') return tableLocked;
    if (target.scope === 'row') return lockedRows.has(target.rowIndex);
    if (target.scope === 'column') return lockedColumns.has(target.columnIndex);
    return lockedCells.has(`${target.rowIndex}:${target.columnIndex}`);
  }

  function setLocked(target: CellLockTarget, locked: boolean): void {
    assertAlive();
    if (!allowLockChanges) throw new Error('Lock management is disabled.');
    if (typeof locked !== 'boolean') throw new TypeError('Lock state must be boolean.');
    if (isLocked(target) === locked) return;
    if (target.scope === 'table') tableLocked = locked;
    else if (target.scope === 'row') { if (locked) lockedRows.add(target.rowIndex); else lockedRows.delete(target.rowIndex); }
    else if (target.scope === 'column') { if (locked) lockedColumns.add(target.columnIndex); else lockedColumns.delete(target.columnIndex); }
    else { const key = `${target.rowIndex}:${target.columnIndex}`; if (locked) lockedCells.add(key); else lockedCells.delete(key); }
    notify({ type: 'layout' }, Object.freeze({ type: 'lock:change', target: Object.freeze({ ...target }), locked }));
  }

  function setFrozen(rows: number, columnCount: number): void {
    assertAlive();
    if (!Number.isSafeInteger(rows) || rows < 0 || rows > rowCount || !Number.isSafeInteger(columnCount) || columnCount < 0 || columnCount > columns.length) throw new RangeError('Invalid frozen row or column count.');
    if (rows === frozenRows && columnCount === frozenColumns) return;
    validateMergeFreeze(merges,rows,columnCount);
    if(groups.some(group=>group.collapsed&&group.startRow<rows&&group.endRow>=rows))throw new Error('A collapsed group cannot cross a frozen boundary.');
    const previousRows = frozenRows; const previousColumns = frozenColumns;
    frozenRows = rows; frozenColumns = columnCount;
    past.push({kind:'freeze', previousRows, previousColumns, rows, columns:columnCount}); if (past.length > 100) past.shift(); future.length=0;
    notify({ type: 'layout' }, Object.freeze({ type: 'freeze:change', previousRows, previousColumns, rows, columns: columnCount }));
  }


  function snapshotStructure(): StructureState {
    return {merges,groups,columns, rowCount, rowIds:Array.from({length:rowCount},(_,i)=>dataSource.getRowId(i)), rows:rowAxis.snapshot(), widths:columnAxis.snapshot(), selection:getSelection(), anchor:anchor ? {...anchor} : null,
      ranges:retainedRanges.map(range=>({...range})), manualRows:[...manualRows], lockedRows:[...lockedRows], lockedColumns:[...lockedColumns], lockedCells:[...lockedCells],
      formats:new Map(formats), frozenRows, frozenColumns};
  }
  function restoreStructure(state: StructureState): void {
    merges=[...state.merges];groups=[...state.groups];
    activeParts=1;displayAnchor=null;cachedRanges=null;
    columns=state.columns; rowCount=state.rowCount; columnIndices.clear(); columns.forEach((column,i)=>columnIndices.set(column.key,i));
    rowAxis.replace(rowCount,state.rows); columnAxis.replace(columns.length,state.widths);
    selection=state.selection ? {...state.selection} : null; anchor=state.anchor ? {...state.anchor} : null;
    retainedRanges.length=0; retainedRanges.push(...state.ranges.map(range=>({...range})));
    manualRows.clear(); for(const index of state.manualRows)manualRows.add(index);
    lockedRows.clear(); for (const index of state.lockedRows) lockedRows.add(index);
    lockedColumns.clear(); for (const index of state.lockedColumns) lockedColumns.add(index);
    lockedCells.clear(); for (const key of state.lockedCells) lockedCells.add(key);
    formats.clear(); for (const [key,entry] of state.formats) formats.set(key,entry);
    orderedFormats=[...formats.values()].sort((a,b)=>a.order-b.order);
    frozenRows=state.frozenRows; frozenColumns=state.frozenColumns;
  }
  function mappedIntervals(start: number, end: number, mapping: readonly number[]): [number,number][] {
    const sorted=mapping.slice(start,end+1).filter(i=>i>=0).sort((a,b)=>a-b), result:[number,number][]=[];
    for (const index of sorted) {
      const last=result.at(-1);
      if (last && index===last[1]+1) last[1]=index; else result.push([index,index]);
    }
    return result;
  }
  function mappedRanges(range: SelectionRange, rows: readonly number[], cols: readonly number[]): SelectionRange[] {
    return mappedIntervals(range.startRow,range.endRow,rows).flatMap(([startRow,endRow])=>mappedIntervals(range.startColumn,range.endColumn,cols).map(([startColumn,endColumn])=>({startRow,endRow,startColumn,endColumn})));
  }
  function mappedState(before: StructureState, order: readonly number[], axis: 'row'|'column', rowMap: number[], columnMap: number[], addedColumns:readonly Column[]=[]): StructureState {
    let inserted=0;
    const nextColumns=axis==='column' ? Object.freeze(order.map(i=>i<0 ? addedColumns[inserted++]! : columns[i]!)) : columns;
    const nextCount=axis==='row' ? order.length : rowCount;
    const mapCell=(cell:CellSelection|null):CellSelection|null => {
      if (!cell || rowMap[cell.rowIndex]===undefined || rowMap[cell.rowIndex]!<0 || columnMap[cell.columnIndex]===undefined || columnMap[cell.columnIndex]!<0) return null;
      return {...cell,rowIndex:rowMap[cell.rowIndex]!,columnIndex:columnMap[cell.columnIndex]!};
    };
    const ranges=before.ranges.flatMap(range=>mappedRanges(range,rowMap,columnMap));
    const currentRange=getSelectionRange(),activeRanges=currentRange ? mappedRanges(currentRange,rowMap,columnMap):[];
    const nextSelection=mapCell(selection), nextAnchor=mapCell(anchor);
    const active=activeRanges.findIndex(range=>nextSelection && nextSelection.rowIndex>=range.startRow && nextSelection.rowIndex<=range.endRow && nextSelection.columnIndex>=range.startColumn && nextSelection.columnIndex<=range.endColumn);
    if(active>=0)activeRanges.push(...activeRanges.splice(active,1));
    ranges.push(...activeRanges);
    if(ranges.length>128)throw new RangeError('Structural change would exceed the selection range limit.');
    const activeRange=ranges.pop();
    const cellAt=(rowIndex:number,columnIndex:number):CellSelection => ({rowIndex,columnIndex,columnKey:nextColumns[columnIndex]!.key,rowId:axis==='row' ? dataSource.getRowId(order[rowIndex]!) : dataSource.getRowId(rowIndex)});
    let mappedSelection=nextSelection, mappedAnchor=nextAnchor;
    if (activeRange && nextCount && nextColumns.length) {
      const exact=nextSelection && nextAnchor && Math.min(nextSelection.rowIndex,nextAnchor.rowIndex)===activeRange.startRow && Math.max(nextSelection.rowIndex,nextAnchor.rowIndex)===activeRange.endRow && Math.min(nextSelection.columnIndex,nextAnchor.columnIndex)===activeRange.startColumn && Math.max(nextSelection.columnIndex,nextAnchor.columnIndex)===activeRange.endColumn;
      if (!exact) { mappedSelection=cellAt(activeRange.startRow,activeRange.startColumn); mappedAnchor=cellAt(activeRange.endRow,activeRange.endColumn); }
    } else mappedSelection=mappedAnchor=null;
    const nextFormats=new Map<string,FormatEntry>();
    for (const entry of before.formats.values()) {
      const targets:CellFormatTarget[]=[];
      if (entry.target.scope==='table') targets.push(entry.target);
      else if (entry.target.scope==='row') { const row=rowMap[entry.target.rowIndex]!; if(row>=0) targets.push({scope:'row',rowIndex:row}); }
      else if (entry.target.scope==='column') { const col=columnMap[entry.target.columnIndex]!; if(col>=0) targets.push({scope:'column',columnIndex:col}); }
      else if (entry.target.scope==='cell') { const row=rowMap[entry.target.rowIndex]!,col=columnMap[entry.target.columnIndex]!; if(row>=0&&col>=0) targets.push({scope:'cell',rowIndex:row,columnIndex:col}); }
      else for (const range of mappedRanges(entry.bounds,rowMap,columnMap)) targets.push({scope:'range',range:Object.freeze(range)});
      for (const target of targets) {
        const bounds:SelectionRange=target.scope==='range' ? {...target.range} : {
          startRow:target.scope==='row'||target.scope==='cell' ? target.rowIndex:0,endRow:target.scope==='row'||target.scope==='cell' ? target.rowIndex:nextCount-1,
          startColumn:target.scope==='column'||target.scope==='cell' ? target.columnIndex:0,endColumn:target.scope==='column'||target.scope==='cell' ? target.columnIndex:nextColumns.length-1};
        const nextKey=JSON.stringify([target.scope,bounds.startRow,bounds.endRow,bounds.startColumn,bounds.endColumn]);
        const existing=nextFormats.get(nextKey),patch={...existing?.patch},orders={...existing?.orders};
        for(const property of ['background','textColor','contentFormat'] as const)if((entry.orders[property]??0)>(orders[property]??0)){orders[property]=entry.orders[property]!;Object.assign(patch,{[property]:entry.patch[property]!});}
        nextFormats.set(nextKey,{...entry,target:Object.freeze(target),bounds:Object.freeze(bounds),patch:Object.freeze(patch),orders:Object.freeze(orders),order:Math.max(existing?.order??0,entry.order)});
      }
    }
    const mapSizes=(sizes:StructureState['rows'],map:readonly number[])=>sizes.filter(([i])=>map[i]!>=0).map(([i,size])=>[map[i]!,size] as const);
    function contiguous(start:number,end:number,map:readonly number[]):[number,number]|null {
      const values=map.slice(start,end+1);if(values.some(i=>i<0))return null;
      if(values.some((value,i)=>value!==values[0]!+i))throw new Error('This change would split a merged cell or row group. Remove it first.');
      return [values[0]!,values.at(-1)!];
    }
    const nextMerges=before.merges.flatMap(span=>{const rows=contiguous(span.startRow,span.endRow,rowMap),cols=contiguous(span.startColumn,span.endColumn,columnMap);return rows&&cols?[Object.freeze({startRow:rows[0],endRow:rows[1],startColumn:cols[0],endColumn:cols[1]})]:[];});
    const nextGroups=before.groups.flatMap(group=>{const rows=contiguous(group.startRow,group.endRow,rowMap);return rows?[Object.freeze({...group,startRow:rows[0],endRow:rows[1]})]:[];});
    validateMergeFreeze(nextMerges,Math.min(frozenRows,nextCount),Math.min(frozenColumns,nextColumns.length));
    return {...before,columns:nextColumns,rowCount:nextCount,rowIds:axis==='row' ? order.map(i=>i<0 ? '' : before.rowIds[i]!) : before.rowIds,rows:mapSizes(before.rows,rowMap),widths:mapSizes(before.widths,columnMap),selection:mappedSelection,anchor:mappedAnchor,ranges,
      merges:nextMerges,groups:nextGroups,
      manualRows:before.manualRows.map(i=>rowMap[i]!).filter(i=>i>=0),lockedRows:before.lockedRows.map(i=>rowMap[i]!).filter(i=>i>=0),lockedColumns:before.lockedColumns.map(i=>columnMap[i]!).filter(i=>i>=0),
      lockedCells:before.lockedCells.flatMap(key=>{const [r,c]=key.split(':').map(Number);const row=rowMap[r!]!,col=columnMap[c!]!;return row>=0&&col>=0 ? [`${row}:${col}`] : [];}),
      formats:nextFormats,frozenRows:Math.min(frozenRows,nextCount),frozenColumns:Math.min(frozenColumns,nextColumns.length)};
  }
  function structureAllowed(request: Readonly<StructureRequest>): boolean {
    const limit=request?.axis==='row' ? rowCount:columns.length;
    if(!request||!['row','column'].includes(request.axis)||!['insert','delete','move'].includes(request.kind)||!Array.isArray(request.indices)||!Number.isSafeInteger(request.beforeIndex)||request.beforeIndex<0||request.beforeIndex>limit||!Number.isSafeInteger(request.count)||request.count<1||new Set(request.indices).size!==request.indices.length||request.indices.some(i=>!Number.isSafeInteger(i)||i<0||i>=limit))return false;
    if (destroyed || projection || tableLocked || options.canChangeStructure?.(request)===false) return false;
    if (request.axis==='row' && (!dataSource.getRow || !dataSource.spliceRows)) return false;
    if(request.axis==='column' && request.kind!=='move' && !dataSource.addColumns)return false;
    if (request.kind==='delete') {
      if(request.axis==='row') {
        if(request.indices.some(row=>lockedRows.has(row)))return false;
        for(const row of request.indices)for(let col=0;col<columns.length;col++)if(!getCellPermission(row,col).writable)return false;
      } else {
        if(request.indices.some(col=>lockedColumns.has(col)))return false;

      }
    }
    return true;
  }
  function structureRequest(axis:'row'|'column',kind:StructureRequest['kind'],indices:readonly number[],beforeIndex:number,count:number):Readonly<StructureRequest> {
    return Object.freeze({axis,kind,indices:Object.freeze([...indices]),beforeIndex,count});
  }
  function inverseMap(map:readonly number[],count:number):number[] {
    const result=Array<number>(count).fill(-1); map.forEach((next,old)=>{if(next>=0) result[next]=old;});return result;
  }
  function notifyStructure(entry:Extract<HistoryCommand,{kind:'structure'}>,redo:boolean,source:'api'|'undo'|'redo'):void {
    const state=redo ? entry.after:entry.before;
    notify({type:'structure',rowMap:redo ? entry.rowMap:Object.freeze(inverseMap(entry.rowMap,entry.after.rowCount)),columnMap:redo ? entry.columnMap:Object.freeze(inverseMap(entry.columnMap,entry.after.columns.length))},
      Object.freeze({type:'structure:change',source,request:redo ? entry.request:entry.reverseRequest,rowCount:state.rowCount,columnKeys:Object.freeze(state.columns.map(col=>col.key))}));
  }
  function replayStructure(entry:Extract<HistoryCommand,{kind:'structure'}>,redo:boolean):void {
    const request=redo ? entry.request:entry.reverseRequest;
    if(!structureAllowed(request)) throw new Error('Structural change is disabled.');
    if(dataSource.getRowCount()!==rowCount)throw new Error('Structural history conflicts with external row count.');
    const expectedState=redo ? entry.before:entry.after;
    if(expectedState.rowIds.some((id,i)=>dataSource.getRowId(i)!==id))throw new Error('Structural history conflicts with external row identity.');
    const splices=redo ? entry.forward:entry.backward;
    // Validate snapshots that this direction removes, before any source mutation.
    if(request.axis==='row') {
      const removed=splices.flatMap(splice=>Array.from({length:splice.deleteCount},(_,i)=>splice.index+i));
      const removedById=new Map(removed.map(i=>[dataSource.getRowId(i),i]));
      const inserted=(redo ? entry.backward:entry.forward).flatMap(splice=>splice.rows);
      for(const row of inserted) if(removedById.has(row.id)) {
        const index=removedById.get(row.id)!;
        const current=dataSource.getRow!(index);
        if(Object.keys(current.values).some(key=>!Object.hasOwn(row.values,key)&&!addedColumnKeys.has(key)&&current.values[key]!==undefined) || Object.keys(row.values).some(key=>!Object.is(current.values[key],row.values[key]))) throw new Error('Structural history conflicts with external data changes.');
      }
      const liveRows=new Map(removed.map(i=>[dataSource.getRowId(i),dataSource.getRow!(i)]));
      dataSource.spliceRows!(splices.map(splice=>({...splice,rows:splice.rows.map(row=>({id:row.id,values:{...liveRows.get(row.id)?.values,...row.values}}))})));
    }
    const state=redo ? entry.after:entry.before;
    const rMap=redo ? entry.rowMap:inverseMap(entry.rowMap,entry.after.rowCount),cMap=redo ? entry.columnMap:inverseMap(entry.columnMap,entry.after.columns.length);
    // Locks are outside history: preserve changes made since the structural command.
    const previousLocks={rows:[...lockedRows],columns:[...lockedColumns],cells:[...lockedCells]};
    restoreStructure(state);
    lockedRows.clear(); previousLocks.rows.forEach(i=>{if(rMap[i]!>=0) lockedRows.add(rMap[i]!);});
    lockedColumns.clear(); previousLocks.columns.forEach(i=>{if(cMap[i]!>=0) lockedColumns.add(cMap[i]!);});
    lockedCells.clear(); previousLocks.cells.forEach(key=>{const [r,c]=key.split(':').map(Number);if(rMap[r!]!>=0&&cMap[c!]!>=0)lockedCells.add(`${rMap[r!]}:${cMap[c!]}`);});
    if(!redo) {
      for(const row of state.lockedRows) if(entry.rowMap[row]===-1) lockedRows.add(row);
      for(const col of state.lockedColumns) if(entry.columnMap[col]===-1) lockedColumns.add(col);
      for(const key of state.lockedCells) {const [r,c]=key.split(':').map(Number);if(entry.rowMap[r!]===-1||entry.columnMap[c!]===-1)lockedCells.add(key);}
    }
  }
  function changeStructure(request:Readonly<StructureRequest>,reverseRequest:Readonly<StructureRequest>,order:readonly number[],forward:readonly RowSplice[],backward:readonly RowSplice[],addedColumns:readonly Column[]=[]):void {
    assertAlive();
    if(dataSource.getRowCount()!==rowCount) throw new Error('External row count changed.');
    const rowMap=Array.from({length:rowCount},(_,i)=>i),columnMap=Array.from({length:columns.length},(_,i)=>i);
    const map=request.axis==='row' ? rowMap:columnMap; map.fill(-1);order.forEach((old,index)=>{if(old>=0)map[old]=index;});
    const before=snapshotStructure(),after=mappedState(before,order,request.axis,rowMap,columnMap,addedColumns);
    request=Object.freeze({...request,order:Object.freeze([...order]),columns:after.columns});
    reverseRequest=Object.freeze({...reverseRequest,order:Object.freeze([...map]),columns:before.columns});
    if(!structureAllowed(request))throw new Error('Structural change is disabled.');
    const checkRows=new GridAxis(after.rowCount,rowHeight),checkColumns=new GridAxis(after.columns.length,columnWidth);
    checkRows.replace(after.rowCount,after.rows);checkColumns.replace(after.columns.length,after.widths);
    if(addedColumns.length) {
      dataSource.addColumns!(addedColumns.map(column=>column.key),Object.fromEntries(addedColumns.filter(column=>Object.hasOwn(column,'defaultValue')).map(column=>[column.key,column.defaultValue])));
      addedColumns.forEach(column=>addedColumnKeys.add(column.key));
    }
    if(request.axis==='row') {
      let inserted=0;const newRows=forward.flatMap(splice=>splice.rows);
      after.rowIds=order.map(old=>old>=0 ? before.rowIds[old]! : newRows[inserted++]!.id);
      dataSource.spliceRows!(forward);
    }
    restoreStructure(after);
    const entry:Extract<HistoryCommand,{kind:'structure'}>={kind:'structure',request,reverseRequest,before,after,forward,backward,rowMap:Object.freeze(rowMap),columnMap:Object.freeze(columnMap)};
    past.push(entry); if(past.length>100)past.shift();future.length=0;
    notifyStructure(entry,true,'api');
  }
  function insertRows(beforeIndex:number,rows:readonly DataRow[]):void {
    assertAlive();
    if(!Number.isSafeInteger(beforeIndex)||beforeIndex<0||beforeIndex>rowCount||!Array.isArray(rows))throw new RangeError('Invalid row insertion.');
    if(!rows.length)return;
    const snapshots=Object.freeze(rows.map(row=>Object.freeze({id:row.id,values:Object.freeze({...row.values})})));
    const previous=Array.from({length:rowCount},(_,i)=>i),order=previous.slice(0,beforeIndex).concat(Array<number>(rows.length).fill(-1),previous.slice(beforeIndex));
    changeStructure(structureRequest('row','insert',[],beforeIndex,rows.length),structureRequest('row','delete',rows.map((_,i)=>beforeIndex+i),beforeIndex,rows.length),order,
      [{index:beforeIndex,deleteCount:0,rows:snapshots}],[{index:beforeIndex,deleteCount:rows.length,rows:[]}]);
  }
  function rowBlocks(indices:readonly number[],rows:readonly DataRow[]):RowSplice[] {
    const blocks:RowSplice[]=[];
    let start=0;
    while(start<indices.length) {
      let end=start+1;while(end<indices.length&&indices[end]===indices[end-1]!+1)end++;
      blocks.push({index:indices[start]!,deleteCount:end-start,rows:rows.slice(start,end)});start=end;
    }
    return blocks;
  }
  function deleteRows(indices:readonly number[]):void {
    assertAlive();if(!indices.length)return;
    const ordered=[...indices].sort((a,b)=>a-b);
    if(new Set(ordered).size!==ordered.length||ordered.some(i=>!Number.isSafeInteger(i)||i<0||i>=rowCount))throw new RangeError('Invalid row deletion.');
    if(!dataSource.getRow||!dataSource.spliceRows)throw new Error('Atomic structural source methods are required.');
    const deleted=new Set(ordered),rows=ordered.map(i=>dataSource.getRow!(i)),blocks=rowBlocks(ordered,rows);
    changeStructure(structureRequest('row','delete',ordered,ordered[0]!,ordered.length),structureRequest('row','insert',[],ordered[0]!,ordered.length),Array.from({length:rowCount},(_,i)=>i).filter(i=>!deleted.has(i)),
      blocks.map(block=>({...block,rows:[]})).reverse(),blocks.map(block=>({...block,deleteCount:0})));
  }
  function insertColumns(beforeIndex:number,added:readonly Column[]):void {
    assertAlive();
    if(!Number.isSafeInteger(beforeIndex)||beforeIndex<0||beforeIndex>columns.length||!Array.isArray(added))throw new RangeError('Invalid column insertion.');
    if(!added.length)return;
    const snapshots=Object.freeze(added.map(column=>{
      if(!column||typeof column.key!=='string'||!column.key||typeof column.title!=='string')throw new TypeError('Invalid inserted column.');
      return Object.freeze({...column,...(column.permissions ? {permissions:Object.freeze({...column.permissions})}:{})});
    }));
    if(new Set([...columns,...snapshots].map(c=>c.key)).size!==columns.length+snapshots.length)throw new Error('Column keys must be unique.');
    const previous=Array.from({length:columns.length},(_,i)=>i),order=previous.slice(0,beforeIndex).concat(Array<number>(snapshots.length).fill(-1),previous.slice(beforeIndex));
    changeStructure(structureRequest('column','insert',[],beforeIndex,added.length),structureRequest('column','delete',added.map((_,i)=>beforeIndex+i),beforeIndex,added.length),order,[],[],snapshots);
  }
  function deleteColumns(indices:readonly number[]):void {
    assertAlive();if(!indices.length)return;
    const selected=[...indices].sort((a,b)=>a-b);
    if(new Set(selected).size!==selected.length||selected.some(i=>!Number.isSafeInteger(i)||i<0||i>=columns.length))throw new RangeError('Invalid column deletion.');
    const removed=new Set(selected),order=Array.from({length:columns.length},(_,i)=>i).filter(i=>!removed.has(i));
    changeStructure(structureRequest('column','delete',selected,selected[0]!,selected.length),structureRequest('column','insert',[],selected[0]!,selected.length),order,[],[]);
  }
  function moveAxis(axis:'row'|'column',indices:readonly number[],beforeIndex:number):void {
    assertAlive();const count=axis==='row' ? rowCount:columns.length,order=reorderedIndices(count,indices,beforeIndex);
    if(order.every((old,i)=>old===i))return;
    const selected=[...indices].sort((a,b)=>a-b),insertion=beforeIndex-selected.filter(i=>i<beforeIndex).length;
    let forward:RowSplice[]=[],backward:RowSplice[]=[];
    if(axis==='row'){
      if(!dataSource.getRow||!dataSource.spliceRows)throw new Error('Atomic structural source methods are required.');
      const rows=selected.map(i=>dataSource.getRow!(i)),blocks=rowBlocks(selected,rows);
      forward=blocks.map(block=>({...block,rows:[]})).reverse();forward.push({index:insertion,deleteCount:0,rows});
      backward=[{index:insertion,deleteCount:selected.length,rows:[]},...blocks.map(block=>({...block,deleteCount:0}))];
    }
    changeStructure(structureRequest(axis,'move',selected,beforeIndex,selected.length),structureRequest(axis,'move',selected.map((_,i)=>insertion+i),selected[0]!,selected.length),order,forward,backward);
  }

  function axisView(axis: GridAxis) {
    return Object.freeze({
      size: (index: number) => axis.size(index),
      position: (index: number) => axis.position(index),
      indexAt: (offset: number) => axis.indexAt(offset),
      range: (offset: number, extent: number) => axis.range(offset, extent),
    });
  }

  if(options.view) { view=Object.freeze({...options.view, ...(options.view.sort ? {sort:Object.freeze({...options.view.sort})} : {}), ...(options.view.filters ? {filters:Object.freeze(options.view.filters.map(filter=>Object.freeze({...filter})))} : {})}); installProjection(buildProjection(view)); }
  return Object.freeze({
    setView:(next:LocalViewOptions)=>command(()=>setView(next)),
    get view(){return view;},
    get sourceRowCount(){return rowCount;},
    getRowId:(row:number)=>dataSource.getRowId(sourceRow(row)),
    get columns() { return columns; }, get rowCount() { return visibleRowCount(); }, get frozenRows() { return visibleFrozenRows(); }, get frozenColumns() { return frozenColumns; },
    getViewport: (viewport: ViewportOptions) => { assertAlive(); return mergedViewport(viewport); },
    getMergedCells:()=>Object.freeze(merges.map(span=>Object.freeze({...span}))),
    getMerge:(row:number,col:number)=> {const span=mergeAt(sourceRow(row),col);return span?Object.freeze({...span,startRow:displayRow(span.startRow),endRow:displayRow(span.endRow)}):null;},
    canMerge:(range:SelectionRange)=>query(()=>canMerge(range)),
    mergeCells:(range:SelectionRange)=>command(()=>mergeCells(range)),
    unmergeCells:(range:SelectionRange)=>command(()=>unmergeCells(range)),
    getRowGroups:()=>Object.freeze(groups.map(group=>Object.freeze({...group}))),
    canChangeLayout:(request:LayoutRequest)=>query(()=>layoutAllowed(request)),
    getRowSourceIndex:(row:number)=>sourceRow(row),
    groupRows:(start:number,end:number)=>command(()=>groupRows(start,end)),
    ungroupRows:(id:string)=>command(()=>ungroupRows(id)),
    setGroupCollapsed:(id:string,collapsed:boolean)=>command(()=>setGroupCollapsed(id,collapsed)),
    rows: Object.freeze({size:(i:number)=>viewAxis().size(i),position:(i:number)=>viewAxis().position(i),indexAt:(offset:number)=>viewAxis().indexAt(offset),range:(offset:number,extent:number)=>viewAxis().range(offset,extent)}), columnsLayout: axisView(columnAxis),
    getValue: (row: number, key: string): unknown => dataSource.getValue(sourceRow(row), key),
    insertColumns:(index:number,added:readonly Column[])=>command(()=>insertColumns(index,added)),
    deleteColumns:(indices:readonly number[])=>command(()=>deleteColumns(indices)),
    insertRows: (index:number,rows:readonly DataRow[])=>command(()=>insertRows(index,rows)),
    deleteRows: (indices:readonly number[])=>command(()=>deleteRows(indices)),
    moveRows: (indices:readonly number[],beforeIndex:number)=>command(()=>moveAxis('row',indices,beforeIndex)),
    moveColumns: (indices:readonly number[],beforeIndex:number)=>command(()=>moveAxis('column',indices,beforeIndex)),
    canChangeStructure: (request:Readonly<StructureRequest>)=>query(()=>structureAllowed(request)),
    isRowHeightManual:(index:number)=>manualRows.has(sourceRow(index)),
    measureRowHeight: (index:number,size:number)=>command(()=>resize(rowAxis,sourceRow(index),size,false)),
    getSelection:displaySelection, getSelectionRange:()=>displaySelectionRanges().at(-1) ?? null, getSelectionRanges:displaySelectionRanges,
    getCellPermission:(row:number,col:number)=>getCellPermission(sourceRow(row),col), canEdit:(row:number,col:number)=>!destroyed&&row>=0&&row<visibleRowCount()&&canEdit(sourceRow(row),col),
    canPaste:()=>displaySelectionRanges().length>0&&canPaste(),
    select: (row: number, col: number, extend = false) => command(() => selectDisplay(row, col, extend)),
    selectRange: (range: SelectionRange, mode: 'replace' | 'add' | 'extend' = 'replace') => command(() => { if(!projection && activeParts===1)return selectRange(range,mode); return selectDisplayRange(range,mode); }),
    addSelection: (row: number, col: number) => command(() => selectDisplay(row, col, false, true)),
    clearSelection: () => command(clearSelection),
    editCell: (row: number, col: number, text: string) => command(() => editCell(sourceRow(row), col, text)),
    updateCells: (updates: readonly CellUpdate[]) => command(() => applyUpdates(updates.map(update=>({...update,rowIndex:sourceRow(update.rowIndex)})))),
    copySelectionBlocks:()=>query(()=>encodeBlocks(clipboardBlocks())),
    pasteSelectionBlocks:(text:string)=>command(()=>pasteBlocks(decodeBlocks(text),true)),
    copySelection: () => query(copySelection), paste: (text: string) => command(() => paste(text)),
    undo: () => command(() => replay(false)), redo: () => command(() => replay(true)),
    canUndo: () => !destroyed && past.length > 0,
    canRedo: () => !destroyed && future.length > 0,
    getFormat:(row:number,col:number)=>getFormat(sourceRow(row),col), canFormat: (targets: readonly CellFormatTarget[]) => query(() => canFormat(sourceFormats(targets))),
    format: (targets: readonly CellFormatTarget[], patch: CellFormatPatch | null) => command(() => format(sourceFormats(targets), patch)),
    isLocked:(target:CellLockTarget)=>isLocked(sourceTarget(target)), canManageLocks: () => !destroyed && allowLockChanges,
    setLocked: (target: CellLockTarget, locked: boolean) => command(() => setLocked(sourceTarget(target), locked)),
    setFrozen: (rows: number, columns: number) => command(() => {if(!Number.isSafeInteger(rows)||rows<0||rows>visibleRowCount())throw new RangeError('Invalid frozen row count.');setFrozen(projection&&groups.some(group=>group.collapsed)&&rows>0?sourceRow(rows-1)+1:rows, columns);}),
    setColumnWidth: (index: number, size: number) => command(() => resize(columnAxis, index, size)),
    setRowHeight: (index: number, size: number) => command(() => resize(rowAxis, sourceRow(index), size)),
    destroy: () => command(() => {
      if (destroyed) return;
      destroyed = true;
      onInvalidate = undefined;
      onEvent = undefined;
      resolver = undefined;
      past.length = future.length = 0;
      selection = anchor = null;
      retainedRanges.length = 0;
      formats.clear(); orderedFormats.length = 0;
      merges=[];groups=[];
      projection=null;projectedAxis=null;cachedRanges=null;reverseProjection.clear();displayAnchor=null;
      manualRows.clear();lockedRows.clear(); lockedColumns.clear(); lockedCells.clear(); tableLocked = false;
    }),
  });
}

export type GridEngine = ReturnType<typeof createGridEngine>;
