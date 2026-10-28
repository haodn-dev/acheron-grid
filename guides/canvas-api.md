# Canvas API signatures

API catalog generated from the exported TypeScript Grid type. Use the package guide for behavior/examples and match the selected documentation version to your installed packages. Coordinates are zero-based visible indices unless a contract states otherwise.

[Package guide](../packages/canvas/README.md) · [Version policy](versions.md)

## Data and lifecycle

### updateCellsAsync

```ts
updateCellsAsync: (updates: readonly CellUpdate[], options: GridBulkOptions) => Promise<void>
```



### getValue

```ts
getValue: (rowIndex: number, columnKey: string) => unknown
```



### replaceText

```ts
replaceText: (search: string, replacement: string, options?: Parameters<GridEngine["replaceText"]>[2]) => ReturnType<GridEngine["replaceText"]>
```

Available in 0.2.0: bounded literal replacement. One undo command; permission/validation failures leave the batch unchanged.

### subscribe

```ts
subscribe: (subscriber: { readonly onEvent?: (event: GridEvent) => void; readonly onInvalidate?: (change: GridInvalidation) => void; }) => () => void
```



### takeObserverErrors

```ts
takeObserverErrors: () => unknown[]
```



### captureRowIdentity

```ts
captureRowIdentity: () => readonly RowId[]
```

Capture before external structural changes. Explicitly scans all row IDs.

### refreshData

```ts
refreshData: (previousRowIds?: readonly RowId[] | "values") => void
```

External writes are outside history. All refresh modes clear undo/redo; values mode requires unchanged row IDs/order/count.

### refreshRows

```ts
refreshRows: (startRow: number, endRow: number) => RowRefreshResult
```

Refresh a bounded row window through core without remounting. Reject while an editor or local search is open; finish/cancel or close it before retrying. See the core contract for history, selection, identity and layout restrictions.

### resetData

```ts
resetData: () => DataResetResult
```

Reset through the bounded core epoch contract without remounting. Reject open editors or local Find; host must settle them before changing its source. Clear renderer caches, update count/ARIA/index geometry and move vertical scroll to zero. No identity anchor or source loading is performed.

### rowCount

```ts
rowCount: number
```



### columns

```ts
columns: readonly Column[]
```



### render

```ts
render: () => void
```

Schedule a browser repaint. It is not an identity reconciliation command; use refreshData after external changes.

### updateCells

```ts
updateCells: (updates: readonly CellUpdate[]) => void
```

Typed values; no parsing. Column validation and writable permissions run before one atomic write. Uses visible indices.

### destroy

```ts
destroy: () => void
```

Release this instance. Idempotent; host-owned sources and external subscriptions still need host cleanup.

## Selection and clipboard

### pasteAsync

```ts
pasteAsync: (text: string, bulk: GridBulkOptions, options?: PasteOptions) => Promise<void>
```



### selectColumn

```ts
selectColumn: (index: number) => void
```



### selectRow

```ts
selectRow: (index: number) => void
```



### selectCell

```ts
selectCell: (rowIndex: number, columnIndex: number) => void
```

Source preview after 0.4.0: select and reveal one display cell through shared permissions and geometry, without fetching data or focusing the DOM. Invalid positions and destroyed grids throw; finish editors and close local Find first. Repeating the current cell reveals it again. No stable-ID lookup is performed.

### selectAll

```ts
selectAll: () => void
```



### getSelection

```ts
getSelection: () => CellSelection | null
```



### getSelectionRange

```ts
getSelectionRange: () => SelectionRange | null
```



### getSelectionRanges

```ts
getSelectionRanges: () => SelectionRange[]
```



### cutSelectionBlocks

```ts
cutSelectionBlocks: () => string
```



### cancelCut

```ts
cancelCut: () => void
```



### copySelectionBlocks

```ts
copySelectionBlocks: () => string
```



### pasteSelectionBlocks

```ts
pasteSelectionBlocks: (text: string, options?: PasteOptions) => void
```



### copySelection

```ts
copySelection: () => string
```

TSV text through copy permissions. No direct operating-system clipboard access in core.

### paste

```ts
paste: (text: string, options?: PasteOptions) => void
```

Parse TSV/editor text and preflight the complete destination before writing.

## History

### undoAsync

```ts
undoAsync: (options: GridBulkOptions) => Promise<boolean>
```



### redoAsync

```ts
redoAsync: (options: GridBulkOptions) => Promise<boolean>
```



### undo

```ts
undo: () => boolean
```

Replay the last command only if current identities/values/permissions allow it; returns whether replay occurred.

### redo

```ts
redo: () => boolean
```

Reapply a previously undone command under current identity/value/permission checks.

## Views and persistence

