# @acheron-grid/core

An experimental headless TypeScript data-grid engine. Core owns data, selection, layout, editing, TSV clipboard operations and delta history. It has no runtime dependencies or browser/framework types.

## Build

From the engine repository root, use Node.js 22 or later: npm ci, npm run build, npm run typecheck, npm test. Build runs core before Canvas. Both packages remain private development previews, with no published release or selected license.

## Usage

The root entry exports createGridEngine, LocalDataSource and their types. It runs in Node without DOM, Canvas or framework globals. The earlier @acheron-grid/core/headless subpath remains an alias. Browser rendering is provided by [@acheron-grid/canvas](../canvas/README.md).

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

`select(rowIndex, columnIndex, extend?)` rejects invalid coordinates and returns whether selection changed; denied targets return false; `clearSelection()` clears the range. `getSelection()` and `getSelectionRange()` return copies for the active cell/range. `addSelection(rowIndex, columnIndex)` retains earlier rectangles and starts a new active range. `getSelectionRanges()` returns copies in insertion order, active range last. Extending changes only that last range; plain select replaces all ranges. Selection is bounded to 128 rectangles, allows overlaps and does not allocate per selected cell. `rows` and `columnsLayout` expose read-only `size`, `position`, `indexAt` and `range` geometry queries; mutations use `setRowHeight` and `setColumnWidth`. Columns are frozen snapshots. `getValue`, `canEdit`, `canPaste`, `canUndo` and `canRedo` provide queries. `editCell(rowIndex, columnIndex, text)` applies the same editable/parser rules as the DOM editor; `updateCells` retains its programmatic, already-validated-value semantics. `canPaste` checks the starting cell and write capability; `paste` validates the entire rectangle before writing.

An optional synchronous `onInvalidate(change)` renderer hook receives `cells`, `selection` or `layout` notifications after committed state/history. These notifications describe repaint needs, separate from public domain events. The hook may query committed state; if it throws, the exception propagates and does not roll back an already committed mutation. `destroy()` drops the hook and history, clears selection without notification and is idempotent. Mutations/copy/paste throw after destruction; undo/redo return false. As with the browser API, source values are shallow references and external source writes are outside history. Row count remains fixed at construction.

Build/typecheck includes a separate ES2022-only TypeScript configuration with no DOM or ambient Node types. Unit tests also compile the headless dependency closure and verify it excludes browser modules.

## DataSource and mutation contracts

DataSource exposes synchronous getRowCount/getRowId/getValue and optional setValue/setValues. Row count is fixed at construction. LocalDataSource copies the row array and shallow row snapshots, with unique stable row IDs; nested values remain caller-owned.

updateCells accepts already-validated values and intentionally does not apply column parsers or the editor's editable flag. editCell and paste apply resolved editable/pasteable permissions and text parsers. All writes, including API updates and undo/redo, require writable permission. Batch setters must be synchronous and atomic, leaving data unchanged on failure. Validation completes before writes. Duplicate updates use the last value, Object.is no-ops preserve history, and undo/redo retain at most 100 delta commands with shallow value references. External writes are outside history; replay rejects row identity/current value conflicts. Resize is not in data history.

Clipboard processing is limited to 100,000 cells and 10 million UTF-16 code units. Async sources, framework adapters and multiple ranges are not implemented.

## Browser import migration

This unpublished preview moved createGrid, Grid and GridOptions from core to @acheron-grid/canvas. Install both local packages and change imports:

```ts
import { createGrid } from '@acheron-grid/canvas';
import type { Grid, GridOptions } from '@acheron-grid/canvas';
import { LocalDataSource } from '@acheron-grid/core';
import type { Column, CellSelection, SelectionRange } from '@acheron-grid/core';
```

The createGrid methods and behavior remain the same; see the [Canvas guide](../canvas/README.md). Core does not re-export Canvas because that would invert the dependency direction. Existing core/headless consumers continue to work.

## Capabilities and domain events

Core and Canvas options accept `permissions` (grid scope), column `permissions`, and a pure `resolveCellPermission(cell)` callback for application row/cell rules. Policies are partial booleans: `editable`, `selectable`, `copyable`, `pasteable`, `writable`. Any explicit false veto survives later scopes. By default selection/copy/write are allowed, while edit/paste follow column `editable`. Policies may enable edit/paste on a column with no editable opt-in; `writable: false` always denies both.

`getCellPermission(rowIndex, columnIndex)` returns a frozen resolved snapshot or throws for invalid coordinates. Setter/parser availability is separate: `canEdit` checks those too, and `canPaste` checks only the starting cell and setter availability. Paste checks every destination before any parser or setter. Copy denies the entire TSV if any cell is not copyable. Selection checks only the active endpoint, so a rectangular range may cover non-selectable interior cells. Denied pointer/keyboard targets keep the previous selection without searching for another cell.

