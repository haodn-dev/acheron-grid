# Core API signatures

Source-preview catalog generated from the exported TypeScript GridEngine type. Use the package guide for behavior/examples; do not copy source-only members into an npm 0.1.0 application. Coordinates are zero-based visible indices unless a contract states otherwise.

[Package guide](../packages/core/README.md) · [Version policy](versions.md)

## Data and lifecycle

### subscribe

```ts
subscribe: (subscriber: { readonly onEvent?: (event: GridEvent) => void; readonly onInvalidate?: (change: GridInvalidation) => void; }) => () => void
```

Register independent event/invalidation observers. Returns an unsubscribe function; callbacks observe committed state and cannot perform nested mutations. Registration requires a live engine.

### takeObserverErrors

```ts
takeObserverErrors: () => unknown[]
```

Drain the bounded observer error queue without changing data or history. Observer failures do not roll back committed commands.

### captureRowIdentity

```ts
captureRowIdentity: () => readonly RowId[]
```

Capture source row IDs before an external structural change. This explicit operation scans every source row; call refreshData with the captured IDs afterward.

### refreshData

```ts
refreshData: (previousRowIds?: readonly RowId[] | "values") => void
```

Reconcile external source changes and clear history/pending cut. Values mode requires unchanged IDs/order/count; an ID snapshot enables remapping; without IDs row-dependent metadata is dropped.

### sourceRowCount

```ts
sourceRowCount: number
```

Number of source rows, before local filtering or collapsed groups. This differs from the visible rowCount.

### getRowId

```ts
getRowId: (row: number) => RowId
```

Resolve a visible row to its stable source ID. Invalid row indices are rejected by the source/mapping contract.

### columns

```ts
columns: readonly Readonly<{ permissions?: CellPermissionPolicy; defaultValue?: unknown; key: string; title: string; editable?: boolean; parse?: (text: string) => unknown; validate?: (value: unknown) => string | undefined; invalidInput?: "reject" | "allow"; }>[]
```

Frozen snapshots of the current column definitions in current display order. Application callbacks remain trusted code.

### rowCount

```ts
rowCount: number
```

Visible row count after local view and collapsed-group projection; use sourceRowCount for the unprojected count.

### getValue

```ts
getValue: (row: number, key: string) => unknown
```

Read a raw value using a visible row and column key. No parsing/formatting occurs; missing or unloaded values may be undefined according to the source contract.

### editCell

```ts
editCell: (row: number, col: number, text: string) => void
```

Editor-style text command: resolve visible coordinates, require editable/writable, parse and validate before committing. Supports setValue or atomic setValues.

### updateCells

```ts
updateCells: (updates: readonly CellUpdate[]) => void
```

Typed-value updates: resolve visible rows, validate and require writable, without editor parsing or editable checks. Duplicate cells use the last value. Multi-cell changes require atomic setValues.

### replaceText

```ts
replaceText: (search: string, replacement: string, options?: { readonly scope?: "view" | "selection"; readonly caseSensitive?: boolean; }) => Readonly<{ changedCells: number; matches: number; }>
```

Source-only bounded literal replacement of string values in the view or selection. Requires editable/writable and validation; one atomic undo command. It is not a regular-expression API.

### destroy

```ts
destroy: () => void
```

Idempotently release engine-owned observers, history and selection. The host still owns source destruction/transport. Data/layout commands and clipboard operations reject after destruction; undo/redo return false. Do not use retained read getters as a live engine after disposal.

## Selection and clipboard

### getSelection

```ts
getSelection: () => CellSelection | null
```

Current visible active cell, or null. It is not a source-coordinate address; use getRowSourceIndex when needed.

### getSelectionRange

```ts
getSelectionRange: () => SelectionRange | null
```

Current active visible range, or null. Other retained selection ranges are available through getSelectionRanges.

### getSelectionRanges

```ts
getSelectionRanges: () => SelectionRange[]
```

Visible selection ranges including retained ranges. Projection can split source ranges into multiple visible fragments; serialization has explicit fragment limits.

### select

```ts
select: (row: number, col: number, extend?: boolean) => boolean
```

Select a visible cell, or extend from the anchor when extend is true. Selectable policy can veto; returns whether selection changed.

### selectRange

```ts
selectRange: (range: SelectionRange, mode?: "replace" | "add" | "extend") => boolean
```

Select an inclusive visible rectangle with replace/add/extend semantics. Validate bounds, policies and projected fragmentation before changing selection.

### clearSelection

```ts
clearSelection: () => void
```

Clear active/retained selection and anchor, with selection invalidation/events when changed. Does not change values or create a value-history command.

### cutSelectionBlocks

```ts
cutSelectionBlocks: () => string
```

Stage a same-engine cut and return structured clipboard text. Data is not deleted until a successful matching paste commit.

### cancelCut

```ts
cancelCut: () => void
```

Cancel the staged cut without modifying data. It is harmless when no cut exists, including after disposal. Host clipboard ownership remains separate.

### pasteCutSelectionBlocks

```ts
pasteCutSelectionBlocks: (text: string) => void
```