### setGrouping

```ts
setGrouping: (next: LocalGroupingOptions | null) => void
```

Available in 0.4.0: filter complete local records, group by one scalar key and optionally sum finite numeric values; sort leaves within each group. Reject incompatible row layout/history before installing. Null clears grouping. No source writes.

### grouping

```ts
grouping: Readonly<LocalGroupingOptions> | null
```

Frozen current local grouping criteria, or null. Grouping is separate from LocalViewOptions and server queries.

### tree

```ts
tree: Readonly<LocalTreeOptions> | null
```

Frozen current parent-column criteria, or null. Tree projection is separate from LocalViewOptions and remote queries.

### setTree

```ts
setTree: (next: LocalTreeOptions | null) => void
```

Available in 0.4.0: validate a complete local parent-ID forest, retain filter matches and ancestors, and sort siblings. Reject invalid IDs, parents, cycles, depth above 4096 and incompatible grouping/row layout/history before installing. Null clears tree; no source writes.

### getTreeRowMetadata

```ts
getTreeRowMetadata: (row: number) => LocalTreeRow | null
```

Frozen metadata for a visible real tree record: sourceIndex, rowId, parentId, 1-based level, retained hasChildren and expanded. Null outside tree mode. No synthetic row ID.

### setTreeExpanded

```ts
setTreeExpanded: (rowId: RowId, expanded: boolean) => void
```

Expand/collapse a visible branch by its real typed row ID, outside data undo. Reduce selection to its active visible cell or affected parent if hidden; discard hidden ranges. Unknown branches reject; unchanged expansion is a no-op.

### exportTreeState

```ts
exportTreeState: () => TreeState
```

Frozen version-1 parent-column criteria and typed collapsed IDs. Contains no dataset provenance, records, permissions or history; the host selects the matching complete dataset.

### restoreTreeState

```ts
restoreTreeState: (state: unknown) => void
```

Validate unknown version-1 state, schema, layout and collapsed IDs against the current forest before replacing tree projection atomically. Clears selection; does not restore source data or authority.

### getRowMetadata

```ts
getRowMetadata: (row: number) => GridRowMetadata
```

Discriminated group/leaf metadata for a visible row. Only leaves have real sourceIndex and rowId; group metadata contains key, count, sums, retained source indices and expanded state. Legacy getRowId/getRowSourceIndex reject group rows.

### focusGroup

```ts
focusGroup: (row: number) => boolean
```

Focus a group header and clear all data selection/cut targets. Returns false for a leaf. Group focus is separate from CellSelection.

### getFocusedGroup

```ts
getFocusedGroup: () => number
```

Visible index of the focused group header, or -1. No synthetic CellSelection or RowId is created.

### setDataGroupExpanded

```ts
setDataGroupExpanded: (key: GroupKey, expanded: boolean) => void
```

Expand/collapse a typed visible group key without changing source values, aggregates or data history. Clears leaf selection and focuses the header.

### exportGroupingState

```ts
exportGroupingState: () => GroupingState
```

Frozen version-1 criteria/collapsed-key view snapshot, separate from legacy GridState/GridConfiguration. Contains no data, authorization or history; apply only to a matching host-owned dataset.

### restoreGroupingState

```ts
restoreGroupingState: (state: unknown) => void
```

Validate unknown version-1 grouping state and schema/layout before installing atomically. Typed collapsed keys survive local filters. Does not restore source data or permissions.

### setViewAsync

```ts
setViewAsync: (next: LocalViewOptions, options: GridBulkOptions) => Promise<void>
```



### exportState

```ts
exportState: () => GridState
```

Domain UI state only: excludes row data, callbacks, source transport and undo history.

### restoreState

```ts
restoreState: (state: unknown) => void
```

Validate unknown state before committing; application permissions cannot be replaced by saved state.

### exportConfiguration

```ts
exportConfiguration: () => GridConfiguration
```

JSON-safe column order/widths, frozen counts and core-owned view; excludes data, callbacks and history.

### setView

```ts
setView: (view: LocalViewOptions) => void
```

Set local sort/filter criteria, not a server query. Structural commands require clearing the projected view.

### view

```ts
view: Readonly<LocalViewOptions>
```



## Structure and groups

### getMerge

```ts
getMerge: (row: number, col: number) => Readonly<SelectionRange> | null
```



### getMergedCells

```ts
getMergedCells: () => readonly Readonly<SelectionRange>[]
```



### canMerge

```ts
canMerge: (range: SelectionRange) => boolean
```



### mergeCells

```ts
mergeCells: (range: SelectionRange) => void
```



### unmergeCells

```ts
unmergeCells: (range: SelectionRange) => void
```



### getRowGroups