API updates and undo/redo check current writable permissions, without applying UI editable or pasteable rules. Denied batches never write or move history. `canUndo/canRedo` indicate stack availability; replay may still fail permission/conflict checks. Grid/column policies are construction snapshots; callback rules are resolved on every operation/query. Existing selection is not automatically removed on a policy change. Canvas callers can call `render()` after changing callback policy; an open editor rechecks permissions at commit. These capabilities do not replace server authorization.

Pass synchronous `onEvent(event)` to either factory. The discriminated `GridEvent` union contains:

- `cell:change`: source `api/edit/paste/undo/redo`, one batch of `{ rowIndex, rowId, columnKey, previous, value }` changes.
- `selection:change`: active `selection` and normalized `range`, plus frozen `ranges` in insertion order. Clear emits null active selection/range and an empty ranges array.
- `column:resize` / `row:resize`: `index`, `previous`, `size`; layout stays outside data history.

State and history commit before renderer invalidation, then the domain event. Failures before commit and no-ops emit nothing. Both notification hooks are attempted even if one throws; the first error propagates after both, without rolling back committed state. Event envelopes/payload metadata are frozen; values remain shallow caller-owned references. Parser, resolver, setter and notification hooks cannot issue nested engine mutations; queries of committed state are allowed. Destroy silently releases hooks/history. Canvas legacy selection callbacks remain separate and are not duplicated by onEvent.

## Frozen panes and viewport geometry

Set construction options `frozenRows` / `frozenColumns` to safe integers from zero to the row/column count (default zero). They freeze leading data rows/left columns; the header is separate. Readonly getters expose current counts; `engine.setFrozen(rows, columns)` changes them atomically after validating both arguments. Resize still updates sparse sizes. Prefixes larger than the viewport are clipped, with no scrolling area on that dimension; they are not reduced automatically.

`engine.getViewport({ width, height, scrollLeft, scrollTop })` takes body client dimensions excluding header/scrollbars. All inputs must be finite and nonnegative; offsets clamp to dataset bounds. The readonly `ViewportLayout` contains normalized offsets, clipped frozen extents and at most four nonempty `regions`. Each region has `clip`, end-exclusive `rows`/`columns`, and `offsetX/offsetY` translations for axis positions.

`view.hitTest(x, y)` maps body-local coordinates to `{ row, col }` or null for blank/outside/nonfinite coordinates. `view.cellRect(row, col)` returns the full body-local rectangle and its pane clip, throwing for invalid dataset coordinates. Coordinates remain dataset indices; these helpers do not apply permissions. Frozen geometry never reads source values and bounds region work by visible indices, even if a million rows are frozen. Query a fresh viewport after scroll, viewport resize or axis mutations; it holds axis references and is not a durable layout snapshot. Canvas uses these same mappings for painting, pointer input, editor placement and menu targets.

## Multiple-range clipboard

Copy/paste require a single rectangle; multiple ranges throw before reading/writing clipboard cells, and `canPaste()` returns false. Editing and history operate on the active cell/data, preserving the range list. Clear/destroy discard all ranges. Selectable permission still checks only target endpoints.

## Runtime frozen changes

Runtime frozen changes preserve values, selection/ranges and data undo history. No-op/invalid changes emit nothing; changes emit `freeze:change` with `previousRows`, `previousColumns`, `rows` and `columns`, after layout invalidation. Canvas setters throw while editing or destroyed. The cell menu freezes prefixes through the clicked row/column, both through the cell, or unfreezes rows/columns/table. Menu freeze actions are disabled if the requested prefix would consume the viewport; the API still allows all-frozen layouts. These actions do not lock editing.

## Cell, row, column and table locks

`setLocked(target, locked)` adds/removes a value lock. Targets are `{ scope: 'table' }`, `{ scope: 'row', rowIndex }`, `{ scope: 'column', columnIndex }`, or `{ scope: 'cell', rowIndex, columnIndex }`, with zero-based coordinates. `isLocked(target)` reports the explicit lock at that scope. Any applicable lock vetoes writable/editable/pasteable; selection/copy retain their permissions. Unlocking a cell does not clear a row/column/table lock; unlocking the table removes only its table flag.

Locks use sparse sets and preserve selection and data undo history, but are themselves outside history and disappear on destroy/remount. API/edit/paste/undo/redo all enforce current locks. `lock:change` carries a frozen `target` and `locked`, after layout invalidation; no-op/invalid requests emit nothing. Canvas setters throw while editing or destroyed. Right-click provides Lock/Unlock actions and indicates when the cell is read-only.

Host policies retain their false veto after unlock. Set `allowLockChanges: false` at construction to disable management in the API/menu; `canManageLocks()` reports availability. Use grid/column/resolver permissions for mandatory application restrictions. These local controls do not replace server authorization. Formatting permissions and persisted/user-specific locks are not provided here.
