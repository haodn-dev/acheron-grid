# @acheron-grid/canvas

An experimental Canvas browser renderer for the headless @acheron-grid/core engine.

## Current capabilities

- Canvas rendering with default sizes and individual row/column size overrides.
- Row and column virtualization, native scrolling, and a pinned column header.
- A local data source with unique row IDs and shallow row snapshots.
- Resize observation, coalesced rendering, and explicit cleanup.
- Optional custom cell drawing with clipping, fallback and partial repaint support.
- Custom native cell editors: input, select or textarea.
- Optional color and font theme shared by Canvas and editor/menu/dialog surfaces.
- Single-cell, rectangular, whole-row/column and multiple-range selection by pointer and keyboard, with keyboard reveal of the active cell.
- Default fixed row index, runtime freeze/unfreeze, scoped locks and sparse formatting.
- Validated text/select/checkbox editing, multiline overlays, images, search and opt-in local sort/filter views.
- TSV copy/paste, atomic local batches, delta undo/redo and typed events.

This package is a development preview, not a published release. Remote data sources and framework adapters are not implemented. The active cell has a bounded ARIA grid mirror; full screen-reader coverage has not been verified. A headless render-callback benchmark is available; end-to-end frame rate has not been verified.

## Build from source

From the repository root, using Node.js 22 or later:

```sh
npm ci
npm run build
```

The package exports ESM JavaScript and TypeScript declarations from `dist/`. Its only runtime dependency is @acheron-grid/core.

## Usage

### Mounting a grid

Install the built package from a local checkout in your consumer project:

```sh
npm install /path/to/acheron-grid-engine/packages/core /path/to/acheron-grid-engine/packages/canvas
```

```ts
import { createGrid } from '@acheron-grid/canvas';
import { LocalDataSource } from '@acheron-grid/core';

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

```

Call `grid.destroy()` when the owning view unmounts.

Give the container explicit dimensions, such as `width: 100%; height: 480px`. Mount in a browser with Canvas 2D and ResizeObserver support. Importing the package alone does not access the DOM.

## Basic themes

Pass `theme?: Partial<GridTheme>` at construction. Supported fields are `background`, `textColor`, `headerBackground`, `headerTextColor`, `gridLineColor`, `selectionColor`, `font`, `headerFont` and `linkColor`. Omitted fields keep the default light palette and 13px system font. Font values use the CSS font shorthand. Values are validated before mounting; use concrete CSS colors/fonts, without CSS variables, inheritance keywords or `currentColor`.

```ts
theme: {
  headerBackground: '#e0f2f1',
  headerTextColor: '#115e59',
  selectionColor: '#0f766e',
  font: '14px system-ui',
}
```

Each grid snapshots its theme independently. Canvas cells, headers, lines and selection use the theme; native editor, menu and resize-dialog surfaces inherit matching CSS variables scoped to that grid. Native browser control chrome and semantic error alerts keep their own appearance. Custom renderers own their drawing colors/fonts. Transparent backgrounds are supported: dirty cell repaint clears old pixels before drawing. Mutating the original theme object has no effect; use `grid.setTheme(patch)` for validated runtime updates. The host controls theme choice; automatic dark mode is not provided. Use the formatting API for local per-cell colors. Theme fonts do not resize rows/columns; configure geometry separately.

## Custom cell drawing

Pass `renderCell(context, cell)` to `createGrid`. Return `true` to replace the default body text, or `false` to draw the default text. Headers, grid lines and selection remain owned by the grid.

```ts
renderCell: (ctx, cell) => {
  if (cell.columnKey !== 'status') return false;
  ctx.fillStyle = cell.value === 'Review' ? '#92400e' : '#166534';
  ctx.font = '600 12px system-ui';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(cell.value ?? ''), cell.x + 10, cell.y + cell.height / 2);
  return true;
}
```

`CellRenderer` and `CellRenderInfo` are exported types. The shallow-frozen metadata contains raw `value`, `rowIndex`, `rowId`, `columnIndex`, `columnKey`, and `x`, `y`, `width`, `height` in CSS pixels relative to the Canvas, including the header offset. Values are not deep-frozen. Each invocation is clipped to the cell interior and its visible pane; context state is saved and restored. Set your own font, color and alignment. Keep any additional `save()`/`restore()` calls balanced and never resize the Canvas or mutate the grid/data source from the callback.

Only visible body cells are passed to the synchronous callback. Partial updates call it only for dirty visible cells; scrolling, resizing and `grid.render()` redraw visible content. External drawing state changes require `grid.render()`. A thrown callback error is logged and the default text is drawn; marks from a callback returning `false` or throwing are cleared. Drawing is a trusted extension, not a sandbox. Custom drawing does not change editing, clipboard values, permissions or screen-reader support. Core remains independent of Canvas.

## Custom native editors