Move a matching staged cut to the selected destination after complete validation/permissions/conflict preflight. A failed operation preserves source values.

### copySelectionBlocks

```ts
copySelectionBlocks: () => string
```

Return versioned structured clipboard text including supported formatting through copy permissions. Values use string clipboard encoding; fragment/cell/text limits apply.

### pasteSelectionBlocks

```ts
pasteSelectionBlocks: (text: string) => void
```

Decode and validate structured clipboard text, then preflight values/formats and commit atomically. Does not execute HTML or deserialize application callbacks.

### copySelection

```ts
copySelection: () => string
```

Return packed TSV through copy permissions. Core does not access the operating-system clipboard; cell/fragment/text limits apply.

### paste

```ts
paste: (text: string) => void
```

Parse TSV/editor text, resolve selected destinations and preflight parsing, permissions and validation before one atomic write.

## History

### undo

```ts
undo: () => boolean
```

Replay the most recent command under current identity/value/permission checks. Return false when no command exists; conflicts can reject without changing history/data.

### redo

```ts
redo: () => boolean
```

Replay a previously undone command under current identity/value/permission checks. A new committed command clears redo; refresh clears both stacks.

### canUndo

```ts
canUndo: () => boolean
```

Whether a live engine has an undo entry. This is not a guarantee that current policies/identities/values will permit replay.

### canRedo

```ts
canRedo: () => boolean
```

Whether a live engine has a redo entry. Replay still checks current policies and conflicts.

## Views and persistence

### exportState

```ts
exportState: () => GridState
```

Export versioned domain UI state and selection/metadata. Excludes source data, callback policies, transport and history; identity capture can scan source rows.

### restoreState

```ts
restoreState: (state: unknown) => void
```

Stage and validate unknown saved state, including current layout/structure/lock/format policies, before committing. Application callbacks/policies are never supplied by saved state.

### setView

```ts
setView: (next: LocalViewOptions) => void
```

Set a core-owned local sort/filter view; this scans local source data and is not a server query. Preserve stable source identities; clear projected views before structural commands.

### view

```ts
view: Readonly<LocalViewOptions>
```

Current immutable local sort/filter criteria. This does not represent a remote query or an arbitrary host projection.

### exportConfiguration

```ts
exportConfiguration: () => GridConfiguration
```

Export JSON-safe column order/widths, frozen counts and local view. Excludes data, callbacks, selection and undo history.

## Structure and groups

### getMergedCells

```ts
getMergedCells: () => readonly Readonly<{ startRow: number; endRow: number; startColumn: number; endColumn: number; }>[]
```

Return merge spans in source row coordinates. Use getMerge for a visible-cell lookup; merged metadata is separate from cell values.

### getMerge

```ts
getMerge: (row: number, col: number) => Readonly<{ startRow: number; endRow: number; startColumn: number; endColumn: number; }> | null
```

Find the merge containing a visible cell and return its visible bounds, or null. Source metadata uses getMergedCells.

### canMerge

```ts
canMerge: (range: SelectionRange) => boolean
```

Preflight an inclusive visible merge range against bounds, existing merges, projected view, feature flags and layout policies. No mutation occurs.

### mergeCells

```ts
mergeCells: (range: SelectionRange) => void
```

Create a permitted rectangular merge without combining or deleting raw values. Validate before changing metadata; participates in layout history.

### unmergeCells

```ts
unmergeCells: (range: SelectionRange) => void
```

Remove merges intersecting the requested visible range, subject to current layout policy. Underlying values are retained.

### getRowGroups

```ts
getRowGroups: () => readonly Readonly<{ id: string; startRow: number; endRow: number; collapsed: boolean; }>[]
```

Return nested manual row-group metadata in source coordinates. These are not computed group-by aggregations.

### groupRows

```ts
groupRows: (start: number, end: number) => string
```

Create a manual source-row group from inclusive source indices, subject to grouping/layout rules. Projected views must be cleared for this structural layout operation.

### ungroupRows

```ts
ungroupRows: (id: string) => void
```

Remove a manual group by ID under layout policy. This does not delete source rows.

### setGroupCollapsed

```ts
setGroupCollapsed: (id: string, collapsed: boolean) => void
```

Collapse/expand a manual group by ID, changing visible projection while preserving source rows. Current layout policy applies.

### insertColumns

```ts
insertColumns: (index: number, added: readonly Column[]) => void
```

Insert definitions before a current column index under structural policy; keys must be unique and the source must support initializing added fields.

### deleteColumns

```ts
deleteColumns: (indices: readonly number[]) => void
```

Remove specified current column indices under structural policy and remap related metadata. The source retains its row fields for history/restoration.

### insertRows

```ts
insertRows: (index: number, rows: readonly DataRow[]) => void
```

Insert DataRow snapshots before a source row index under structural policy. Requires atomic source splices and valid unique IDs; projected views must be cleared.

### deleteRows

```ts
deleteRows: (indices: readonly number[]) => void
```

Delete selected source row indices under structural policy, preserving full shallow row snapshots for undo. Requires source row snapshots/splices.

### moveRows

```ts
moveRows: (indices: readonly number[], beforeIndex: number) => void
```

