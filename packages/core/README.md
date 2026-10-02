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

`select(rowIndex, columnIndex, extend?)` rejects invalid coordinates; `clearSelection()` clears the range. `getSelection()` and `getSelectionRange()` return copies. `rows` and `columnsLayout` expose read-only `size`, `position`, `indexAt` and `range` geometry queries; mutations use `setRowHeight` and `setColumnWidth`. Columns are frozen snapshots. `getValue`, `canEdit`, `canPaste`, `canUndo` and `canRedo` provide queries. `editCell(rowIndex, columnIndex, text)` applies the same editable/parser rules as the DOM editor; `updateCells` retains its programmatic, already-validated-value semantics. `canPaste` checks the starting cell and write capability; `paste` validates the entire rectangle before writing.

An optional synchronous `onInvalidate(change)` renderer hook receives `cells`, `selection` or `layout` notifications after committed state/history. These notifications describe repaint needs, not the future public domain event system. The hook may query committed state; if it throws, the exception propagates and does not roll back an already committed mutation. `destroy()` drops the hook and history, clears selection without notification and is idempotent. Mutations/copy/paste throw after destruction; undo/redo return false. As with the browser API, source values are shallow references and external source writes are outside history. Row count remains fixed at construction.

Build/typecheck includes a separate ES2022-only TypeScript configuration with no DOM or ambient Node types. Unit tests also compile the headless dependency closure and verify it excludes browser modules.

## DataSource and mutation contracts

DataSource exposes synchronous getRowCount/getRowId/getValue and optional setValue/setValues. Row count is fixed at construction. LocalDataSource copies the row array and shallow row snapshots, with unique stable row IDs; nested values remain caller-owned.

updateCells accepts already-validated values and intentionally does not apply column parsers or the editor's editable flag. editCell and paste apply those rules. Batch setters must be synchronous and atomic, leaving data unchanged on failure. Validation completes before writes. Duplicate updates use the last value, Object.is no-ops preserve history, and undo/redo retain at most 100 delta commands with shallow value references. External writes are outside history; replay rejects row identity/current value conflicts. Resize is not in data history.

Clipboard processing is limited to 100,000 cells and 10 million UTF-16 code units. Async sources, centralized capability permissions, public domain events, framework adapters and multiple ranges are not implemented.

## Browser import migration

This unpublished preview moved createGrid, Grid and GridOptions from core to @acheron-grid/canvas. Install both local packages and change imports:

```ts
import { createGrid } from '@acheron-grid/canvas';
import type { Grid, GridOptions } from '@acheron-grid/canvas';
import { LocalDataSource } from '@acheron-grid/core';
import type { Column, CellSelection, SelectionRange } from '@acheron-grid/core';
```

The createGrid methods and behavior remain the same; see the [Canvas guide](../canvas/README.md). Core does not re-export Canvas because that would invert the dependency direction. Existing core/headless consumers continue to work.