Pass `createEditor(cell, document)` to return a fresh, detached `input`, `select` or `textarea` created with the supplied document. Return `null` to use the default editor. `CellEditor`, `CellEditorInfo` and `CellEditorFactory` are exported types. Metadata is shallow-frozen and contains the current selection coordinates/identity plus the raw value.

```ts
createEditor: (cell, doc) => {
  if (cell.columnKey !== 'status') return null;
  const select = doc.createElement('select');
  for (const value of ['Review', 'Active']) {
    const option = doc.createElement('option');
    option.value = option.textContent = value;
    select.append(option);
  }
  select.value = String(cell.value ?? '');
  select.required = true;
  return select;
}
```

The factory initializes the control's value, options, type and constraints. The grid owns its accessible label, positioning, styles, focus and removal. Only one editor is mounted; its overlay follows the cell's pane and clips during scrolling. Native validation runs before the shared edit command; `Column.parse` receives the control's string value, or `'true'`/`'false'` from a checkbox's checked state. Non-string values require a parser. Current permissions are checked at commit, with the same events/history/partial repaint as text editing.

Enter commits, Escape cancels, and blur commits; IME composition does not commit. Textareas accept Alt/Ctrl/Cmd+Enter for a newline; Tab/Shift+Tab save and move to the next/previous cell. Other controls retain native Tab behavior. Failed validation/parser/write keeps the draft with `aria-invalid` and an associated inline alert; input/change clears the error for retry. Native control keys and clipboard stay in the editor. Factory errors or invalid/attached/foreign-document elements produce an alert without mounting an editor. Destroy removes the editor and discards its draft. Factories must not mutate grid/source or install external listeners requiring cleanup; composite widgets, framework components, async validation and custom lifecycle callbacks are not supported.

## API

`LocalDataSource(rows, getRowId)` copies the row array and shallow-copies each row. IDs must be unique strings or finite numbers. Nested objects are not cloned. Use setValue(index, columnKey, value) to replace an existing field without mutating caller rows. Row IDs stay fixed at construction. Invalid indices and missing fields are rejected; missing properties return `undefined`, while invalid row indices throw `RangeError`.

The `DataSource` interface exposes `getRowCount()`, `getRowId(index)`, and `getValue(index, columnKey)`. Grid dimensions use the row count at mount time; changing the row count requires remounting. Custom sources must provide synchronous values and valid counts.

`createGrid(options)` returns `selectRow(index)`, `selectColumn(index)`, `openSearch()`, `setFrozen(rows, columns)`, `setLocked(target, locked)`, `format(targets, patch)`, size/query helpers, `render()`, `updateCells(updates)`, `undo()`, `redo()`, `getCellPermission(rowIndex, columnIndex)`, `getSelection()`, `getSelectionRange()`, `copySelection()`, `paste(text)` and `destroy()`. `render()` schedules a viewport redraw, coalesced into the next animation frame. `destroy()` removes only the grid's own DOM and releases its listeners and observer; repeated calls are safe. Calls to `render()` after destruction do nothing.

Column keys must be unique. All cell dimensions must be positive finite numbers. Values are rendered as plain text using `String(value)`; `null` and `undefined` display as empty cells.

## Limits

All local rows reside in memory. Virtualization bounds cell rendering work, not data storage. Native scrolling is subject to browser scroll-size limits, so this preview does not guarantee arbitrary dataset dimensions. Composite editors and asynchronous editor lifecycle are not implemented.

## Selection and keyboard

Click a data cell to select it and focus the viewport. Arrow keys move one cell; Home/End move to the first/last column; Ctrl/Meta+Home/End move to the first/last cell. Navigation clamps at dataset boundaries and scrolls the active cell into view. With no selection, arrows/Home start at the first cell; End starts at the last column and Ctrl/Meta+End at the last cell. Escape clears selection; Tab leaves the viewport normally. Shift-modified navigation extends a rectangular range. See range selection and clipboard below.

`grid.getSelection()` returns a fresh `{ rowIndex, rowId, columnIndex, columnKey }` object or `null`. Indices are zero-based. Pass `onSelectionChange(selection)` to `createGrid` to observe changes, including `null` when cleared. Callback objects are copies; selecting the same cell does not fire again. Destroy clears selection without emitting an event. Headers select whole columns; blank space and scrollbar clicks do not select cells. Ctrl/Meta+click adds a range and Shift-click extends it. The viewport label describes the active cell, but a complete accessible grid representation is not implemented.
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

Columns are read-only by default. Without a parser, only string/null/undefined values can be edited; saved values are strings. A parser can return a typed value or throw a validation error. Parser/setter errors keep the draft input open with an inline validation alert. Unchanged text does not call the setter. IME composition does not commit on Enter. Keep identity columns read-only: local row IDs remain stable even if their original field value changes.

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

Each call is one undoable command, including edits committed through the DOM editor. Repeated cells use the last supplied value; unchanged values are skipped using `Object.is`. These APIs take zero-based row indices and already validated values: they do not run column parsers or enforce the UI's `editable` flag. Invalid indices/unknown grid columns and denied writable permissions are rejected before any write.

