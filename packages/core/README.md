# @acheron-grid/core

An experimental, framework-independent Canvas data grid engine written in TypeScript.

## Current capabilities

- Read-only Canvas rendering with fixed row heights and column widths.
- Row and column virtualization, native scrolling, and a pinned column header.
- A local data source with unique row IDs and shallow row snapshots.
- Resize observation, coalesced rendering, and explicit cleanup.
- Single-cell selection by pointer and keyboard, with automatic scrolling.

This package is a development preview, not a published release. Range selection, remote data sources, and framework adapters are not implemented. Canvas cell content is not yet accessible to screen readers. Performance has not been benchmarked.

## Build from source

From the repository root, using Node.js 22 or later:

```sh
npm ci
npm run build
```

The package exports ESM JavaScript and TypeScript declarations from `dist/`. It has no runtime dependencies.

## Usage

Install the built package from a local checkout in your consumer project:

```sh
npm install /path/to/acheron-grid-engine/packages/core
```

```ts
import { createGrid, LocalDataSource } from '@acheron-grid/core';

const container = document.querySelector<HTMLElement>('#grid')!;
const dataSource = new LocalDataSource([
  { id: 'row-1', name: 'Ada', score: 42 },
  { id: 'row-2', name: 'Lin', score: 57 },
], row => row.id);

const grid = createGrid({
  container,
  columns: [
    { key: 'name', title: 'Name' },
    { key: 'score', title: 'Score' },
  ],
  dataSource,
  rowHeight: 32,
  columnWidth: 160,
  headerHeight: 36,
});

// On unmount:
grid.destroy();
```

Give the container explicit dimensions, such as `width: 100%; height: 480px`. Mount in a browser with Canvas 2D and ResizeObserver support. Importing the package alone does not access the DOM.

## API

`LocalDataSource(rows, getRowId)` copies the row array and shallow-copies each row. IDs must be unique strings or finite numbers. Nested objects are not cloned. Use setValue(index, columnKey, value) to replace an existing field without mutating caller rows. Row IDs stay fixed at construction. Invalid indices and missing fields are rejected; missing properties return `undefined`, while invalid row indices throw `RangeError`.

The `DataSource` interface exposes `getRowCount()`, `getRowId(index)`, and `getValue(index, columnKey)`. Grid dimensions use the row count at mount time; changing the row count requires remounting. Custom sources must provide synchronous values and valid counts.

`createGrid(options)` returns `render()`, `updateCells(updates)`, `undo()`, `redo()`, `getSelection()` and `destroy()`. `render()` schedules a viewport redraw, coalesced into the next animation frame. `destroy()` removes only the grid's own DOM and releases its listeners and observer; repeated calls are safe. Calls to `render()` after destruction do nothing.

Column keys must be unique. All cell dimensions must be positive finite numbers. Values are rendered as plain text using `String(value)`; `null` and `undefined` display as empty cells.

## Limits

All local rows reside in memory. Virtualization bounds cell rendering work, not data storage. Native scrolling is subject to browser scroll-size limits, so this preview does not guarantee arbitrary dataset dimensions. Cells have a uniform width and height; there are no custom renderers, editors, or mutation APIs yet.

## Selection and keyboard

Click a data cell to select it and focus the viewport. Arrow keys move one cell; Home/End move to the first/last column; Ctrl/Meta+Home/End move to the first/last cell. Navigation clamps at dataset boundaries and scrolls the active cell into view. The first navigation key with no selection selects the first cell. Escape clears selection; Tab leaves the viewport normally. Shift-modified navigation and range selection are not implemented. See inline editing below.

`grid.getSelection()` returns a fresh `{ rowIndex, rowId, columnIndex, columnKey }` object or `null`. Indices are zero-based. Pass `onSelectionChange(selection)` to `createGrid` to observe changes, including `null` when cleared. Callback objects are copies; selecting the same cell does not fire again. Destroy clears selection without emitting an event. Header, blank space, scrollbar and modified pointer presses do not select cells. The viewport label describes the active cell, but a complete accessible grid representation is not implemented.
## Inline editing

Set `editable: true` on a column and provide a synchronous `DataSource.setValue(index, columnKey, value)` method (`LocalDataSource` already provides it). Double-click a cell or press Enter/F2 to open the text input. Enter, Tab and blur save; Escape cancels. Edits are in memory only. Destroy discards an unfinished edit.

```js
const columns = [
  { key: 'name', title: 'Name', editable: true },
  { key: 'amount', title: 'Amount', editable: true, parse: text => {
    if (!text.trim() || !Number.isFinite(Number(text))) throw new Error('Enter a finite number');
    return Number(text);
  } },
];
```

Columns are read-only by default. Without a parser, only string/null/undefined values can be edited; saved values are strings. A parser can return a typed value or throw a validation error. Parser/setter errors keep the draft input open with native validation feedback. Unchanged text does not call the setter. IME composition does not commit on Enter. Keep identity columns read-only: local row IDs remain stable even if their original field value changes.

After calling `dataSource.setValue(...)` outside the editor, call `grid.render()` to redraw. Grid commands repaint only changed cells in the viewport through the existing frame scheduler. Async writes and automatic source subscriptions are not implemented.

## Batch updates and history

```js
grid.updateCells([
  { rowIndex: 0, columnKey: 'name', value: 'Grace' },
  { rowIndex: 1, columnKey: 'name', value: 'Ada' },
]);
grid.undo(); // true if a command was undone
grid.redo(); // true if a command was redone
```

Each call is one undoable command, including edits committed through the DOM editor. Repeated cells use the last supplied value; unchanged values are skipped using `Object.is`. These APIs take zero-based row indices and already validated values: they do not run column parsers or enforce the UI's `editable` flag. Invalid indices/unknown grid columns are rejected before any write.

`LocalDataSource.setValues(updates)` validates all fields and builds replacement rows before committing the batch. Custom sources must provide a synchronous, atomic `setValues(updates)` for multiple-cell commands; a single-cell command can use `setValue`. Setters must leave data unchanged when throwing. A failed command or replay does not move history. Async setters are unsupported.

The grid retains the latest 100 commands, with shallow old/new value references. This limits command count, not memory bytes. New changes clear redo; no-ops preserve it. Undo/redo reject conflicts if a recorded row ID or current value differs after external mutation. Direct source writes are outside history and require `grid.render()`.

When the viewport has focus, Ctrl/Cmd+Z undoes and Ctrl/Cmd+Shift+Z or Ctrl/Cmd+Y redoes. The DOM editor keeps native text undo. `updateCells` throws while editing or after destruction; undo/redo return `false` while editing, after destruction or when the stack is empty. Destroy releases both history stacks.

Value commands coalesce dirty cells into one animation frame. Offscreen changes are read when scrolled into view. Scroll, resize, selection changes and explicit `render()` request a full viewport redraw. Layout commands, async history and persistent history are not implemented.