Move source row indices before a source insertion position, preserving their relative order. Requires structural policy/source support and no projected view.

### moveColumns

```ts
moveColumns: (indices: readonly number[], beforeIndex: number) => void
```

Move current column indices before an insertion position, preserving their relative order and remapping metadata under structural policy.

## Permissions and formatting

### getCellPermission

```ts
getCellPermission: (row: number, col: number) => CellPermission
```

Resolve policy capabilities for a visible cell, including current locks and explicit false vetoes. writable does not prove that the source exposes a setter; canEdit checks setter support. Server authorization remains host-owned.

### getFormat

```ts
getFormat: (row: number, col: number) => Readonly<CellFormat>
```

Resolve supported formatting for a visible cell using sparse table/row/column/cell metadata. Raw source values are unchanged.

### canFormat

```ts
canFormat: (targets: readonly CellFormatTarget[]) => boolean
```

Preflight visible format targets against bounds and formatting policy. Format permission is independent of value writable permission.

### format

```ts
format: (targets: readonly CellFormatTarget[], patch: CellFormatPatch | null) => void
```

Apply or remove supported formatting on visible targets after complete validation/policy checks. Participates in formatting history; does not change source values.

### isLocked

```ts
isLocked: (target: CellLockTarget) => boolean
```

Check the requested visible table/row/column/cell lock target. Lock metadata is a client capability constraint, not backend authorization.

### canManageLocks

```ts
canManageLocks: () => boolean
```

Whether lock management is enabled for the engine. Target validation and command lifecycle still apply when changing locks.

### setLocked

```ts
setLocked: (target: CellLockTarget, locked: boolean) => void
```

Set or clear a validated visible lock target when lock changes are allowed. Value commands and history replay resolve current effective locks.

## Layout and browser controls

### frozenRows

```ts
frozenRows: number
```

Visible frozen leading row count after projection/group collapse, derived from the source frozen prefix.

### frozenColumns

```ts
frozenColumns: number
```

Current frozen leading column count. Freeze boundaries must fit the current structure.

### getViewport

```ts
getViewport: (viewport: ViewportOptions) => Readonly<{ hitTest(x: number, y: number): { row: number; col: number; } | null; cellRect(row: number, col: number): Readonly<{ x: number; y: number; width: number; height: number; clip: Readonly<{ x: number; y: number; width: number; height: number; }>; }>; width: number; height: number; scrollLeft: number; scrollTop: number; frozenWidth: number; frozenHeight: number; regions: readonly ViewportRegion[]; }>
```

Compute numeric scroll/frozen pane ranges, cell geometry and hit-testing for the visible layout. It does not load remote pages or prove renderer frame rate.

### canChangeLayout

```ts
canChangeLayout: (request: LayoutRequest) => boolean
```

Preflight a source-coordinate layout request against feature flags and current layout policy. A permission probe is not a committed command.

### getRowSourceIndex

```ts
getRowSourceIndex: (row: number) => number
```

Map a visible row index to its source row index. Use this explicitly at host/source boundaries; do not pass visible indices directly to a projected source.

### rows

```ts
rows: Readonly<{ size: (i: number) => number; position: (i: number) => number; indexAt: (offset: number) => number; range: (offset: number, extent: number) => { start: number; end: number; }; }>
```

Read-only visible-row size/position/indexAt/range geometry. Sparse overrides do not allocate metadata for every source row.

### columnsLayout

```ts
columnsLayout: Readonly<{ size: (index: number) => number; position: (index: number) => number; indexAt: (offset: number) => number; range: (offset: number, extent: number) => { start: number; end: number; }; }>
```

Read-only current column size/position/indexAt/range geometry. Numeric viewport boundaries are end-exclusive; selection rectangles are inclusive.

### canChangeStructure

```ts
canChangeStructure: (request: Readonly<StructureRequest>) => boolean
```

Preflight a source-coordinate structural request against current view, source support, locks and policy. No mutation occurs.

### isRowHeightManual

```ts
isRowHeightManual: (index: number) => boolean
```

Whether a visible row has an explicit manual height override. Automatic measurement does not mark a row as manually resized.

### measureRowHeight

```ts
measureRowHeight: (index: number, size: number) => void
```

Apply a finite positive measured height to a visible row through layout policy, without adding a manual resize history entry.

### canEdit

```ts
canEdit: (row: number, col: number) => boolean
```

Preflight edit capability for a visible cell, including source setter support and effective editable/writable permission. Actual parsing/validation can still reject an edit.

### canPaste

```ts
canPaste: () => boolean
```

Whether current selection/source permissions permit paste in principle. Payload shape, bounds, parsing and validation are checked by the actual paste command.

### addSelection

```ts
addSelection: (row: number, col: number) => boolean
```

Retain the existing selection and add a visible active cell. Subject to selectable policy and range/fragment limits.

### setFrozen

```ts
setFrozen: (rows: number, columns: number) => void
```

Set the requested visible leading row/column counts after validation/layout policy; collapsed groups map the row prefix to source coordinates. Participates in layout history; collapsed groups cannot cross a frozen boundary.

### setColumnWidth