`LocalDataSource.setValues(updates)` validates all fields and builds replacement rows before committing the batch. Custom sources must provide a synchronous, atomic `setValues(updates)` for multiple-cell commands; a single-cell command can use `setValue`. Setters must leave data unchanged when throwing. A failed command or replay does not move history. Async setters are unsupported.

The grid retains the latest 100 commands, with shallow old/new value references. This limits command count, not memory bytes. New changes clear redo; no-ops preserve it. Undo/redo reject conflicts if a recorded row ID or current value differs after external mutation. Direct source writes are outside history and require `grid.render()`.

When the viewport has focus, Ctrl/Cmd+Z undoes and Ctrl/Cmd+Shift+Z or Ctrl/Cmd+Y redoes. The DOM editor keeps native text undo. `updateCells` throws while editing or after destruction; undo/redo return `false` while editing, after destruction or when the stack is empty. Destroy releases both history stacks.

Value commands coalesce dirty cells into one animation frame. Offscreen changes are read when scrolled into view. Scroll, resize, selection changes and explicit `render()` request a full viewport redraw. Undoable layout commands, async history and persistent history are not implemented.

## Range selection and clipboard

Drag with a mouse/pen, Shift-click, or use Shift+Arrow/Home/End to extend a rectangular range from its anchor. Ctrl/Cmd+Shift+Home/End extends to the first/last grid cell. Ordinary clicks or navigation collapse the range; Escape clears it. Dragging captures the pointer and clamps to viewport/data bounds. Mouse/pen dragging auto-scrolls while the pointer stays within 24px of a scrolling edge or outside the viewport, at 16 CSS pixels per animation frame. Release, cancellation, capture loss, Escape, window blur or destruction stops the loop. Touch range dragging is not implemented. Multiple ranges are supported; clipboard operations require one rectangle.

`getSelection()` still returns the active endpoint. `getSelectionRange()` returns a fresh normalized `{ startRow, endRow, startColumn, endColumn }` object or `null`; bounds are zero-based and inclusive. `onSelectionRangeChange(range)` receives a copy when bounds change, or `null` on clear. The grid draws both the outer range and active-cell borders. Editing changes the active cell while keeping the range.

```js
const text = grid.copySelection(); // TSV; does not access the system clipboard
grid.paste('Grace\tOperations\r\nAda\tDesign'); // one undoable command
```

Native copy/paste events support Ctrl/Cmd+C/V on the focused viewport without Clipboard API permissions. The text editor keeps native clipboard behavior. Copy exports values only, with null/undefined as empty text. TSV quotes tabs/newlines/quotes and doubles embedded quotes. Paste accepts quoted multiline TSV with tab and CRLF/LF/CR separators; one trailing row separator is ignored. Ragged rows and malformed quotes are rejected.

Paste starts at the selected range's top-left cell and uses the clipboard rectangle's dimensions. It does not tile/fill the selection, add rows or skip read-only columns. Every destination must be within bounds and permit `pasteable`/`writable`; values pass through column parsers. Non-string existing values require a parser. All values are validated before the atomic write, so parser/bounds/read-only failures leave data/history unchanged. Multi-cell paste requires an atomic source `setValues` implementation.

Clipboard work is limited to 100,000 cells and 10,000,000 UTF-16 code units per payload. Over-limit transfers throw `RangeError`. Copy/paste APIs throw while editing or after destruction; no selection yields empty copy/no-op paste. Event errors use native alerts. HTML-only clipboard, cut and formula processing are not supported. Actual OS clipboard and spreadsheet interoperability have not been verified; browser tests exercise native event handlers with controlled `DataTransfer` payloads.

## Row/column resize and context menu

```js
grid.setColumnWidth(1, 240);
grid.setRowHeight(0, 48);
```

Sizes are finite positive CSS pixel values; indices are zero-based integers. Invalid indices/sizes are rejected before layout changes. Calls throw while editing or after destruction. Sizes default to `columnWidth`/`rowHeight`, with sparse per-index overrides; rows do not require a size array. Resizing updates scroll dimensions and fully redraws, keeping hit testing, editor placement and selection aligned. Layout changes are in memory and are outside data undo/redo.

Drag within 8 CSS pixels of a header edge to preview a column resize (24–1000px); release to apply. Row boundaries in the default index gutter also support resize preview. Right-click a cell and choose **Resize column…** or **Resize row…** for a native DOM dialog with a labeled number input, Apply and Cancel. The dialog accepts sizes of at least 1px. Double-click a column/header or index-row boundary, or choose Auto-fit column/row from the menu, to fit visible content. Persisted layout is not implemented.