```ts
getRowGroups: () => readonly Readonly<RowGroup>[]
```



### groupRows

```ts
groupRows: (start: number, end: number) => string
```



### ungroupRows

```ts
ungroupRows: (id: string) => void
```



### setGroupCollapsed

```ts
setGroupCollapsed: (id: string, collapsed: boolean) => void
```



### insertColumns

```ts
insertColumns: (index: number, columns: readonly Column[]) => void
```



### deleteColumns

```ts
deleteColumns: (indices: readonly number[]) => void
```



### insertRows

```ts
insertRows: (index: number, rows: readonly DataRow[]) => void
```



### deleteRows

```ts
deleteRows: (indices: readonly number[]) => void
```



### moveRows

```ts
moveRows: (indices: readonly number[], beforeIndex: number) => void
```



### moveColumns

```ts
moveColumns: (indices: readonly number[], beforeIndex: number) => void
```



## Permissions and formatting

### isLocked

```ts
isLocked: (target: CellLockTarget) => boolean
```



### canManageLocks

```ts
canManageLocks: () => boolean
```



### setLocked

```ts
setLocked: (target: CellLockTarget, locked: boolean) => void
```



### getFormat

```ts
getFormat: (rowIndex: number, columnIndex: number) => Readonly<CellFormat>
```



### canFormat

```ts
canFormat: (targets: readonly CellFormatTarget[]) => boolean
```



### format

```ts
format: (targets: readonly CellFormatTarget[], patch: CellFormatPatch | null) => void
```



### getCellPermission

```ts
getCellPermission: (rowIndex: number, columnIndex: number) => CellPermission
```



## Layout and browser controls

### getMotion

```ts
getMotion: () => Readonly<Required<MotionOptions>>
```



### setMotion

```ts
setMotion: (value: boolean | MotionOptions) => void
```



### getViewport

```ts
getViewport: () => GridViewport
```

Read frozen shared core viewport geometry without scanning source values or IDs. Display ranges have exclusive ends and may be disjoint. onViewportChange coalesces geometry notifications in a microtask. The host owns bounded loading and eviction reconciliation.

### setColumnEditor

```ts
setColumnEditor: (key: string, editor: ColumnEditor | null) => void
```

Replace a configured browser editor. Host callbacks remain trusted code.

### setTheme

```ts
setTheme: (theme: Partial<GridTheme>) => void
```

Validated theme patch; does not recreate the grid or resize rows.

### openSearch

```ts
openSearch: () => void
```



### autoFitColumn

```ts
autoFitColumn: (index: number) => void
```



### autoFitRow

```ts
autoFitRow: (index: number) => void
```



### frozenRows

```ts
frozenRows: number
```



### frozenColumns

```ts
frozenColumns: number
```



### setRowsHidden

```ts
setRowsHidden: (indices: readonly number[], hidden: boolean) => void
```



### setColumnsHidden

```ts
setColumnsHidden: (indices: readonly number[], hidden: boolean) => void
```



### getHiddenRows

```ts
getHiddenRows: () => readonly number[]
```



### getHiddenColumns

```ts
getHiddenColumns: () => readonly number[]
```



### isRowHidden

```ts
isRowHidden: (index: number) => boolean
```



### isColumnHidden

```ts
isColumnHidden: (index: number) => boolean
```



### setFrozen

```ts
setFrozen: (rows: number, columns: number) => void
```



### setColumnWidth

```ts
setColumnWidth: (index: number, width: number) => void
```



### setRowHeight

```ts
setRowHeight: (index: number, height: number) => void
```



## Construction options

Call createGrid with GridOptions. Required fields are marked; options are read at construction unless the package guide specifies a runtime setter.

