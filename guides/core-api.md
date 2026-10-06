# Core API signatures

Source-preview catalog generated from the exported TypeScript GridEngine type. Use the package guide for behavior/examples; do not copy source-only members into an npm 0.1.0 application. Coordinates are zero-based visible indices unless a contract states otherwise.

[Package guide](../packages/core/README.md) · [Version policy](versions.md)

## Data and lifecycle

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

### sourceRowCount

```ts
sourceRowCount: number
```



### getRowId

```ts
getRowId: (row: number) => RowId
```



### columns

```ts
columns: readonly Readonly<{ permissions?: CellPermissionPolicy; defaultValue?: unknown; key: string; title: string; editable?: boolean; parse?: (text: string) => unknown; validate?: (value: unknown) => string | undefined; invalidInput?: "reject" | "allow"; }>[]
```



### rowCount

```ts
rowCount: number
```



### getValue

```ts
getValue: (row: number, key: string) => unknown
```



### editCell

```ts
editCell: (row: number, col: number, text: string) => void
```

Editor-style text command: applies parsers, editable/writable permissions and validation.

### updateCells

```ts
updateCells: (updates: readonly CellUpdate[]) => void
```

Typed values; no parsing. Column validation and writable permissions run before one atomic write. Uses visible indices.

### replaceText

```ts
replaceText: (search: string, replacement: string, options?: { readonly scope?: "view" | "selection"; readonly caseSensitive?: boolean; }) => Readonly<{ changedCells: number; matches: number; }>
```

Source-only bounded literal replacement. One undo command; permission/validation failures leave the batch unchanged.

### destroy

```ts
destroy: () => void
```

Release this instance. Idempotent; host-owned sources and external subscriptions still need host cleanup.

## Selection and clipboard

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



### select

```ts
select: (row: number, col: number, extend?: boolean) => boolean
```



### selectRange

```ts
selectRange: (range: SelectionRange, mode?: "replace" | "add" | "extend") => boolean
```



### clearSelection

```ts
clearSelection: () => void
```



### cutSelectionBlocks

```ts
cutSelectionBlocks: () => string
```



### cancelCut

```ts
cancelCut: () => void
```



### pasteCutSelectionBlocks

```ts
pasteCutSelectionBlocks: (text: string) => void
```



### copySelectionBlocks

```ts
copySelectionBlocks: () => string
```



### pasteSelectionBlocks

```ts
pasteSelectionBlocks: (text: string) => void
```



### copySelection

```ts
copySelection: () => string
```

TSV text through copy permissions. No direct operating-system clipboard access in core.

### paste

```ts
paste: (text: string) => void
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

### canUndo

```ts
canUndo: () => boolean
```



### canRedo

```ts
canRedo: () => boolean
```



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

### setView

```ts
setView: (next: LocalViewOptions) => void
```

Set local sort/filter criteria, not a server query. Structural commands require clearing the projected view.

### view

```ts
view: Readonly<LocalViewOptions>
```



### exportConfiguration

```ts
exportConfiguration: () => GridConfiguration
```

JSON-safe column order/widths, frozen counts and core-owned view; excludes data, callbacks and history.

## Structure and groups

### getMergedCells

```ts
getMergedCells: () => readonly Readonly<{ startRow: number; endRow: number; startColumn: number; endColumn: number; }>[]
```



### getMerge

```ts
getMerge: (row: number, col: number) => Readonly<{ startRow: number; endRow: number; startColumn: number; endColumn: number; }> | null
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
getRowGroups: () => readonly Readonly<{ id: string; startRow: number; endRow: number; collapsed: boolean; }>[]
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
insertColumns: (index: number, added: readonly Column[]) => void
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

### getCellPermission

```ts
getCellPermission: (row: number, col: number) => CellPermission
```



### getFormat

```ts
getFormat: (row: number, col: number) => Readonly<CellFormat>
```



### canFormat

```ts
canFormat: (targets: readonly CellFormatTarget[]) => boolean
```



### format

```ts
format: (targets: readonly CellFormatTarget[], patch: CellFormatPatch | null) => void
```



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



## Layout and browser controls

### frozenRows

```ts
frozenRows: number
```



### frozenColumns

```ts
frozenColumns: number
```



### getViewport

```ts
getViewport: (viewport: ViewportOptions) => Readonly<{ hitTest(x: number, y: number): { row: number; col: number; } | null; cellRect(row: number, col: number): Readonly<{ x: number; y: number; width: number; height: number; clip: Readonly<{ x: number; y: number; width: number; height: number; }>; }>; width: number; height: number; scrollLeft: number; scrollTop: number; frozenWidth: number; frozenHeight: number; regions: readonly ViewportRegion[]; }>
```



### canChangeLayout

```ts
canChangeLayout: (request: LayoutRequest) => boolean
```



### getRowSourceIndex

```ts
getRowSourceIndex: (row: number) => number
```



### rows

```ts
rows: Readonly<{ size: (i: number) => number; position: (i: number) => number; indexAt: (offset: number) => number; range: (offset: number, extent: number) => { start: number; end: number; }; }>
```



### columnsLayout

```ts
columnsLayout: Readonly<{ size: (index: number) => number; position: (index: number) => number; indexAt: (offset: number) => number; range: (offset: number, extent: number) => { start: number; end: number; }; }>
```



### canChangeStructure

```ts
canChangeStructure: (request: Readonly<StructureRequest>) => boolean
```



### isRowHeightManual

```ts
isRowHeightManual: (index: number) => boolean
```



### measureRowHeight

```ts
measureRowHeight: (index: number, size: number) => void
```



### canEdit

```ts
canEdit: (row: number, col: number) => boolean
```



### canPaste

```ts
canPaste: () => boolean
```



### addSelection

```ts
addSelection: (row: number, col: number) => boolean
```



### setFrozen

```ts
setFrozen: (rows: number, columns: number) => void
```



### setColumnWidth

```ts
setColumnWidth: (index: number, size: number) => void
```



### setRowHeight

```ts
setRowHeight: (index: number, size: number) => void
```



## Construction options

Call createGridEngine with GridEngineOptions. Required fields are marked; options are read at construction unless the package guide specifies a runtime setter.

| Field | Required | Type |
| --- | --- | --- |
| onObserverError | No | `((error: unknown) => void) \| undefined` |
| allowMerging | No | `boolean \| undefined` |
| allowRowGrouping | No | `boolean \| undefined` |
| canChangeLayout | No | `((request: Readonly<LayoutRequest>) => boolean) \| undefined` |
| columns | Yes | `readonly Column[]` |
| view | No | `LocalViewOptions \| undefined` |
| canChangeStructure | No | `((request: Readonly<StructureRequest>) => boolean) \| undefined` |
| dataSource | Yes | `DataSource` |
| permissions | No | `Partial<CellPermission> \| undefined` |
| resolveCellPermission | No | `CellPermissionResolver \| undefined` |
| onEvent | No | `((event: GridEvent) => void) \| undefined` |
| rowHeight | No | `number \| undefined` |
| columnWidth | No | `number \| undefined` |
| columnWidths | No | `Readonly<Record<string, number>> \| undefined` |
| allowLockChanges | No | `boolean \| undefined` |
| frozenRows | No | `number \| undefined` |
| frozenColumns | No | `number \| undefined` |
| onInvalidate | No | `((change: GridInvalidation) => void) \| undefined` |