The built-in cell menu also provides **Copy**, **Paste**, **Edit cell**, **Undo** and **Redo**. Right-clicking within the range preserves it and its active endpoint; right-clicking elsewhere selects that cell without scrolling. Resize targets the clicked cell, while Edit targets the active cell. Headers open Column actions and suppress the browser menu. Index numbers open the existing row/cell actions. Blank space and editor inputs retain their native context menu.

Shift+F10 or the ContextMenu key opens the menu for the active cell. Arrow keys, Home and End navigate enabled items; Enter/Space activates. Escape/Tab returns focus to the viewport. Outside clicks, scrolling, resizing and destruction dismiss the menu. The popover stays inside the browser window.

Menu Copy/Paste calls `navigator.clipboard` only from the clicked action and requires browser support, a secure context and any required browser permission. It does not read the clipboard when opening the menu. Errors are shown in an accessible message with a keyboard-shortcut fallback. An async paste is rejected if its target range changes before the clipboard read finishes. Ctrl/Cmd+C/V on the grid and native editor clipboard remain available. Custom menu items are not implemented.

## Render-callback benchmark

Run `npm run benchmark` from the engine root. The installed Playwright runner measures callbacks that draw a viewport of a lazy 1,000,000-row × 1,000-column source, including sparse resize overrides, scrolling and partial updates. JSON output reports sample counts, median/P95 callback time and maximum source cell reads. The fixture uses a 640×360 CSS pixel grid.

This measures synchronous JavaScript/Canvas callback cost in headless Chromium. It does not measure deferred rasterization, compositor/GPU work, end-to-end FPS or peak memory, and does not claim 60 FPS on other hardware or browsers.

## Capabilities and typed events