```ts
setColumnWidth: (index: number, size: number) => void
```

Set a finite positive current column width under layout policy, with sparse geometry and undo/redo.

### setRowHeight

```ts
setRowHeight: (index: number, size: number) => void
```

Set a finite positive visible row height under layout policy, mark it manual and record layout history.

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

## Public exports and source interfaces

The root and headless alias expose the same API. Source interfaces use their own row indices, not an engine visible projection. The table lists every public export, including types; declarations and the package guide define their contracts. Async/live sources remain read-only.

| Export | Kind | Defined in | Contract |
| --- | --- | --- | --- |
| createGridEngine | Runtime | engine.ts | Create the headless domain instance from application-owned columns/source/policies. See the member contracts and construction options above. |
| GridEngine | Type | engine.ts | Compile-time contract; see the exported type definitions below or engine construction/member signatures. |
| GridEngineOptions | Type | engine.ts | Compile-time contract; see the exported type definitions below or engine construction/member signatures. |
| GridInvalidation | Type | engine.ts | Compile-time contract; see the exported type definitions below or engine construction/member signatures. |
| LocalDataSource | Runtime | data-source.ts | Shallow immutable local row snapshots with unique string/finite-number IDs, synchronous atomic batches and sequential atomic splices. Nested objects remain host-owned. |
| LocalDataView | Runtime | data-source.ts | A fixed local projection using stable ties and nullish-last sorting. Delegated writes map view indices to underlying source indices; reconstruct the view to reapply criteria. |
| createAsyncDataSource | Runtime | async-data-source.ts | Read-only synchronous cache with explicit asynchronous page/range loading. The host owns load scheduling, AbortController creation, engine refresh and dataset revision consistency. |
| createLiveDataSource | Runtime | live-data-source.ts | Read-only bounded local cache of a host stream. Start with a matching snapshot; receive consecutive sequences, coalesce pending cells and flush explicitly. Gaps/disconnect require resync. |
| LiveUpdate | Type | live-data-source.ts | Compile-time contract; see the exported type definitions below or engine construction/member signatures. |
| LiveSnapshot | Type | live-data-source.ts | Compile-time contract; see the exported type definitions below or engine construction/member signatures. |
| AsyncDataSourceOptions | Type | async-data-source.ts | Compile-time contract; see the exported type definitions below or engine construction/member signatures. |
| PageState | Type | async-data-source.ts | Compile-time contract; see the exported type definitions below or engine construction/member signatures. |
| DataSource | Type | data-source.ts | Compile-time contract; see the exported type definitions below or engine construction/member signatures. |
| CellUpdate | Type | data-source.ts | Compile-time contract; see the exported type definitions below or engine construction/member signatures. |
| RowId | Type | data-source.ts | Compile-time contract; see the exported type definitions below or engine construction/member signatures. |
| LocalViewOptions | Type | data-source.ts | Compile-time contract; see the exported type definitions below or engine construction/member signatures. |
| DataRow | Type | data-source.ts | Compile-time contract; see the exported type definitions below or engine construction/member signatures. |
| RowSplice | Type | data-source.ts | Compile-time contract; see the exported type definitions below or engine construction/member signatures. |
| Column | Type | types.ts | Compile-time contract; see the exported type definitions below or engine construction/member signatures. |
| CellSelection | Type | types.ts | Compile-time contract; see the exported type definitions below or engine construction/member signatures. |
| SelectionRange | Type | types.ts | Compile-time contract; see the exported type definitions below or engine construction/member signatures. |
| CellLockTarget | Type | types.ts | Compile-time contract; see the exported type definitions below or engine construction/member signatures. |
| CellFormatTarget | Type | types.ts | Compile-time contract; see the exported type definitions below or engine construction/member signatures. |
| CellFormat | Type | types.ts | Compile-time contract; see the exported type definitions below or engine construction/member signatures. |
| CellFormatPatch | Type | types.ts | Compile-time contract; see the exported type definitions below or engine construction/member signatures. |
| CellPermission | Type | permissions.ts | Compile-time contract; see the exported type definitions below or engine construction/member signatures. |
| CellPermissionPolicy | Type | permissions.ts | Compile-time contract; see the exported type definitions below or engine construction/member signatures. |
| CellPermissionResolver | Type | permissions.ts | Compile-time contract; see the exported type definitions below or engine construction/member signatures. |
| GridEvent | Type | events.ts | Compile-time contract; see the exported type definitions below or engine construction/member signatures. |
| GridChangeSource | Type | events.ts | Compile-time contract; see the exported type definitions below or engine construction/member signatures. |
| ViewportOptions | Type | panes.ts | Compile-time contract; see the exported type definitions below or engine construction/member signatures. |
| ViewportLayout | Type | panes.ts | Compile-time contract; see the exported type definitions below or engine construction/member signatures. |
| ViewportRegion | Type | panes.ts | Compile-time contract; see the exported type definitions below or engine construction/member signatures. |
| ViewportRect | Type | panes.ts | Compile-time contract; see the exported type definitions below or engine construction/member signatures. |
| reorderedIndices | Runtime | structure.ts | Validate move indices/insertion position and return a new index order preserving relative order. It does not mutate rows, permissions or history. |
| StructureRequest | Type | structure.ts | Compile-time contract; see the exported type definitions below or engine construction/member signatures. |
| gridClipboardType | Runtime | clipboard.ts | MIME identifier for the internal versioned structured clipboard format. TSV remains the external plain-text fallback. |
| encodeBlocks | Runtime | clipboard.ts | Validate clipboard block shape/limits and serialize string values plus supported formatting to the versioned wire payload. This is not an arbitrary object codec. |
| decodeBlocks | Runtime | clipboard.ts | Parse unknown structured clipboard text and validate schema, dimensions, supported formatting and budgets before use. It does not write to a source. |
| blocksToTsv | Runtime | clipboard.ts | Pack structured string blocks into TSV. Core command wrappers additionally enforce effective copy permissions; direct helper calls have no engine authorization context. |
| ClipboardBlock | Type | clipboard.ts | Compile-time contract; see the exported type definitions below or engine construction/member signatures. |
| RowGroup | Type | types.ts | Compile-time contract; see the exported type definitions below or engine construction/member signatures. |
| LayoutRequest | Type | types.ts | Compile-time contract; see the exported type definitions below or engine construction/member signatures. |
| restoreGridConfiguration | Runtime | configuration.ts | Validate unknown versioned configuration against application column definitions and row count; return construction options. Saved input cannot supply executable callbacks/policies. |
| GridConfiguration | Type | configuration.ts | Compile-time contract; see the exported type definitions below or engine construction/member signatures. |
| GridState | Type | state.ts | Compile-time contract; see the exported type definitions below or engine construction/member signatures. |

