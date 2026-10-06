# Canvas API signatures

Source-preview catalog generated from the exported TypeScript Grid type. Use the package guide for behavior/examples; do not copy source-only members into an npm 0.1.0 application. Coordinates are zero-based visible indices unless a contract states otherwise.

[Package guide](../packages/canvas/README.md) · [Version policy](versions.md)

## Data and lifecycle

### getValue

```ts
getValue: (rowIndex: number, columnKey: string) => unknown
```



### replaceText

```ts
replaceText: (search: string, replacement: string, options?: Parameters<GridEngine["replaceText"]>[2]) => ReturnType<GridEngine["replaceText"]>
```

Source-only bounded literal replacement. One undo command; permission/validation failures leave the batch unchanged.

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

### selectColumn

```ts
selectColumn: (index: number) => void
```



### selectRow

```ts
selectRow: (index: number) => void
```



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
| allowRowGrouping | No | `boolean \| undefined` |
| canChangeLayout | No | `((request: Readonly<LayoutRequest>) => boolean) \| undefined` |
| locale | No | `string \| undefined` |
| messages | No | `Readonly<Record<string, string>> \| undefined` |
| currency | No | `string \| undefined` |
| view | No | `LocalViewOptions \| undefined` |
| viewMode | No | `"core" \| "host" \| undefined` |
| onViewChange | No | `((view: LocalViewOptions) => void) \| undefined` |
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
| createEditor | No | `CellEditorFactory \| undefined` |
| onEditorMount | No | `((cell: Readonly<CellEditorInfo>, editor: CellEditor) => void \| (() => void)) \| undefined` |
| onObserverError | No | `((error: unknown) => void) \| undefined` |
| choiceEditor | No | `false \| ChoiceEditorOptions \| undefined` |
| motion | No | `boolean \| { readonly duration?: number; } \| undefined` |
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
| frozenRows | No | `number \| undefined` |
| frozenColumns | No | `number \| undefined` |
| resolveCellPermission | No | `CellPermissionResolver \| undefined` |
| onEvent | No | `((event: GridEvent) => void) \| undefined` |
| allowLockChanges | No | `boolean \| undefined` |
| columnWidths | No | `Readonly<Record<string, number>> \| undefined` |
| canChangeVisibility | No | `((request: Readonly<{ axis: "row" \| "column"; indices: readonly number[]; hidden: boolean; }>) => boolean) \| undefined` |