Canvas forwards `permissions`, column `permissions`, `resolveCellPermission(cell)` and `onEvent(event)` to core, and exposes `getCellPermission(rowIndex, columnIndex)`. See the [core contract](../core/README.md#capabilities-and-domain-events) for veto precedence, atomic batches, current-policy history checks, event payloads and callback errors.

A read-only row can still be selected/copied with `resolveCellPermission: cell => cell.rowId === 'locked' ? { writable: false } : undefined`. Denied selection targets retain the previous endpoint and do not scroll or fire legacy selection callbacks. Right-clicking a non-selectable cell does not open its action menu. Edit/Paste reflect resolved capabilities; Copy reflects the active cell and still validates the whole range when invoked. Dynamic policy changes require `grid.render()` to refresh the UI; an open editor rechecks at commit and retains its draft on denial. `onEvent` is synchronous and cannot cancel an already committed change.

## Frozen leading rows and columns

Pass `frozenRows: 1, frozenColumns: 1` to `createGrid` to keep the first data row and leftmost column visible while scrolling. Defaults are zero; counts must be safe integers between zero and the corresponding dataset count. Call `grid.setFrozen(rows, columns)` to change both counts atomically; `grid.frozenRows` and `grid.frozenColumns` expose current readonly counts. The pinned header does not count as a frozen row. Oversized frozen prefixes are clipped and may leave no scrolling area; resize the viewport or reduce the counts to expose hidden cells.

Canvas uses one native scroller and one Canvas, clipping the corner/top/left/body regions. Sparse resize, dirty-cell updates, selection/range borders and hit testing use the [core viewport contract](../core/README.md#frozen-panes-and-viewport-geometry). Keyboard navigation reveals only non-frozen dimensions in the remaining scrollable area. Non-selectable targets retain selection as before. Right-click/keyboard menu and header-edge resize target the visible cell/column, including at the frozen seam.

The single DOM editor uses a clipped overlay following its pane. A frozen editor stays fixed on that dimension; a scrolling editor cannot cover a frozen pane. Scrolling the edited cell offscreen clips the input while preserving its draft/focus, without committing or cancelling it. Commit still rechecks permissions. Frozen counts/resize are outside data history. Right/bottom freezing and layout history are not implemented. Native browser scroll-size and accessibility limitations remain.

## Multiple selection ranges

Ctrl/Cmd+click retains previous rectangles and starts a new active range. Shift/click/drag and Shift navigation extend the active range. Shift+F8 arms the next unshifted click/navigation to add a range; press it again or Escape to cancel that mode. This supports keyboard addition, for example Shift+F8 then Ctrl+End and Shift+ArrowLeft. Plain click/navigation replaces the selection; Escape clears all ranges. Overlapping rectangles are kept separately, with a maximum of 128.

`getSelectionRanges()` returns copies, active range last; `getSelectionRange()` remains the active rectangle. `onSelectionRangesChange` receives copies when the list changes. Existing single-range/cell callbacks retain their semantics; domain `selection:change` now also carries a frozen `ranges` array. Editing preserves all ranges and changes the active cell. Right-click inside the active rectangle preserves the set; outside it selects a new single cell. Copy/paste are disabled for multiple ranges, and their APIs reject the operation before cell reads/writes. Borders use the same frozen-pane clips and partial repaint path; partial updates redraw borders only inside dirty cells, including translucent colors.

The viewport exposes Shift+F8 via `aria-keyshortcuts` and announces active position, range count and pending-add mode through a polite status region. This is focused interaction support; A bounded active-cell ARIA mirror exposes the active position/value; complete row/header traversal and screen-reader coverage remain unverified.

## Resize preview

Drag within 8px of a column header edge for a vertical guide, or within the first column when columns are frozen (otherwise the leftmost 10px of the viewport) near a row edge for a horizontal guide. Sizes stay unchanged during dragging. Release applies one resize command; Escape, pointer cancellation, capture loss, viewport/layout redraw or destroy discard the draft. Column/row drafts clamp to 24–1000px. The guide follows the theme selection color and stays within the viewport. Selection is preserved. Numeric resize dialogs and programmatic size APIs still apply immediately; no layout undo history is added.

## Multiline editing and wrapping

Set `multilineEditor: true` to use an expanding textarea instead of the default input. It grows with its contents within the edited cell's viewport pane, preserving frozen panes and header boundaries. Scrolling the anchor cell offscreen hides the overlay while retaining its draft. Custom factories still take precedence; their textareas use the same growth and keyboard handling.

Set `wrapText: true` to draw text on multiple lines within existing cell bounds. Both options default to `false`. Wrapping respects explicit newlines and available width; row heights do not change automatically. Resize rows to show more lines. Custom renderers retain control of their content. These settings apply to the grid at construction; per-column wrapping and async validation remain unsupported.

## Find in grid

Call `grid.openSearch()` or press Ctrl/Cmd+F while focused inside the grid. Search is case-insensitive literal substring matching of raw values converted to strings, in row/column order. It searches local synchronous values, excluding cells denied selection; it does not filter rows or search column titles. Enter/Shift+Enter and the next/previous buttons wrap around matches. The count and amber outlines identify matches; the active result is selected and revealed using the existing pane geometry. Escape or Close search removes outlines and returns focus to the viewport, preserving selection.

An invalid editor draft blocks opening search. Search refreshes after grid commands; call `grid.render()` after external data/policy changes. Query input is debounced by 150ms. The scan costs O(rows × columns) per query/navigation, with O(matches) temporary coordinates; it is intended for modest local datasets, not remote/lazy sources or huge datasets. Search errors appear in the search status, without modifying data. There is no regex, replacement, server search or search index.

## Runtime frozen changes

Runtime frozen changes preserve values, selection/ranges and data undo history. No-op/invalid changes emit nothing; changes emit `freeze:change` with `previousRows`, `previousColumns`, `rows` and `columns`, after layout invalidation. Canvas setters throw while editing or destroyed. The cell menu freezes prefixes through the clicked row/column, both through the cell, or unfreezes rows/columns/table. Menu freeze actions are disabled if the requested prefix would consume the viewport; the API still allows all-frozen layouts. These actions do not lock editing.

## Cell, row, column and table locks

`setLocked(target, locked)` adds/removes a value lock. Targets are `{ scope: 'table' }`, `{ scope: 'row', rowIndex }`, `{ scope: 'column', columnIndex }`, or `{ scope: 'cell', rowIndex, columnIndex }`, with zero-based coordinates. `isLocked(target)` reports the explicit lock at that scope. Any applicable lock vetoes writable/editable/pasteable; selection/copy retain their permissions. Unlocking a cell does not clear a row/column/table lock; unlocking the table removes only its table flag.

Locks use sparse sets and preserve selection and data undo history, but are themselves outside history and disappear on destroy/remount. API/edit/paste/undo/redo all enforce current locks. `lock:change` carries a frozen `target` and `locked`, after layout invalidation; no-op/invalid requests emit nothing. Canvas setters throw while editing or destroyed. Right-click provides Lock/Unlock actions and indicates when the cell is read-only.

Host policies retain their false veto after unlock. Set `allowLockChanges: false` at construction to disable management in the API/menu; `canManageLocks()` reports availability. Use grid/column/resolver permissions for mandatory application restrictions. These local controls do not replace server authorization. Use the formatting capability for color restrictions; persisted/user-specific locks are not provided here.

## Configured column editors

Use `columnEditors: { status: { type: 'select', values: ['Review', 'Active'] }, approved: { type: 'checkbox' } }` for native editors without a factory. Select values must be a nonempty array of unique nonempty strings; configurations are snapshotted at construction. A custom `createEditor` result takes precedence. Provide a column parser to validate allowed choices on paste as well as editing.

Checkbox cells store booleans and draw a checkbox in Canvas. Clicking the box toggles through the edit command; clicking elsewhere selects normally. F2 opens a native checkbox; Space changes it, Enter saves, Escape cancels. Editable checkbox columns require a parser accepting only `'true'`/`'false'` and returning a boolean; read-only checkbox columns can omit it. Non-boolean values cannot open the built-in editor. Permissions/locks, parsing, events and undo/redo share the existing pipeline. Custom renderers can override checkbox drawing. No DOM checkbox is created for each row.

## Images in cells

Set `imageColumns: ['avatar']` for URL-valued columns. Images use contain sizing with padding, preserving aspect ratio and cell/pane clipping; empty values draw nothing. Loading and unavailable states are drawn inside the cell. Custom renderers take precedence. Image completion schedules repaint without closing menus or changing layout. Image value changes repaint the viewport so old resources can be released; ordinary text changes still use dirty-cell repaint.

Only visible cells request images, sharing one image per visible URL. The cache is pruned on full redraw/scroll and handlers are released on eviction/destroy. Pending browser requests may finish after eviction, but cannot repaint the destroyed grid. URLs can be relative, HTTP(S), image data URLs or blob URLs; other schemes are rejected. Images use anonymous CORS and no referrer, so cross-origin servers must permit CORS. Callers own blob URLs. There is no image upload, cropping, gallery or automatic row sizing. Canvas screen-reader limitations still apply.

## Cell formatting and admin control

Right-click → **Format cells…** opens the native color dialog. Choose selected cells (including multiple ranges), this row, this column or the whole table. Apply changes enabled background/text colors; Clear formatting resets both colors to theme defaults in that scope. Escape/Cancel dismisses. Formatting preserves values and selection, shares Ctrl/Cmd+Z/Y history with edits, and throws through the API while editing or destroyed.

Canvas exposes core `format(targets, patch)`, `canFormat(targets)`, and `getFormat(row, col)`; see the [core formatting contract](../core/README.md#sparse-cell-formatting). Set `permissions: { formatting: false }`, column permissions, or a resolver veto to disable formatting in the menu, API and history, independently of editing. Existing colors remain visible. The demo admin checkbox illustrates this host policy; it is not server authorization.

Default text, checkbox strokes, cell backgrounds and native editor colors use effective styles. Custom renderers receive frozen `cell.format` and decide how to apply content colors; their paint may override the cell background. Color changes repaint the viewport, while value updates retain dirty-cell drawing. Headers retain the theme. Only colors are supported; fonts, borders, formatting clipboard and persistence remain outside this preview.

## Active-cell accessibility

The focusable viewport exposes `role="grid"`, total data row/column counts and multi-selection support. In the default active accessibility mode, a single visually hidden row/gridcell mirrors the active cell, with one-based row/column indices, column title, raw value, selected and read-only state. `aria-activedescendant` references that owned cell while keyboard focus remains on the viewport. Native editors retain their own focus/validation; Escape clears the mirror, and destroy removes it. IDs are unique across mounts. No per-dataset DOM tree is created.

Selection, value edits/undo/redo, locks and `grid.render()` refresh this mirror. It retains the active cell when scrolled offscreen; application-owned value/permission changes require `grid.render()`. This adds bounded active-cell reads, rather than scanning the dataset. Images default to an image label, while custom paint defaults to raw text. Supply `getCellLabel` for meaningful image/custom visual descriptions. Selection status announces range count but does not mirror every selected cell. Browser semantics are tested; NVDA/JAWS/VoiceOver announcements and complete browse-mode row/header traversal remain unverified. The approach follows [W3C grid and focus guidance](https://www.w3.org/WAI/ARIA/apg/patterns/grid/).

## State indicators

Locked columns/tables show a small lock icon on their headers; explicit row locks show a smaller SVG icon beside the index number (or in the leading visible cell when `indexColumn: false`), and individual cell locks show it in that cell. Locked index numbers and column headers have a light tint. Permission-disabled cells are muted. Default noneditable display columns are not considered disabled. Native hover hints and the active ARIA description explain the scope; resize edges retain their resize hints. A lock takes priority over write-denial attribution, while selection denial still reports disabled. External policy changes require `grid.render()`.

Frozen boundaries are two continuous pointer-transparent DOM rules: a vertical rule spans header and body, and a horizontal rule spans the full viewport width. They move with geometry and disappear on unfreeze; boundaries beyond the viewport are hidden. No letter badges are painted inside cells. Narrow cells can clip the lock icon; custom renderers/images receive the same state overlay.

## Whole-row/column selection and header menus

Click a column header to select all its data rows. Click its index number (or within the leftmost 10px of a data row, away from a resize boundary), use Shift+Space for the active row, or Ctrl/Cmd+Space for the active column. `grid.selectRow(index)` / `grid.selectColumn(index)` expose the same behavior. Selected axes receive a light tint and the existing range outline; the corresponding column header is highlighted. Shift-click an index/header extends from the axis anchor; mouse/pen dragging selects adjacent axes and auto-scrolls only that axis. The corner # button or Ctrl/Cmd+A selects the whole data rectangle; `grid.selectAll()` exposes the same action. Empty axes do not create a selection. Endpoint selection permissions are checked atomically, and copy/paste retain their existing range/size/permission checks. These operations replace prior ranges and do not allocate per-cell state.

Header right-click suppresses the browser menu and opens Column actions, including select, sort, filter, locks, freeze and resize. Empty filtered views still expose sort/filter/clear actions. Native input/editor context menus remain available. Body menus also provide Select row/column.

## Local sort/filter integration

Pass a current `view` (`LocalViewOptions`) and `onViewChange(nextView)` to enable header sort/filter actions. The callback owns constructing a new `LocalDataView` from the original source and remounting the grid; examples demonstrate this contract. Sorting/filtering are opt-in, synchronous local operations, not remote querying. The new view keeps edited source values, but remount clears selection, undo history, local locks, colors and custom sizing. The dialog states this before Apply view. Mandatory application permissions must use stable rowId/columnKey and remain enforced on the new mount. Build the projection before destroying the old grid so failed filtering leaves the draft and old view intact.

Sort is single-column ascending/descending. Filters combine columns with AND, using case-insensitive contains/equals or has-value/is-empty conditions. Empty contains/equals text removes that column filter; Clear sort and filters restores original source order. Sort/filter icons and header tooltips indicate applied criteria. Editing does not automatically move or remove a row; reapply the view to refresh its criteria. See [LocalDataView](../core/README.md#local-row-views).

State indicators use embedded [Lucide SVG icons](https://lucide.dev/icons), colored with `headerTextColor`. Four images are cached per mounted grid; no icon font, runtime library or external icon request is needed. Attribution and terms are included in `LICENSE.lucide`.

A fixed row index gutter is shown by default (`indexColumn: false` hides it). Numbers start at 1 in the current view, including after sorting/filtering. Click a number to select its row, right-click for row/cell actions, or drag its lower boundary to resize the row. It is UI chrome: column indexes, frozen-column counts, data, search and clipboard content still refer only to supplied columns. Only visible row controls are created.

## Dialogs

Filter/sort, resize and formatting dialogs use native `showModal()` with grid-scoped styles for centering, a viewport-bounded width/height, backdrop, controls, focus rings and action spacing. Escape/Cancel dismiss the dialog and restore grid focus. They share the mount's theme and require a browser supporting native dialog and popover APIs.

## License

Original Acheron Grid code is licensed under [MIT](LICENSE). Copyright (c) 2026 Hao Duong. Embedded Lucide icons retain their ISC/MIT attribution in [LICENSE.lucide](LICENSE.lucide), included in this package's file list. Keep those notices when redistributing the assets or a bundle containing them.

## Auto-fit visible content

`grid.autoFitColumn(index)` measures the header and current visible/frozen rows; `grid.autoFitRow(index)` measures current visible/frozen columns. Double-click a resize boundary or use the corresponding context-menu action. Fit commands use the existing resize pipeline/events, preserving selection and value history. They reject invalid indexes and calls while editing/destroyed.

Sizes clamp to 24–1000 CSS pixels. Text width uses the mount's fonts and explicit newlines; row height accounts for wrapping when `wrapText: true`. Checkbox and image columns use bounded control/image slots. Offscreen values outside the measured axis are not scanned. Custom drawings may need explicit sizing, because their arbitrary output cannot be measured from raw values. Row heights do not grow automatically after edits; reapply fit when content changes.

## Links

`detectLinks(value)` is an exported, DOM-independent module returning `{ text, href, start, end }` records. It recognizes HTTP(S) and `www.` URLs inside text, trims sentence punctuation, preserves balanced parentheses and normalizes `www.` to HTTPS. HTML, relative URLs, other schemes and URLs containing credentials are not interpreted. No requests are made during detection.

The default painter colors and underlines detected spans with `theme.linkColor`; custom renderers own their drawing. Ordinary click selects and F2/double-click edits. Alt+click, Alt+Enter or **Open links…** in the cell menu opens a bounded popover of native links. Each uses `_blank`, `noopener noreferrer` and `no-referrer`. Multiple links retain their original text; raw data, clipboard and history stay unchanged. Image columns retain their image behavior. Set `detectLinks: false` to disable recognition, or `allowOpenLinks: false` to keep the visual links while disabling grid link actions. These options are mount policies, not browser security restrictions.

## Keyboard, touch and viewport accessibility

Visible headers are keyboard focusable: Tab to a header, Enter/Space selects its column, Shift+F10 opens column actions. Ctrl/Cmd+click on index/header or Shift+F8 adds a separate axis range; Shift-click/drag extends only the active range. All ranges use the same endpoint permissions and 128-range limit. Copy/paste still require one range.

Touch-drag index/header selects axes; touching body cells preserves native scrolling. After a touch cell selection, two handles adjust the active range and support edge auto-scroll, including across frozen panes. Handles disappear when selection clears or an editor opens.

`accessibility: 'viewport'` exposes bounded visible/frozen rows, cells and headers through an ARIA grid tree. It reuses values read by Canvas, with selected/read-only/state descriptions and correct sparse row/column indexes. Row count includes the header in this mode. An offscreen active cell retains a separate mirror; visible active cells use their viewport node. `getCellLabel(rowIndex, columnKey, value)` may return an accessible label for custom drawings or images, or `undefined` for the default. Images default to an image label rather than reading their URL. The default `'active'` mode retains the compact active-cell mirror and its data-only row count. Both modes retain native editor focus. Browser semantics are tested; NVDA/JAWS/VoiceOver behavior still needs manual verification.

## Runtime appearance

`grid.setTheme(patch)` validates concrete CSS colors/fonts before applying a snapshot. Canvas, native controls, dialogs, links and icon colors repaint without remounting. Selection, locks, formatting, sizes, frozen panes and value history remain. Per-cell colors retain precedence; font changes do not automatically resize cells. The examples include Light/Teal/Dark palettes. Custom renderers own their colors and the host remains responsible for contrast.


## Grouped headers and content height

Keep `columns` flat; pass `headerGroups` to describe contiguous groups by column key. Ungrouped columns span the full header height. `headerHeight` is the height of **one header row**, with one row by default.

```ts
headerGroups: [{ title: 'Result', children: [
  { title: 'Mobile', children: ['ios', 'android'] },
  { title: 'Desktop', children: ['chrome'] },
] }],
headerHeight: 28,
autoRowHeight: true,
wrapText: true,
```

Groups must contain unique, existing leaf keys in the same contiguous order as `columns`; depth is capped at 16. Group labels are structural, while leaf headers retain selection, keyboard actions, sort/filter and resize. Group geometry follows column sizes and frozen/scrolling panes. Viewport accessibility exposes header rows and row/column spans; group fragments may repeat when split by a frozen boundary.

`autoRowHeight` measures visible rows against visible columns, after edits, column resizing, horizontal scrolling and font/theme changes. It uses sparse row sizes, caps height at 1000px and preserves explicit `setRowHeight`/drag/auto-fit sizes. It does not scan the whole dataset or offscreen columns. Custom renderers can supply `measureCellHeight(value, columnKey, width)`: return a positive finite height, or `undefined` for built-in text measurement. This callback must be synchronous and side-effect free. With automatic height enabled, font changes can resize rows that were not manually sized.

Select editor lists may include `''` as an optional empty value; all values remain unique strings and the list must be nonempty. Parsers still validate commits. A desktop corner handle adjusts the selected range through the same pointer/permission pipeline as touch handles; it does not autofill values.


Scrollbars use native thin styling, with `scrollbarColor` for the thumb and `headerBackground` for the track. Frozen boundaries use the independent `freezeColor`, keeping them distinct from selection. Both colors support `setTheme`; scrollbar thickness follows browser/platform support with an 8px WebKit fallback.


`columnEditors: { tags: { type: 'multiselect', values: ['Idea', 'Design', 'Content'] } }` uses a native multiple-select list. Ctrl/Cmd-click toggles options; Enter saves and Escape cancels. Selected labels serialize as a comma-separated string through the column parser; option labels must be unique, nonempty and contain no commas. An empty selection saves an empty string. Active cells use a 1px outline; the corresponding leaf header and every ancestor group receive a tint.

### Choice panels and host-controlled reordering

Set `choiceEditor: {}` to replace built-in select/multiselect presentation with a searchable panel. Radios choose one value; checkboxes choose several without modifier keys. Apply/Enter commits through the existing parser, permissions and history; Cancel/Escape discards the draft. Native editors remain the default and `createEditor` overrides retain their own presentation.

Customize `placeholder`, `maxHeight`, `applyLabel`, `cancelLabel`, `emptyLabel` and `renderOption(info, document)` (return a detached element from that document). Theme variables style the panel; `[data-grid-choices]` and `[data-grid-reorder]` expose styling hooks. `renderCell` controls display chips, while `createEditor` can replace the editor completely. `selectionStyle: { activeBorderWidth: 1, headerTintOpacity: 0.12 }` controls the outline (1–4px) and header tint (0–1); selection color is in the theme.

Providing `onReorder(request)` enables dragging selected whole rows/columns directly from their visible index/header, with a grab cursor and no extra icon. Dragging moves all selected items of that axis. Selected group headers move their complete contiguous block. Drop on the first/second half of a target to insert before/after it. Focus a selected index/header and press Alt+arrow to move its item/group one position with the keyboard. Native HTML drag requires a pointer; touch reordering is not implemented.

`request` contains `axis: 'row' | 'column'`, immutable `indices` and `beforeIndex`, an insertion boundary in the current order **before removal**. `canReorder(request)` can veto the operation. `reorderedIndices(count, indices, beforeIndex)` validates the request and returns a stable index permutation. The host owns source/column ordering, row identity, grouped-header constraints and reconciliation of selection, locks, formatting, sizes and history; Canvas does not silently mutate these coordinate-based states. Omit `onReorder` to disable reordering entirely.