### LocalDataSource source members

Use source indices here; engine selection/value APIs use visible indices.

```ts
getRowCount: () => number
getRowId: (index: number) => RowId
getValue: (index: number, columnKey: string) => unknown
setValue: (index: number, columnKey: string, value: unknown) => void
setValues: (updates: readonly CellUpdate[]) => void
addColumns: (keys: readonly string[], defaults?: Readonly<Record<string, unknown>>) => void
getRow: (index: number) => DataRow
spliceRows: (splices: readonly RowSplice[]) => void
```

| Source member | Behavior |
| --- | --- |
| getRowCount | Synchronous row count of this source/view. Engine projection is a separate layer. |
| getRowId | Read the ID using this source/view index. Async positional identity belongs to one query; the host must manage dataset revisions. |
| getValue | Read a raw shallow value using this source/view index and key. Missing fields return undefined; async unloaded rows also return undefined, so inspect page state separately. |
| setValue | Local atomic single-value replacement, or an optional delegated view setter when the underlying source supports it. No engine permissions/history are applied by direct source writes. |
| setValues | Local atomic batch, or an optional mapped view batch when the underlying source supports it. Direct source changes require engine refresh and remain outside engine history. |
| addColumns | Validate new keys and initialize missing fields atomically while preserving existing fields/defaults. Direct use is outside engine history. |
| getRow | Return a shallow row snapshot including hidden fields; nested values are caller-owned. |
| spliceRows | Apply sequential row splices atomically with unique valid IDs and shallow snapshots. Capture engine IDs before external structure changes. |

### LocalDataView source members

Use source indices here; engine selection/value APIs use visible indices. This view fixes a projection at construction; rebuild it to reapply criteria.

```ts
setValue?: ((index: number, key: string, value: unknown) => void) | undefined
setValues?: ((updates: readonly CellUpdate[]) => void) | undefined
getSourceIndex: (index: number) => number
getRowCount: () => number
getRowId: (index: number) => RowId
getValue: (index: number, columnKey: string) => unknown
```

| Source member | Behavior |
| --- | --- |
| setValue | Local atomic single-value replacement, or an optional delegated view setter when the underlying source supports it. No engine permissions/history are applied by direct source writes. |
| setValues | Local atomic batch, or an optional mapped view batch when the underlying source supports it. Direct source changes require engine refresh and remain outside engine history. |
| getSourceIndex | Map a fixed LocalDataView index to the underlying source index. Rebuild the view after changes requiring new sorting/filtering. |
| getRowCount | Synchronous row count of this source/view. Engine projection is a separate layer. |
| getRowId | Read the ID using this source/view index. Async positional identity belongs to one query; the host must manage dataset revisions. |
| getValue | Read a raw shallow value using this source/view index and key. Missing fields return undefined; async unloaded rows also return undefined, so inspect page state separately. |

### createAsyncDataSource source members

Use source indices here; engine selection/value APIs use visible indices.

```ts
pageSize: number
maxConcurrentLoads: number
maxPendingLoads: number
query: Readonly<LocalViewOptions>
setQuery: (next: LocalViewOptions, rowCount?: number) => void
loadPage: (offset: number) => Promise<void>
loadRange: (start: number, end: number) => Promise<void>
getPageState: (offset: number) => PageState | null
subscribe: (listener: (state: PageState) => void) => () => void
takeObserverErrors: () => unknown[]
cancel: () => void
reset: (rowCount?: number) => void
destroy: () => void
getRowCount: () => number
getRow?: ((index: number) => DataRow) | undefined
addColumns?: ((keys: readonly string[], defaults?: Readonly<Record<string, unknown>>) => void) | undefined
spliceRows?: ((splices: readonly RowSplice[]) => void) | undefined
getRowId: (index: number) => RowId
getValue: (index: number, columnKey: string) => unknown
setValue?: ((index: number, columnKey: string, value: unknown) => void) | undefined
setValues?: ((updates: readonly CellUpdate[]) => void) | undefined
```