| Field | Required | Type |
| --- | --- | --- |
| allowMerging | No | `boolean \| undefined` |
| allowSearch | No | `boolean \| undefined` |
| allowRowGrouping | No | `boolean \| undefined` |
| canChangeLayout | No | `((request: Readonly<LayoutRequest>) => boolean) \| undefined` |
| locale | No | `string \| undefined` |
| messages | No | `Readonly<Record<string, string>> \| undefined` |
| currency | No | `string \| undefined` |
| view | No | `LocalViewOptions \| undefined` |
| viewMode | No | `"core" \| "host" \| undefined` |
| onViewChange | No | `((view: LocalViewOptions) => void) \| undefined` |
| onViewportChange | No | `((viewport: GridViewport) => void) \| undefined` |
| theme | No | `Partial<GridTheme> \| undefined` |
| imageColumns | No | `readonly string[] \| undefined` |
| avatarColumns | No | `readonly string[] \| undefined` |
| mediaOptions | No | `{ readonly size?: number; readonly maxVisible?: number; readonly maxConcurrentUploads?: number; readonly upload?: (file: File, context: Readonly<{ columnKey: string; signal: AbortSignal; onProgress: (loaded: number, total?: number) => void; }>) => Promise<MediaItem>; } \| undefined` |
| columnEditors | No | `Readonly<Record<string, ColumnEditor>> \| undefined` |
| richTextColumns | No | `Readonly<Record<string, RichTextFormat>> \| undefined` |
| markdownToHtml | No | `((source: string) => string) \| undefined` |
| multilineEditor | No | `boolean \| undefined` |
| editorOptions | No | `{ readonly pinned?: boolean; readonly showLabel?: boolean \| "scroll" \| "always"; readonly guardNavigation?: boolean; } \| undefined` |
| wrapText | No | `boolean \| undefined` |
| detectLinks | No | `boolean \| undefined` |
| allowOpenLinks | No | `boolean \| undefined` |
| contextMenuSuggestions | No | `boolean \| undefined` |
| linkPreview | No | `boolean \| { readonly enabled?: boolean; readonly allowMetadata?: boolean; readonly load: (href: string, signal: AbortSignal) => Promise<{ readonly title?: string; readonly description?: string; readonly image?: string; }>; } \| undefined` |
| accessibility | No | `"active" \| "viewport" \| undefined` |
| getCellLabel | No | `((rowIndex: number, columnKey: string, value: unknown) => string \| undefined) \| undefined` |
| renderCell | No | `CellRenderer \| undefined` |
| renderCellBackground | No | `((context: CanvasRenderingContext2D, cell: CellRenderInfo) => void) \| undefined` |
| createEditor | No | `CellEditorFactory \| undefined` |
| onEditorMount | No | `((cell: Readonly<CellEditorInfo>, editor: CellEditor) => void \| (() => void)) \| undefined` |
| onObserverError | No | `((error: unknown) => void) \| undefined` |
| choiceEditor | No | `false \| ChoiceEditorOptions \| undefined` |
| motion | No | `boolean \| MotionOptions \| undefined` |
| tableLockNotice | No | `false \| { readonly title?: string; readonly description?: string; } \| undefined` |
| selectionStyle | No | `{ readonly activeCellBorderInRange?: boolean; readonly activeBorderWidth?: number; readonly headerTintOpacity?: number; readonly rangeBorderWidth?: number; readonly rangeTintOpacity?: number; } \| undefined` |
| allowColumnChanges | No | `boolean \| undefined` |
| columnTypes | No | `readonly ColumnType[] \| undefined` |
| onRowChange | No | `((request: Readonly<RowChangeRequest>) => void) \| undefined` |
| canRowChange | No | `((request: Readonly<RowChangeRequest>) => boolean) \| undefined` |
| onReorder | No | `((request: Readonly<ReorderRequest>) => void) \| undefined` |
| canReorder | No | `((request: Readonly<ReorderRequest>) => boolean) \| undefined` |
| onSelectionChange | No | `((selection: CellSelection \| null) => void) \| undefined` |
| onSelectionRangesChange | No | `((ranges: readonly SelectionRange[]) => void) \| undefined` |
| onSelectionRangeChange | No | `((range: SelectionRange \| null) => void) \| undefined` |
| container | Yes | `HTMLElement` |
| columns | Yes | `readonly Column[]` |
| dataSource | Yes | `DataSource` |
| rowHeight | No | `number \| undefined` |
| columnWidth | No | `number \| undefined` |
| headerHeight | No | `number \| undefined` |
| headerGroups | No | `readonly HeaderGroup[] \| undefined` |
| autoRowHeight | No | `boolean \| undefined` |
| measureCellHeight | No | `((value: unknown, columnKey: string, width: number) => number \| undefined) \| undefined` |
| indexColumn | No | `boolean \| undefined` |
| permissions | No | `Partial<CellPermission> \| undefined` |
| canChangeStructure | No | `((request: Readonly<StructureRequest>) => boolean) \| undefined` |
| tree | No | `LocalTreeOptions \| undefined` |
| grouping | No | `LocalGroupingOptions \| undefined` |
| frozenRows | No | `number \| undefined` |
| frozenColumns | No | `number \| undefined` |
| resolveCellPermission | No | `CellPermissionResolver \| undefined` |
| onEvent | No | `((event: GridEvent) => void) \| undefined` |
| allowLockChanges | No | `boolean \| undefined` |
| columnWidths | No | `Readonly<Record<string, number>> \| undefined` |
| canChangeVisibility | No | `((request: Readonly<{ axis: "row" \| "column"; indices: readonly number[]; hidden: boolean; }>) => boolean) \| undefined` |
| historyLimits | No | `GridHistoryLimits \| undefined` |
