# @acheron-grid/core

Documentation revision 3 · npm 0.1.0 + explicitly marked source additions. See [documentation versions](../../guides/versions.md).


An experimental headless TypeScript data-grid engine. Core owns data access and controlled mutations, selection, layout, editing, TSV clipboard operations and history. The host owns source storage and transport. Core has no runtime dependencies or browser/framework types.

Use core for a custom renderer or headless data workflow. For a ready-made interactive grid, start with the [Canvas guide](https://acheron-grid.haoduong.dev/reference/canvas); React and Vue adapters are separate packages.

## Contents

- [Getting started](#getting-started)
- [Data and lifecycle](#data-and-lifecycle)
- [Selection and clipboard](#selection-and-clipboard)
- [Permissions and events](#permissions-and-events)
- [Layout and local views](#layout-and-local-views)
- [Persistence](#persistence)
- [Core contracts and practical limits](#core-contracts-and-practical-limits)
- [Browser import migration](#browser-import-migration)
- [License](#license)

## Getting started

### Installation

```sh
npm install @acheron-grid/core
```

Version 0.1.0 is available on npm as a development preview. APIs may change before 1.0. This package exports ESM JavaScript and TypeScript declarations.

### Building from source

From the engine repository root, use Node.js 22 or later:

```sh
npm ci
npm run build
npm run typecheck
npm test
```

Build runs core before Canvas and writes ESM JavaScript and TypeScript declarations to `dist/`. For local development, install the built package in another project:

```sh
npm install /path/to/acheron-grid-engine/packages/core
```

### Quick start

The root entry exports `createGridEngine`, `LocalDataSource`, `LocalDataView` and their public types. It runs in Node without DOM, Canvas or framework globals. The earlier @acheron-grid/core/headless subpath remains an alias. Browser rendering is provided by [@acheron-grid/canvas](https://acheron-grid.haoduong.dev/reference/canvas).

```js
import { createGridEngine, LocalDataSource } from '@acheron-grid/core';

const engine = createGridEngine({
  columns: [{ key: 'name', title: 'Name', editable: true }],
  dataSource: new LocalDataSource([{ id: 1, name: 'Ada' }], row => row.id),
});
engine.select(0, 0);
engine.editCell(0, 0, 'Grace');
engine.copySelection(); // 'Grace'; no system clipboard access
engine.undo();
engine.destroy();
```

The engine owns selection/anchor, sparse row/column layout, text parsing, TSV operations, data commands and delta history. The Canvas grid uses this same engine. Browser focus, scrolling, editor drafts, menus, dialogs, OS clipboard and frame scheduling stay in the browser layer.

An optional synchronous `onInvalidate(change)` renderer hook receives cells, selection, layout or structure notifications after committed state/history. These notifications describe repaint needs, separate from public domain events. The hook may query committed state; observer errors are isolated and reported through `onObserverError` or `takeObserverErrors()`. `destroy()` drops the hook and history, clears selection without notification and is idempotent. Mutations/copy/paste throw after destruction; undo/redo return false. As with the browser API, source values are shallow references and external source writes are outside history. Call `refreshData()` after external source changes; see [External data and lifecycle](#external-data-and-lifecycle).

Build/typecheck includes a separate ES2022-only TypeScript configuration with no DOM or ambient Node types. Unit tests also compile the headless dependency closure and verify it excludes browser modules.

## Data and lifecycle

### DataSource and mutation contracts

DataSource exposes synchronous getRowCount/getRowId/getValue and optional setValue/setValues. Row IDs remain stable through core-owned structure changes. LocalDataSource copies the row array and shallow row snapshots, with unique stable row IDs; nested values remain caller-owned.

updateCells accepts typed values and runs column validation and intentionally does not apply column parsers or the editor's editable flag. editCell and paste apply resolved editable/pasteable permissions and text parsers. All writes, including API updates and undo/redo, require writable permission. Batches with more than one changed cell require `setValues`; a source with only `setValue` can accept single-cell writes. Batch setters must be synchronous and atomic, leaving data unchanged on failure. Validation completes before writes. Duplicate updates use the last value, Object.is no-ops preserve history, and undo/redo retain at most 100 delta commands with shallow value references. External writes are outside history; replay rejects row identity/current value conflicts. Explicit resize and freeze changes share this history.

Clipboard processing is limited to 100,000 cells and 10 million UTF-16 code units. `createAsyncDataSource` provides explicit read-only async paging around a synchronous cache; async setters remain unsupported. React and Vue adapters live in separate packages. Multiple selection ranges support packed TSV and an internal structured clipboard payload.

### External data and lifecycle

```ts
import { createGridEngine, LocalDataSource } from '@acheron-grid/core';

const source = new LocalDataSource([{ id: 'r1', name: 'Ada' }], row => row.id);
const engine = createGridEngine({
  dataSource: source,
  columns: [{ key: 'name', title: 'Name', editable: true }],
  onObserverError: error => console.error('Grid observer failed', error),
});
const unsubscribe = engine.subscribe({
  onEvent: event => console.log(event.type),
  onInvalidate: change => console.log(change),
});

source.setValue(0, 'name', 'Grace');
engine.refreshData('values'); // Same row IDs, order and count.

const previousIds = engine.captureRowIdentity();
source.spliceRows([{ index: 0, deleteCount: 0, rows: [{ id: 'r2', values: { name: 'Lin' } }] }]);
engine.refreshData(previousIds); // Remap sparse state by stable IDs.

unsubscribe();
engine.destroy();
```

Capture IDs **before** a structural source change. This explicit operation scans all rows; engine construction does not. Reconciliation preserves valid selection, sizes, locks and formatting by ID, and drops groups/merges that cannot remain contiguous. With no previous IDs, `refreshData()` safely drops row-dependent state. All refresh modes clear undo/redo and pending cut state because external writes are outside history. `refreshData('values')` is a host guarantee that IDs, order and count did not change; use the identity snapshot for structural changes.

Source preview also drops a collapsed group when identity reconciliation moves it across the frozen boundary. Single-cell editing accepts sources exposing either `setValue` or atomic `setValues`; permissions, parsing, validation and history still apply.

Subscribers are independent and can unsubscribe during dispatch. Events observe committed state. Observer errors do not turn a successful mutation into a failed operation; `onObserverError` reports them and `takeObserverErrors()` drains the last ten recorded errors. Parser, permission and setter failures still fail the actual command. Notification callbacks can query state but cannot issue nested mutations.

### Async pages and cancellation

Request limits described below are unreleased source changes; published 0.1.0 consumers should continue to bound requests in the host until upgrading.

```ts
import { createAsyncDataSource, createGridEngine } from '@acheron-grid/core';

const source = createAsyncDataSource<AbortSignal>({
  pageSize: 100,
  maxPages: 10,
  maxConcurrentLoads: 4,
  maxPendingLoads: 100,
  createAbortController: () => new AbortController(),
  load: async ({ offset, limit, signal }) => {
    const response = await fetch(`/api/rows?offset=${offset}&limit=${limit}`, { signal });
    if (!response.ok) throw new Error(`Rows request failed: ${response.status}`);
    return await response.json(); // { rows: Record<string, unknown>[], total: number }
  },
});
const unsubscribe = source.subscribe(page => {
  // Render loading/error status in your application.
  console.log(page.offset, page.status, page.error);
});
await source.loadPage(0); // Discover total before creating the grid.
const engine = createGridEngine({
  dataSource: source,
  columns: [{ key: 'name', title: 'Name' }],
});

async function loadVisibleRows(first: number, last: number) {
  const previousIds = engine.captureRowIdentity();
  await source.loadRange(first, last); // Inclusive indices; window must fit maxPages.
  engine.refreshData(previousIds);
}
await loadVisibleRows(100, 199);

// Unmount: release both objects; destroying the grid does not own the source.
unsubscribe();
engine.destroy();
source.destroy();
```

`loadPage(offset)` requires a page-aligned offset. Requests for the same page share one promise; cached pages use bounded LRU eviction. Unloaded cell values are `undefined`. `getPageState(offset)` returns loading/ready/error state or null. Handle rejected promises in your UI; calling `loadPage` again retries a failed page. `cancel()` aborts pending requests; stale responses cannot populate the cache. `reset(total?)` cancels and clears pages while retaining the current query. After resetting, call `engine.refreshData()` to discard old row identity state.

The source is **read-only**. Writes still require synchronous atomic setters on a custom source; there is no remote save queue or optimistic rollback. Default identities are stable positions within one server query. Do not reuse positional identities across changed server ordering. The host owns server sorting/filtering, authorization and request validation. Local search/sort/filter only sees cached values; it is not a server-wide query. Injecting the abort controller keeps core free of DOM/Node ambient types.

The async source reads own row properties only. It retains at most `maxPages` successful pages and, separately, `maxPages` recent error states. `maxConcurrentLoads` (default 4) bounds unresolved loader calls; `maxPendingLoads` (default 100) bounds requested pages, including queued work. Both must be positive safe integers. Queued requests share the `loading` state and start in request order. Repeated requests for the same page share one promise, including while queued. Capacity overflow throws before admitting the new request; `loadRange` checks the entire range before starting any pages. Evicted error states return `null` from `getPageState`; calling `loadPage` can retry them.

Cancel/reset settles queued work without calling the loader and aborts running requests. Stale responses cannot populate the cache. Running requests keep their concurrency slots until the loader settles, even across reset; a loader that ignores abort and never settles can block later work. Host loaders should implement cancellation and a timeout. Async writes and backend query execution remain host-managed.

In Source preview, a successful response that changes `total` clears previously cached positional pages and their ready statuses. An offset beyond a shrinking total must return an empty `rows` array; it updates the count and can be requested again to discover growth. Refresh the engine after loading. Responses completing later in the same query generation can still report a different total: the host must supply a consistent dataset revision across pages or reset the query when the dataset changes. Equal totals do not prove stable row identity/order. Cache recency updates on page admission and cached `loadPage` calls; synchronous cell reads do not update recency.

### Server query snapshots (unreleased)

The source accepts initial `query: LocalViewOptions`. Its `query` getter exposes an immutable snapshot; every loader receives that snapshot as `request.query`. `setQuery(criteria, total = 0)` validates sort/filter criteria and row count before canceling old work and clearing cached pages/status. Each call starts a new generation, even for equal criteria. Invalid criteria leave the current source intact. `reset()` reloads the current query. These APIs are source previews and are not included in npm 0.1.0.

The host maps query criteria to authorized backend parameters and defines server collation. They do not filter the page cache locally. Keep an application revision guard for UI completions, because canceled old promises can settle after a newer query starts:

```ts
let revision = 0;
async function changeQuery(criteria: LocalViewOptions) {
  source.setQuery(criteria);
  const current = ++revision;
  engine.refreshData(); // Clear identity state belonging to the previous query.
  try {
    await source.loadPage(0);
    if (current === revision) engine.refreshData();
  } catch (error) {
    if (current === revision) throw error; // Host reports the current error.
  }
}
```

Import `LocalViewOptions` as a type from core. This supports read-only server sorting/filtering; it does not provide remote saves, live subscriptions or consistent dataset revision tokens across pages.

For a fixed editable local draft, see the [host-owned remote save example](../../examples/remote-save.md). It demonstrates revision checks, idempotent retry after an uncertain outcome, preserved newer edits and explicit rollback through engine history. It is a source integration example, not an async setter or a published remote-write adapter.

### Read-only live cache (unreleased)

`createLiveDataSource({streamId,columnKeys,maxRows:10000,maxPendingCells:10000})` exposes a synchronous read-only cache. Host transport supplies an authoritative `replaceSnapshot({streamId,sequence,rows})` with stable IDs and all configured fields. It then calls `receive({streamId,sequence,changes:[{rowId,columnKey,value}]})` for consecutive messages and `flush()` on its chosen schedule. Multiple updates to a cell coalesce to the last value; flush is atomic and returns the number of updated cells. Apply engine `permissions: {writable:false}` to disable edit/paste explicitly.

After replacing a snapshot, call `engine.refreshData()` to discard identity-dependent state. After a nonempty flush, call `engine.refreshData('values')`; live data is external source state, so this clears local value history. The cache does not create user-edit commands or enforce server authorization.

Duplicates and wrong-stream messages are ignored. A sequence gap, unknown row/column or queue overflow clears pending updates and sets `stale`; keep showing the last applied cache with a stale indicator, then fetch a new snapshot before receiving again. Snapshots cannot move the cursor backward. `disconnect()` marks stale; `reset(newUniqueStreamId)` invalidates the old subscription before resync. Host transport must guard late responses and use a new stream ID for each query/reconnect generation. The source does not start timers or network connections. `destroy()` releases its cache and rejects later operations.

Snapshots are O(rows × configured columns); rows and pending cells are bounded independently. Values are shallow snapshots, so nested values remain caller-owned. Inserts, deletes and sort-membership changes require a fresh snapshot; remote paged live editing, automatic reconnect, durable storage and collaborative editing are not included. The builder's live sample is simulated, not a server connection.

## Selection and clipboard

### Bounded literal find and replace (unreleased)

`engine.replaceText(search,replacement,{scope:'view',caseSensitive:true})` replaces string values in the current visible view; use `scope:'selection'` for the selected ranges. Matching and replacement are literal, including `$` sequences; user regex patterns are not executed. It reports `{changedCells,matches}`. Numeric/media values are retained. Changed cells must be editable and writable and pass column validation. The batch is one atomic history command and reuses local-view refresh and typed cell events.

Processing is limited to 100,000 scanned cells, 10 million UTF-16 units of input/output text, 1,000 units of search text and 10,000 units of replacement. Expansion is checked before constructing oversized results. Empty search/selection and invalid options are rejected. This is local synchronous replacement, not server-wide search. Canvas exposes the same `replaceText` method; finish/cancel an editor draft before replacing.

### Multiple sort keys (unreleased)

`engine.setView({ sorts: [{ columnKey: 'team', direction: 'asc' }, { columnKey: 'score', direction: 'desc' }] })` applies keys in priority order. The existing `sort` object remains supported; use either `sort` or `sorts`, with no duplicate column keys. Empty `sorts` clears sorting. Nullish values stay last for both directions, and equal keys retain source order. Sorting/filtering move outline blocks together and reapply after edits/history. Criteria are isolated from caller mutations and included in state/configuration round-trips.

Canvas accepts the same criteria through `view`/`setView`; headers describe all sorted columns. Its built-in single-column sort dialog replaces the multi-sort criteria. A host can provide controls for changing multi-sort priority. Local sorting reads all matching rows; it does not implement server-side ordering for remote datasets.

### Selection queries and navigation

`select(rowIndex, columnIndex, extend?)` rejects invalid coordinates and returns whether selection changed; denied targets return false; `clearSelection()` clears the range. `getSelection()` and `getSelectionRange()` return copies for the active cell/range. `addSelection(rowIndex, columnIndex)` retains earlier rectangles and starts a new active range. `getSelectionRanges()` returns copies in insertion order, active range last. Extending changes only that last range; plain select replaces all ranges. Selection is bounded to 128 rectangles, allows overlaps and does not allocate per selected cell. `rows` and `columnsLayout` expose read-only `size`, `position`, `indexAt` and `range` geometry queries; mutations use `setRowHeight` and `setColumnWidth`. Columns are frozen snapshots. `getValue`, `canEdit`, `canPaste`, `canUndo` and `canRedo` provide queries. `editCell(rowIndex, columnIndex, text)` applies the same editable/parser rules as the DOM editor; `updateCells` retains its programmatic, already-validated-value semantics. `canPaste` checks the starting cell and write capability; `paste` validates the entire rectangle before writing.

### Explicit rectangular selection

`engine.selectRange({startRow, endRow, startColumn, endColumn}, mode?)` accepts `'replace'` (default), `'add'` or `'extend'`. Replace discards existing ranges; add retains the previous active range; extend updates the active rectangle while keeping retained ranges. The 128-range cap applies atomically to add. It updates selection atomically and emits at most one selection event. Bounds are inclusive safe integer coordinates. Start and end cells must both be selectable; interior checks remain operation-specific. The active cell is the start corner, anchor the end corner. This is sparse and reads no source values, even for a whole million-row column. Invalid input or denied endpoints preserve prior selection. Plain navigation returns to its normal single-cell behavior.

### Multiple-range clipboard

`copySelection()` packs ranges in reading order: ranges sharing their top row and height concatenate horizontally; others stack vertically and pad to the widest range. `paste(text)` broadcasts the TSV matrix at each target range start. `copySelectionBlocks()` / `pasteSelectionBlocks(text)` preserve relative offsets and gaps for one target, or pair equal counts of source/target ranges. Conflicting overlap, malformed payloads, bounds, limits, permissions and parsing failures are rejected before one atomic write/history command. Editing and history operate on the active cell/data, preserving the range list. Clear/destroy discard all ranges. Selectable permission still checks only target endpoints.

Structured clipboard blocks can carry optional per-cell `formats` (`background`, `textColor`, `contentFormat`, `fontWeight`, `fontStyle`). The content hint is `plain`, `html` or `markdown`; core stores this sparse metadata without parsing markup. Formatted paste checks paste/writable/formatting permissions and commits values and formatting in one history entry. `format:change` events include the `paste` source for that operation. Plain TSV remains value-only. Clipboard helpers `encodeBlocks`, `decodeBlocks` and `blocksToTsv` are exported for renderer integration.

### Cut and single-cell paste

A one-cell clipboard value fills every cell in the selected target range(s), including its structured cell formatting. Permissions, parsers and formatting permissions are validated before the combined write. Larger clipboard rectangles retain their existing anchor/paired-range behavior; matrix tiling is not implemented.

```ts
engine.select(0, 0);
const cut = engine.cutSelectionBlocks(); // Stages a move; source is unchanged.
engine.select(1, 1);
engine.pasteCutSelectionBlocks(cut);    // Destination write and source clear: one undo.
// engine.cancelCut();                 // Cancel without changing source data.
```

Cut is a staged move within the same engine. Source cells must be copyable and writable; paste validates destination permissions/parsers and unchanged source row IDs, column order and values before writing. A failed validation leaves both sides unchanged. Source content is cleared to `null`; source cell formatting remains, while copied formatting is applied at the destination. Overlapping source/destination cells preserve the pasted result. Undo/redo replays the combined change once. Cut from merged cells is rejected; unmerge first. Use the payload from the staged cut with `pasteCutSelectionBlocks`; ordinary `paste`/`pasteSelectionBlocks` remain copy operations. The host owns clipboard transfer and must not treat arbitrary external clipboard data as a staged move. Cross-engine/browser/application moves and matrix tiling are not supported.

Successful paste selects the full destination rectangle, including all pasted rows and columns. Failed paste leaves selection unchanged.

## Permissions and events

### Capabilities and domain events

Core and Canvas options accept `permissions` (grid scope), column `permissions`, and a pure `resolveCellPermission(cell)` callback for application row/cell rules. Policies are partial booleans: `editable`, `selectable`, `copyable`, `pasteable`, `writable`, `formatting`. Any explicit false veto survives later scopes. By default selection/copy/write are allowed, while edit/paste follow column `editable`. Policies may enable edit/paste on a column with no editable opt-in; `writable: false` always denies both.

`getCellPermission(rowIndex, columnIndex)` returns a frozen resolved snapshot or throws for invalid coordinates. Setter/parser availability is separate: `canEdit` checks those too, and `canPaste` checks only the starting cell and setter availability. Paste checks every destination before any parser or setter. Copy denies the entire TSV if any cell is not copyable. Selection checks only the active endpoint, so a rectangular range may cover non-selectable interior cells. Denied pointer/keyboard targets keep the previous selection without searching for another cell.

Value API updates and value undo/redo check current writable permissions, without applying UI editable or pasteable rules. Denied batches never write or move history. `canUndo/canRedo` indicate stack availability; replay may still fail permission/conflict checks. Grid/column policies are construction snapshots; callback rules are resolved on every operation/query. Existing selection is not automatically removed on a policy change. Canvas callers can call `render()` after changing callback policy; an open editor rechecks permissions at commit. These capabilities do not replace server authorization.

Pass synchronous `onEvent(event)` to either factory. The discriminated `GridEvent` union contains:

- `cell:change`: source `api/edit/paste/undo/redo`, one batch of `{ rowIndex, rowId, columnKey, previous, value }` changes.
- `selection:change`: active `selection` and normalized `range`, plus frozen `ranges` in insertion order. Clear emits null active selection/range and an empty ranges array.
- `column:resize` / `row:resize`: `index`, `previous`, `size`; explicit resize participates in shared history.
- `lock:change`: explicit `target` and `locked` state; locks stay outside history.
- `freeze:change`: previous/current row and column prefix counts; freeze changes participate in history.
- `format:change`: source `api/paste/undo/redo` and sparse target/patch changes; formatting shares value history.

State and history commit before renderer invalidation, then the domain event. Failures before commit and no-ops emit nothing. All notification hooks and subscribers are attempted independently; errors are isolated, retained in a bounded queue and reported to `onObserverError`, without rolling back committed state. Event envelopes/payload metadata are frozen; values remain shallow caller-owned references. Parser, resolver, setter and notification hooks cannot issue nested engine mutations; queries of committed state are allowed. Destroy silently releases hooks/history. Canvas legacy selection callbacks remain separate and are not duplicated by onEvent.

### Cell, row, column and table locks

`setLocked(target, locked)` adds/removes a value lock. Targets are `{ scope: 'table' }`, `{ scope: 'row', rowIndex }`, `{ scope: 'column', columnIndex }`, or `{ scope: 'cell', rowIndex, columnIndex }`, with zero-based coordinates. `isLocked(target)` reports the explicit lock at that scope. Any applicable lock vetoes writable/editable/pasteable; selection/copy retain their permissions. Unlocking a cell does not clear a row/column/table lock; unlocking the table removes only its table flag.

Locks use sparse sets and preserve selection and data undo history, but are themselves outside history and disappear on destroy/remount. API/edit/paste/undo/redo all enforce current locks. `lock:change` carries a frozen `target` and `locked`, after layout invalidation; no-op/invalid requests emit nothing. Canvas setters throw while editing or destroyed. Right-click provides Lock/Unlock actions and indicates when the cell is read-only.

Host policies retain their false veto after unlock. Set `allowLockChanges: false` at construction to disable management in the API/menu; `canManageLocks()` reports availability. Use grid/column/resolver permissions for mandatory application restrictions. These local controls do not replace server authorization. Use the formatting capability for color restrictions; persisted/user-specific locks are not provided here.

## Layout and local views

### Frozen panes and viewport geometry

Set construction options `frozenRows` / `frozenColumns` to safe integers from zero to the row/column count (default zero). They freeze leading data rows/left columns; the header is separate. Readonly getters expose current counts; `engine.setFrozen(rows, columns)` changes them atomically after validating both arguments. Resize still updates sparse sizes. Prefixes larger than the viewport are clipped, with no scrolling area on that dimension; they are not reduced automatically.

`engine.getViewport({ width, height, scrollLeft, scrollTop })` takes body client dimensions excluding header/scrollbars. All inputs must be finite and nonnegative; offsets clamp to dataset bounds. The readonly `ViewportLayout` contains normalized offsets, clipped frozen extents and at most four nonempty `regions`. Each region has `clip`, end-exclusive `rows`/`columns`, and `offsetX/offsetY` translations for axis positions.

`view.hitTest(x, y)` maps body-local coordinates to `{ row, col }` or null for blank/outside/nonfinite coordinates. `view.cellRect(row, col)` returns the full body-local rectangle and its pane clip, throwing for invalid dataset coordinates. Coordinates remain dataset indices; these helpers do not apply permissions. Frozen geometry never reads source values and bounds region work by visible indices, even if a million rows are frozen. Query a fresh viewport after scroll, viewport resize or axis mutations; it holds axis references and is not a durable layout snapshot. Canvas uses these same mappings for painting, pointer input, editor placement and menu targets.

Runtime frozen changes preserve values, selection/ranges and data undo history. No-op/invalid changes emit nothing; changes emit `freeze:change` with `previousRows`, `previousColumns`, `rows` and `columns`, after layout invalidation. Canvas setters throw while editing or destroyed. The cell menu freezes prefixes through the clicked row/column, both through the cell, or unfreezes rows/columns/table. Menu freeze actions are disabled if the requested prefix would consume the viewport; the API still allows all-frozen layouts. These actions do not lock editing.

### Local row views

`new LocalDataView(source, {sort: {columnKey, direction: 'asc' | 'desc'}, filters: [{columnKey, query, operator: 'contains' | 'equals' | 'not-empty' | 'empty'}]})` builds an immutable index projection for synchronous local data. All filters combine with AND; contains/equals compare case-insensitive text, and empty means null/undefined/empty string. Empty text criteria do not restrict rows. Numeric pairs sort numerically; other values use a case-insensitive numeric-aware Intl.Collator. Nullish values sort last in either direction; equal values preserve source order.

LocalDataView remains an immutable projection that delegates reads/writes to source indices. For a live view, pass the original source to createGridEngine and use engine.setView(criteria), or initial options.view. The view getter is immutable; rowCount is the visible count, sourceRowCount is the original count, and getRowId(displayIndex) returns stable identity. Edits, paste, undo and redo automatically reapply criteria. Selection, locks, colors and heights remain in source coordinates and follow their records, including hidden rows. Public cell/selection/format/lock/resize APIs use display coordinates; permission resolvers and non-selection domain events use source coordinates. Selection events use display coordinates. Clear criteria before structural commands or structural undo/redo. Freeze remains a positional prefix, clamped for the visible view. A hidden selected record reappears when criteria are cleared; visible fragments are selected without including hidden intervening rows.

This is O(source rows) index memory/filter work and O(matching rows log matching rows) sorting; it does not preserve virtualization while evaluating the full source. Only use it for local datasets sized for that cost. Source row order/count/identities must remain stable; column keys must be supplied by the application. Local projection does not execute server queries; use the separate async source for read-only paging.

### Merged cells and manual row groups

```ts
engine.mergeCells({ startRow: 1, endRow: 2, startColumn: 0, endColumn: 1 });
engine.unmergeCells({ startRow: 1, endRow: 2, startColumn: 0, endColumn: 1 });
const groupId = engine.groupRows(3, 8);
engine.setGroupCollapsed(groupId, true);
engine.setGroupCollapsed(groupId, false);
engine.ungroupRows(groupId);
```

Merged cells use the top-left value; other source values remain intact. `getMerge(row, col)` returns a span in visible coordinates. Numeric viewport geometry and hit testing resolve the anchor, including when it is scrolled outside the viewport. Selection expands to include complete intersecting spans. Copy exports the anchor and blank covered cells. Paste rejects nonempty writes to covered cells; blank clipboard placeholders preserve hidden values. Explicit `updateCells` still addresses source values through visible coordinates.

Manual row groups can be nested or disjoint. Their first row remains visible when collapsed. `getRowGroups()` and `getMergedCells()` return immutable **source-coordinate** metadata; `getRowSourceIndex(visibleRow)` maps visible rows. Editing, selection, locks and row sizes retain record identity across collapse/expand. Grouping, ungrouping, collapse/expand and merge/unmerge share undo/redo. Use `allowMerging`, `allowRowGrouping` or `canChangeLayout(request)` to control capabilities. Merge/unmerge require writable cells; row grouping respects table/row locks and the host veto.

Current limits: 1,024 spans/groups each; merge permission checks cover at most 100,000 cells. Sorting/filtering keeps merged/grouped rows in blocks, sorting by the first row and retaining a block when any row matches. Collapsing rows that contain merged cells, or crossing a frozen boundary, is rejected. Expand all groups before structural changes. Moving an intact span/group preserves it; operations splitting it are rejected, and deletion of a member dissolves its metadata (undo restores it). Collapse rebuilds an O(row-count) local projection; metadata stays sparse and rendering remains viewport based.

### Sort/filter with groups and merges

Related rows form indivisible blocks. Sorting uses the first row in a block; filtering retains the whole block if any member matches. Frozen blocks keep their leading order. Collapsed children remain hidden. Group creation still requires an expanded unsorted view; collapsing cannot hide a merge or cross a frozen boundary. This preserves outline structure rather than sorting individual children through another group.

### Structural commands and layout history

insertRows(beforeIndex, rows) accepts {id, values} snapshots. deleteRows(indices), moveRows(indices, beforeIndex), insertColumns(beforeIndex, columns), deleteColumns(indices) and moveColumns(indices, beforeIndex) use zero-based coordinates. Move boundaries refer to the current order before removing selected items; relative order is stable, including noncontiguous selections.

Row operations require optional synchronous DataSource.getRow() and atomic spliceRows(splices). Sequential splices must succeed entirely or leave the source unchanged. getRow includes fields outside visible columns. Column insertion/deletion requires addColumns(keys, defaults?), which atomically permits missing fields and initializes own Column.defaultValue values. Existing hidden fields take precedence. Deleted column definitions retain source fields. LocalDataSource applies registered defaults to subsequent inserted/restored rows; insertion/default initialization share one history command. LocalDataSource implements these contracts. LocalDataView intentionally does not: clear sorting/filtering before changing source structure.

The columns and rowCount getters reflect current structure. Sizes, locks and format areas follow surviving row IDs/column keys. Rectangles split into multiple rectangles when necessary instead of selecting or formatting intervening items. Changes exceeding 128 selection ranges fail before writing. Selection on deleted items moves to a remaining selected rectangle or clears. Table/column formatting covers inserted rows; previous row/cell/range formatting excludes them. Frozen prefixes remain positional counts, clamped after deletion.

canChangeStructure(request) is an optional host veto for API, undo and redo. Requests expose axis/kind/count/indices/beforeIndex, the exact target order (-1 means a new item), and target column definitions. Table locks deny structural changes; row deletion additionally requires writable permission and applicable locks. Column deletion checks column locks and host policy; it removes definitions while retaining data fields. Insertion/reorder do not derive permission from editable. Locks remain outside history: current surviving locks are mapped during replay, and restoring deleted items restores their former locks.

Changes emit structure:change with source api/undo/redo, rowCount and columnKeys after a structure invalidation containing old-to-new axis maps. Structural operations, value edits, formatting, explicit resize and freeze share the 100-command stack. Resize/freeze replay events retain their original shapes. measureRowHeight is a renderer operation outside history; isRowHeightManual distinguishes explicit row sizes. Initial columnWidths configures key-based sizes without commands.

Structural history retains row identity arrays, coordinate maps, sparse metadata snapshots and affected shallow rows. This uses O(rows + columns + metadata) memory per command, plus range/format fragmentation. Local sequential splices copy row arrays per contiguous block. This is intended for local datasets, not remote transactions or an unbounded million-row structural history. External identity/count changes or changed rows a replay would replace cause an error and leave history available for retry. Nested values remain caller-owned.


Live local views use O(rows) index memory/filter work and O(matches log matches) sorting per value command. Sparse geometry is rebuilt from resized rows. Large source selections can split into many visible fragments when sorted/filtered. External source writes require setView(engine.view) to refresh membership/order; these local views do not execute asynchronous server filters.

### Sparse cell formatting

`engine.format(targets, patch)` atomically applies colors to cell/row/column/table targets (the lock target shapes) or `{ scope: 'range', range: { startRow, endRow, startColumn, endColumn } }`. Range ends are inclusive. `patch` accepts `background` / `textColor` as hex colors (#RGB/#RGBA/#RRGGBB/#RRGGBBAA) or null. A property set to null resets that color to the theme within the target; a null patch removes that target's explicit overlay and may reveal earlier formatting. `getFormat(row, col)` returns a frozen effective snapshot; `canFormat(targets)` checks current permission availability.

The last applied property wins across intersecting targets. Updating only background preserves the previous priority of text color. Multiple targets are one atomic command. Colors are sparse overlays, not per-cell arrays; static permissions need only column checks, while a dynamic resolver must validate every targeted cell. Each formatted cell lookup scans O(formatted areas), intended for modest local formatting sets. Formatting reads/writes no source values and does not reorder rows.

`formatting` defaults to true and has the same false veto as other capabilities, independently of writable and value locks. Formatting and value edits share the 100-command undo/redo history, with current formatting permissions checked on style replay. `format:change` carries source api/undo/redo and frozen changes containing target/previous/value patches, after layout invalidation. Styles are local and cleared on destroy/remount unless the host restores exportState(). Source preview also supports fontWeight (normal/bold) and fontStyle (normal/italic), with null resetting either property. Arbitrary CSS, font families/sizes, borders and conditional formatting are not implemented.

## Persistence

### Portable layout and view configuration

```ts
import { createGridEngine, restoreGridConfiguration } from '@acheron-grid/core';

const saved = JSON.stringify(engine.exportConfiguration());
const restoredOptions = restoreGridConfiguration(
  JSON.parse(saved), applicationColumns, dataSource.getRowCount(),
);
const restoredEngine = createGridEngine({
  ...restoredOptions, dataSource, permissions: applicationPermissions,
});
```

`exportConfiguration()` returns a detached version-1 JSON-compatible snapshot of column keys/order/current widths, source frozen-row count, frozen-column count and local sort/filters. `restoreGridConfiguration(input, columns, rowCount)` validates unknown input and returns initialization options. It requires exactly the current column keys once each; unknown versions, missing/duplicate/unknown keys, invalid sizes, counts or view definitions throw before grid construction. Existing application column definitions (including parsers and permission policies) are reused; configuration cannot supply executable definitions.

Storage is host-owned; the core does not access localStorage or a server. Filter queries may contain sensitive text, so choose storage and access controls accordingly. Apply returned options to a new engine; this API does not change a mounted grid or create undo history. Configuration excludes cell data, row order/heights, default row height, merges/groups, formatting, locks, selection and history. Frozen rows are a count, not stable row identities; restore against the intended source order. Keep rowHeight and other host options explicit. Structural column additions/deletions require the host's matching schema when restoring.

### Persist layout and domain state

```ts
const saved = JSON.stringify(engine.exportState());
// Store in your application, then load with the same ordered row IDs/schema.
engine.restoreState(JSON.parse(saved));
```

The versioned snapshot includes configuration, row heights, selection endpoints/ranges, groups, merges, locks and sparse formatting. Restoration validates before committing and rechecks application permissions. Row IDs must match the current source in the same order. Supply the same column schema and policies when creating the engine; snapshots do not serialize callbacks.

Data values, undo/redo, editor drafts and pending clipboard operations are not persisted. Restore clears history. Use `exportConfiguration()` when you only need column order/widths, frozen prefixes and view configuration. Treat stored snapshots as untrusted input and handle restore errors; do not overwrite a working grid with an incompatible saved schema.

Unlock the table before restoring state. Restore also checks permissions when removing merges, groups or formatting, and preserves the active projected selection for subsequent Shift navigation. Older version-1 snapshots without active-selection metadata remain accepted with a single active part.

Restoring a different column order checks structural permissions before committing, including the table lock and projected-view restrictions. The host structural callback receives the complete target `order` and `columns`; denied restores preserve state and history.

## Core contracts and practical limits

This describes the current source, including unreleased fixes. Select the npm 0.1.0 documentation channel when integrating that package version. All modules remain open source and free to use.

| Component | Contract | Cost or boundary |
| --- | --- | --- |
| Entry points and types (`index`, `headless`, `types`) | ESM, strict ES2022 TypeScript; no DOM, framework or runtime dependencies | Canvas depends on public core; core does not own browser interaction |
| Local sources (`data-source`) | Unique stable IDs, shallow immutable row snapshots, atomic batches and sequential splices | Nested objects remain host-owned; structural splices copy arrays |
| Async source (`async-data-source`) | Read-only explicit pages, query generations, deduplication, cancellation, bounded requests/cache/errors | Host supplies consistent server revisions, authorization and timeout; unloaded differs from null/empty |
| Live source (`live-data-source`) | Bounded snapshots and consecutive messages, coalesced atomic flush | Gaps/overflow require a fresh snapshot; transport and flush scheduling belong to the host |
| Commands and permissions (`engine`, `permissions`) | Preflight validation and independent false-veto capabilities; one synchronous write path | Custom setters must guarantee atomicity; client permissions do not authorize server requests |
| History and events (`engine`, `events`) | Latest 100 commands; conflict and current-permission checks; isolated observers | Value references are shallow; structural history retains O(rows + columns + metadata) per command |
| Selection and local views (`engine`, `data-source`) | Visible API indices map to source state; source-coordinate identity survives view changes | At most 128 source selection rectangles; projected selections exceeding that fail before changing selection. Clipboard accepts at most 128 visible fragments |
| Geometry (`axis`, `panes`, `viewport`) | Sparse size overrides, numeric frozen panes, end-exclusive viewport ranges | Resize rebuilds sparse prefixes; collapsed frozen-row counts are cached between state changes |
| Structure and outline (`structure`, `engine`) | Atomic insert/delete/move; nested or disjoint groups; intact merges move together | Clear projected views before structure; at most 1,024 groups and 1,024 merges; collapse builds an O(rows) projection |
| Clipboard (`clipboard`, `tsv`) | Version-1 string blocks, optional formats, strict TSV parsing, staged same-engine cut | 100,000 cells / 10M UTF-16 units; no typed arbitrary-object codec, cross-engine cut or paste special |
| Formatting (`types`, `engine`) | Sparse property precedence, formatting permissions and shared history | Lookup scans formatted areas; dynamic permissions scan targeted cells; no conditional rules |
| Persistence (`configuration`, `state`, `engine`) | Validate unknown state and application schema/policies before commit | Full state captures O(rows) identities; no data/transport/callback/history storage; restore clears history |

Local filter evaluation and projections cost O(source rows), with O(matches log matches) sorting. Value commands in an active view reapply criteria. Identity capture, full export and refresh also scan row IDs or mappings. These operations are separate from viewport rendering; a million-row viewport check does not establish million-row sort, structural history or export performance.

Integration checks should cover permission/validation rejection without partial writes, identity and value conflicts during replay, query cancellation and changing totals, selection fragmentation, frozen group reconciliation, state round trips and independent source cleanup. See [support and release evidence](../../SUPPORT.md) for browser and device limits. Async writes, formulas, collaboration and dataset revision negotiation remain separate host or future module work.

## Browser import migration

The development preview moved createGrid, Grid and GridOptions from core to @acheron-grid/canvas. Install both local packages and change imports:

```ts
import { createGrid } from '@acheron-grid/canvas';
import type { Grid, GridOptions } from '@acheron-grid/canvas';
import { LocalDataSource } from '@acheron-grid/core';
import type { Column, CellSelection, SelectionRange } from '@acheron-grid/core';
```

The createGrid methods and behavior remain the same; see the [Canvas guide](https://acheron-grid.haoduong.dev/reference/canvas). Core does not re-export Canvas because that would invert the dependency direction. Existing core/headless consumers continue to work.

## License

Licensed under [MIT](LICENSE). Copyright (c) 2026 Hao Duong. Lucide assets belong to the separate Canvas package and are not dependencies of this headless core.