| Source member | Behavior |
| --- | --- |
| pageSize | Validated positive page length fixed at construction; loadPage offsets must be aligned. |
| maxConcurrentLoads | Maximum active loader calls; a canceled loader must settle so its active slot can be released. |
| maxPendingLoads | Maximum active plus queued loads. Duplicate pages share a promise; admission failures occur before scheduling extra work. |
| query | Immutable captured server criteria. Each load receives the snapshot for its generation; this is not local sorting of cached rows. |
| setQuery | Validate new criteria/count, clear cache/statuses and cancel the previous generation. The host must reconcile the engine and identity after a query change. |
| loadPage | Load one aligned nonnegative offset with deduplication/FIFO concurrency. Validate result dimensions; errors reject, canceled/stale results do not repopulate cache. |
| loadRange | Load inclusive source indices start through end. The requested pages must fit the cache and pending capacity before admission. |
| getPageState | Return state for a page offset or null; error/ready bookkeeping is bounded and eviction can remove it. This is not a per-cell loaded-state API. |
| subscribe | Observe page state changes; returns unsubscribe. Observer exceptions are isolated in a bounded queue; engine refresh is host-owned. |
| takeObserverErrors | Drain up to the last ten isolated page observer errors. This does not retry failed loads. |
| cancel | Invalidate the request generation and signal pending controllers without clearing completed cache/count. Safe cleanup after disposal; loaders must settle/timeout. |
| reset | Async: clear cache/statuses and cancel generation, retaining query with the supplied count. Live: change stream, clear pending changes and mark stale; retain old data until a matching snapshot. |
| destroy | Idempotent disposal of owned cache/queues/observers. Data access and active loads require a live source; cleanup/status probes follow their specific contract. The host owns external transport resources. |
| getRowCount | Synchronous row count of this source/view. Engine projection is a separate layer. |
| getRow | Optional DataSource compatibility slot; not implemented by this read-only factory and undefined at runtime. |
| addColumns | Optional DataSource compatibility slot; not implemented by this read-only factory and undefined at runtime. |
| spliceRows | Optional DataSource compatibility slot; not implemented by this read-only factory and undefined at runtime. |
| getRowId | Read the ID using this source/view index. Async positional identity belongs to one query; the host must manage dataset revisions. |
| getValue | Read a raw shallow value using this source/view index and key. Missing fields return undefined; async unloaded rows also return undefined, so inspect page state separately. |
| setValue | Optional DataSource compatibility slot; not implemented by this read-only factory and undefined at runtime. |
| setValues | Optional DataSource compatibility slot; not implemented by this read-only factory and undefined at runtime. |

### createLiveDataSource source members

Use source indices here; engine selection/value APIs use visible indices.

```ts
streamId: string
sequence: number
stale: boolean
pendingCellCount: number
reset: (next: string) => void
disconnect: () => void
replaceSnapshot: (snapshot: LiveSnapshot) => boolean
receive: (message: LiveUpdate) => boolean
flush: () => number
destroy: () => void
getRowCount: () => number
getRow?: ((index: number) => DataRow) | undefined
addColumns?: ((keys: readonly string[], defaults?: Readonly<Record<string, unknown>>) => void) | undefined
spliceRows?: ((splices: readonly RowSplice[]) => void) | undefined
getRowId: (index: number) => RowId
getValue: (index: number, columnKey: string) => unknown
setValue?: ((index: number, columnKey: string, value: unknown) => void) | undefined
setValues?: ((updates: readonly CellUpdate[]) => void) | undefined
```

| Source member | Behavior |
| --- | --- |
| streamId | Current host stream identifier; messages/snapshots for another stream are ignored. |
| sequence | Latest accepted sequence, including buffered updates not yet flushed. It is not a saved backend revision. |
| stale | Whether a fresh snapshot is required. Read-only retained values can still exist while stale; do not treat them as current. |
| pendingCellCount | Number of unique buffered destination cells after bounded coalescing; not the count of received messages. |
| reset | Async: clear cache/statuses and cancel generation, retaining query with the supplied count. Live: change stream, clear pending changes and mark stale; retain old data until a matching snapshot. |
| disconnect | Mark the live source stale and discard buffered updates; does not itself reconnect transport or remove retained rows. |
| replaceSnapshot | Validate a matching-stream snapshot with bounded rows, unique IDs and configured fields, then atomically replace the local cache. Reject older/wrong-stream snapshots without installing them. |
| receive | Accept only matching-stream consecutive sequences when not stale; coalesce cells without writing them yet. Gaps, invalid destinations or capacity overflow mark stale and clear pending changes. |
| flush | Apply buffered live changes atomically and return the number of unique updated cells. Returns zero while stale; the host refreshes the engine after flushing. |
| destroy | Idempotent disposal of owned cache/queues/observers. Data access and active loads require a live source; cleanup/status probes follow their specific contract. The host owns external transport resources. |
| getRowCount | Synchronous row count of this source/view. Engine projection is a separate layer. |
| getRow | Optional DataSource compatibility slot; not implemented by this read-only factory and undefined at runtime. |
| addColumns | Optional DataSource compatibility slot; not implemented by this read-only factory and undefined at runtime. |
| spliceRows | Optional DataSource compatibility slot; not implemented by this read-only factory and undefined at runtime. |
| getRowId | Read the ID using this source/view index. Async positional identity belongs to one query; the host must manage dataset revisions. |
| getValue | Read a raw shallow value using this source/view index and key. Missing fields return undefined; async unloaded rows also return undefined, so inspect page state separately. |
| setValue | Optional DataSource compatibility slot; not implemented by this read-only factory and undefined at runtime. |
| setValues | Optional DataSource compatibility slot; not implemented by this read-only factory and undefined at runtime. |

