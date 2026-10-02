# @acheron-grid/core

An experimental, framework-independent Canvas data grid engine written in TypeScript.

## Current capabilities

- Canvas rendering with default sizes and individual row/column size overrides.
- Row and column virtualization, native scrolling, and a pinned column header.
- A local data source with unique row IDs and shallow row snapshots.
- Resize observation, coalesced rendering, and explicit cleanup.
- Single-cell selection by pointer and keyboard, with automatic scrolling.

This package is a development preview, not a published release. Multi-range selection, remote data sources, and framework adapters are not implemented. Canvas cell content is not yet accessible to screen readers. A headless render-callback benchmark is available; end-to-end frame rate has not been verified.

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

`createGrid(options)` returns `render()`, `updateCells(updates)`, `undo()`, `redo()`, `getSelection()`, `getSelectionRange()`, `copySelection()`, `paste(text)` and `destroy()`. `render()` schedules a viewport redraw, coalesced into the next animation frame. `destroy()` removes only the grid's own DOM and releases its listeners and observer; repeated calls are safe. Calls to `render()` after destruction do nothing.

Column keys must be unique. All cell dimensions must be positive finite numbers. Values are rendered as plain text using `String(value)`; `null` and `undefined` display as empty cells.

## Limits

All local rows reside in memory. Virtualization bounds cell rendering work, not data storage. Native scrolling is subject to browser scroll-size limits, so this preview does not guarantee arbitrary dataset dimensions. Cells have a uniform width and height; there are no custom renderers, editors, or mutation APIs yet.

## Selection and keyboard

Click a data cell to select it and focus the viewport. Arrow keys move one cell; Home/End move to the first/last column; Ctrl/Meta+Home/End move to the first/last cell. Navigation clamps at dataset boundaries and scrolls the active cell into view. The first navigation key with no selection selects the first cell. Escape clears selection; Tab leaves the viewport normally. Shift-modified navigation extends a rectangular range. See range selection and clipboard below.

`grid.getSelection()` returns a fresh `{ rowIndex, rowId, columnIndex, columnKey }` object or `null`. Indices are zero-based. Pass `onSelectionChange(selection)` to `createGrid` to observe changes, including `null` when cleared. Callback objects are copies; selecting the same cell does not fire again. Destroy clears selection without emitting an event. Header, blank space, scrollbar and Ctrl/Meta/Alt-modified pointer presses do not select cells; Shift-click extends the range. The viewport label describes the active cell, but a complete accessible grid representation is not implemented.
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

Value commands coalesce dirty cells into one animation frame. Offscreen changes are read when scrolled into view. Scroll, resize, selection changes and explicit `render()` request a full viewport redraw. Undoable layout commands, async history and persistent history are not implemented.

## Range selection and clipboard

Drag with a mouse/pen, Shift-click, or use Shift+Arrow/Home/End to extend a rectangular range from its anchor. Ctrl/Cmd+Shift+Home/End extends to the first/last grid cell. Ordinary clicks or navigation collapse the range; Escape clears it. Dragging captures the pointer and clamps to viewport/data bounds. Stationary edge auto-scroll, touch range dragging and multiple ranges are not implemented.

`getSelection()` still returns the active endpoint. `getSelectionRange()` returns a fresh normalized `{ startRow, endRow, startColumn, endColumn }` object or `null`; bounds are zero-based and inclusive. `onSelectionRangeChange(range)` receives a copy when bounds change, or `null` on clear. The grid draws both the outer range and active-cell borders. Editing changes the active cell while keeping the range.

```js
const text = grid.copySelection(); // TSV; does not access the system clipboard
grid.paste('Grace\tOperations\r\nAda\tDesign'); // one undoable command
```

Native copy/paste events support Ctrl/Cmd+C/V on the focused viewport without Clipboard API permissions. The text editor keeps native clipboard behavior. Copy exports values only, with null/undefined as empty text. TSV quotes tabs/newlines/quotes and doubles embedded quotes. Paste accepts quoted multiline TSV with tab and CRLF/LF/CR separators; one trailing row separator is ignored. Ragged rows and malformed quotes are rejected.

Paste starts at the selected range's top-left cell and uses the clipboard rectangle's dimensions. It does not tile/fill the selection, add rows or skip read-only columns. Every destination must be within bounds and `editable`; values pass through column parsers. Non-string existing values require a parser. All values are validated before the atomic write, so parser/bounds/read-only failures leave data/history unchanged. Multi-cell paste requires an atomic source `setValues` implementation.

Clipboard work is limited to 100,000 cells and 10,000,000 UTF-16 code units per payload. Over-limit transfers throw `RangeError`. Copy/paste APIs throw while editing or after destruction; no selection yields empty copy/no-op paste. Event errors use native alerts. HTML-only clipboard, cut and formula processing are not supported. Actual OS clipboard and spreadsheet interoperability have not been verified; browser tests exercise native event handlers with controlled `DataTransfer` payloads.

## Row/column resize and context menu

```js
grid.setColumnWidth(1, 240);
grid.setRowHeight(0, 48);
```

Sizes are finite positive CSS pixel values; indices are zero-based integers. Invalid indices/sizes are rejected before layout changes. Calls throw while editing or after destruction. Sizes default to `columnWidth`/`rowHeight`, with sparse per-index overrides; rows do not require a size array. Resizing updates scroll dimensions and fully redraws, keeping hit testing, editor placement and selection aligned. Layout changes are in memory and are outside data undo/redo.

Drag within 5 CSS pixels of a header edge to resize that column (24–1000px). Right-click a cell and choose **Resize column…** or **Resize row…** for a native DOM dialog with a labeled number input, Apply and Cancel. The dialog accepts sizes of at least 1px. Row-edge dragging, row gutters, auto-fit and persisted layout are not implemented.

The built-in cell menu also provides **Copy**, **Paste**, **Edit cell**, **Undo** and **Redo**. Right-clicking within the range preserves it and its active endpoint; right-clicking elsewhere selects that cell without scrolling. Resize targets the clicked cell, while Edit targets the active cell. Header, blank space and editor inputs retain the browser's context menu.

Shift+F10 or the ContextMenu key opens the menu for the active cell. Arrow keys, Home and End navigate enabled items; Enter/Space activates. Escape/Tab returns focus to the viewport. Outside clicks, scrolling, resizing and destruction dismiss the menu. The popover stays inside the browser window.

Menu Copy/Paste calls `navigator.clipboard` only from the clicked action and requires browser support, a secure context and any required browser permission. It does not read the clipboard when opening the menu. Errors are shown in an accessible message with a keyboard-shortcut fallback. An async paste is rejected if its target range changes before the clipboard read finishes. Ctrl/Cmd+C/V on the grid and native editor clipboard remain available. Custom menu items are not implemented.

## Render-callback benchmark

Run `npm run benchmark` from the engine root. The installed Playwright runner measures callbacks that draw a viewport of a lazy 1,000,000-row × 1,000-column source, including sparse resize overrides, scrolling and partial updates. JSON output reports sample counts, median/P95 callback time and maximum source cell reads. The fixture uses a 640×360 CSS pixel grid.

This measures synchronous JavaScript/Canvas callback cost in headless Chromium. It does not measure deferred rasterization, compositor/GPU work, end-to-end FPS or peak memory, and does not claim 60 FPS on other hardware or browsers.