## Exported type definitions

These declaration excerpts describe compile-time contracts, not executable examples or runtime validators. GridEngine members and GridEngineOptions are catalogued above. Unknown persisted/clipboard input still requires its validation API; never trust a TypeScript assertion as validation.

### Type GridInvalidation

```ts
export type GridInvalidation =
  | { readonly type: 'cells'; readonly cells: readonly { readonly rowIndex: number; readonly columnKey: string }[] }
  | { readonly type: 'selection'; readonly changed: boolean; readonly rangeChanged: boolean }
  | { readonly type: 'layout' }
  | { readonly type: 'structure'; readonly rowMap: readonly number[]; readonly columnMap: readonly number[] };
```

### Type LiveUpdate

```ts
export interface LiveUpdate {
  readonly streamId: string;
  readonly sequence: number;
  readonly changes: readonly { readonly rowId: RowId; readonly columnKey: string; readonly value: unknown }[];
}
```

### Type LiveSnapshot

```ts
export interface LiveSnapshot { readonly streamId: string; readonly sequence: number; readonly rows: readonly DataRow[]; }
```

### Type AsyncDataSourceOptions

```ts
export interface AsyncDataSourceOptions<S> {
  readonly rowCount?: number;
  readonly pageSize?: number;
  readonly maxPages?: number;
  readonly maxConcurrentLoads?: number;
  readonly maxPendingLoads?: number;
  readonly query?: LocalViewOptions;
  readonly createAbortController: () => { readonly signal: S; abort(): void };
  readonly load: (request: { readonly offset: number; readonly limit: number; readonly signal: S; readonly query: Readonly<LocalViewOptions> }) => Promise<{ readonly rows: readonly Readonly<Record<string, unknown>>[]; readonly total: number }>;
  /** Stable positional identity within one server query; query changes invalidate identity. */
  readonly getRowId?: (index: number) => RowId;
}
```

### Type PageState

```ts
export interface PageState { readonly offset: number; readonly status: 'loading' | 'ready' | 'error'; readonly error?: unknown; }
```

### Type DataSource

```ts
export interface DataSource {
  getRowCount(): number;
  /** Full shallow row snapshot, including fields outside the visible columns. */
  getRow?(index: number): DataRow;
  /** Initialize missing fields atomically; existing hidden column values are retained. */
  addColumns?(keys: readonly string[], defaults?: Readonly<Record<string,unknown>>): void;
  /** Apply sequential splices atomically, preserving unique row IDs. */
  spliceRows?(splices: readonly RowSplice[]): void;
  getRowId(index: number): RowId;
  getValue(index: number, columnKey: string): unknown;
  setValue?(index: number, columnKey: string, value: unknown): void;
  /** Synchronous, atomic: either all writes succeed or none do. */
  setValues?(updates: readonly CellUpdate[]): void;
}
```

### Type CellUpdate

```ts
export interface CellUpdate { rowIndex: number; columnKey: string; value: unknown; }
```

### Type RowId

```ts
export type RowId = string | number;
```

### Type LocalViewOptions

```ts
export interface LocalViewOptions {
  readonly sort?: { readonly columnKey: string; readonly direction: 'asc' | 'desc' };
  readonly sorts?: readonly { readonly columnKey: string; readonly direction: 'asc' | 'desc' }[];
  readonly filters?: readonly { readonly columnKey: string; readonly query: string; readonly operator?: 'contains' | 'equals' | 'not-empty' | 'empty' }[];
}
```

### Type DataRow

```ts
export interface DataRow { readonly id: RowId; readonly values: Readonly<Record<string, unknown>>; }
```

### Type RowSplice

```ts
export interface RowSplice { readonly index: number; readonly deleteCount: number; readonly rows: readonly DataRow[]; }
```

### Type Column

```ts
export interface Column { defaultValue?: unknown; key: string; title: string; editable?: boolean; permissions?: CellPermissionPolicy; parse?: (text: string) => unknown; validate?: (value: unknown) => string | undefined; invalidInput?: 'reject' | 'allow'; }
```

### Type CellSelection

```ts
export interface CellSelection { rowIndex: number; rowId: RowId; columnIndex: number; columnKey: string; }
```

### Type SelectionRange

```ts
export interface SelectionRange { startRow: number; endRow: number; startColumn: number; endColumn: number; }
```

### Type CellLockTarget

```ts
export type CellLockTarget =
  | { readonly scope: 'table' }
  | { readonly scope: 'row'; readonly rowIndex: number }
  | { readonly scope: 'column'; readonly columnIndex: number }
  | { readonly scope: 'cell'; readonly rowIndex: number; readonly columnIndex: number };
```

### Type CellFormatTarget

```ts
export type CellFormatTarget = CellLockTarget | { readonly scope: 'range'; readonly range: Readonly<SelectionRange> };
```

### Type CellFormat

```ts
export interface CellFormat { readonly background?: string; readonly textColor?: string; readonly contentFormat?: 'plain' | 'html' | 'markdown'; readonly fontWeight?: 'normal' | 'bold'; readonly fontStyle?: 'normal' | 'italic'; }
```

### Type CellFormatPatch

```ts
export interface CellFormatPatch { readonly background?: string | null; readonly textColor?: string | null; readonly contentFormat?: 'plain' | 'html' | 'markdown' | null; readonly fontWeight?: 'normal' | 'bold' | null; readonly fontStyle?: 'normal' | 'italic' | null; }
```

### Type CellPermission

```ts
export interface CellPermission {
  readonly editable: boolean;
  readonly selectable: boolean;
  readonly copyable: boolean;
  readonly pasteable: boolean;
  readonly writable: boolean;
  readonly formatting: boolean;
}
```

### Type CellPermissionPolicy

```ts
export type CellPermissionPolicy = Partial<CellPermission>;
```

### Type CellPermissionResolver

```ts
export type CellPermissionResolver = (cell: Readonly<CellSelection>) => CellPermissionPolicy | undefined;
```

### Type GridEvent

```ts
export type GridEvent =
  | { readonly type: 'data:refresh'; readonly previousRowCount: number; readonly rowCount: number; readonly identitiesReconciled: boolean }
  | { readonly type: 'state:restore' }
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
```

### Type GridChangeSource

```ts
export type GridChangeSource = 'api' | 'edit' | 'paste' | 'undo' | 'redo';
```

### Type ViewportOptions

```ts
export interface ViewportOptions { width: number; height: number; scrollLeft: number; scrollTop: number; }
```

### Type ViewportLayout

```ts
export type ViewportLayout = ReturnType<typeof createViewport>;
```

### Type ViewportRegion

```ts
export interface ViewportRegion {
  readonly clip: ViewportRect;
  readonly rows: Readonly<{ start: number; end: number }>;
  readonly columns: Readonly<{ start: number; end: number }>;
  readonly offsetX: number;
  readonly offsetY: number;
}
```

### Type ViewportRect

```ts
export interface ViewportRect { readonly x: number; readonly y: number; readonly width: number; readonly height: number; }
```

### Type StructureRequest

```ts
export interface StructureRequest {
  readonly columns?: readonly Column[];
  readonly order?: readonly number[];
  readonly axis: 'row' | 'column';
  readonly kind: 'insert' | 'delete' | 'move';
  readonly indices: readonly number[];
  readonly beforeIndex: number;
  readonly count: number;
}
```

### Type ClipboardBlock

```ts
export interface ClipboardBlock { readonly row:number; readonly column:number; readonly values:readonly (readonly string[])[]; readonly formats?: readonly (readonly CellFormat[])[]; }
```

### Type RowGroup

```ts
export interface RowGroup { readonly id: string; readonly startRow: number; readonly endRow: number; readonly collapsed: boolean; }
```

### Type LayoutRequest

```ts
export type LayoutRequest = { readonly kind: 'merge' | 'unmerge'; readonly range: Readonly<SelectionRange> }
  | { readonly kind: 'group' | 'ungroup' | 'collapse' | 'expand'; readonly group: Readonly<RowGroup> };
```

### Type GridConfiguration

```ts
export interface GridConfiguration {
  readonly version: 1;
  readonly columns: readonly { readonly key: string; readonly width: number }[];
  readonly frozenRows: number;
  readonly frozenColumns: number;
  readonly view: LocalViewOptions;
}
```

### Type GridState

```ts
export interface GridState {
  readonly version: 1;
  readonly configuration: GridConfiguration;
  readonly rowIds: readonly RowId[];
  readonly rowHeights: readonly (readonly [number,number])[];
  readonly manualRows: readonly number[];
  readonly ranges: readonly SelectionRange[];
  readonly selection: Readonly<CellSelection> | null;
  readonly anchor: Readonly<CellSelection> | null;
  readonly activeParts?: number;
  readonly displayAnchor?: Readonly<{row:number;col:number}> | null;
  readonly merges: readonly SelectionRange[];
  readonly groups: readonly RowGroup[];
  readonly locks: readonly CellLockTarget[];
  readonly formats: readonly { readonly target: CellFormatTarget; readonly patch: CellFormatPatch }[];
}
```
