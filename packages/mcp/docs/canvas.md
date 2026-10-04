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
- Per-column rich text with HTML or an optional host-provided Markdown adapter.

This package is a development preview, not a published release. Explicit read-only remote paging is available through core's `createAsyncDataSource`; the host controls loading. React and Vue lifecycle adapters are available in separate packages. The active cell has a bounded ARIA grid mirror; full screen-reader coverage has not been verified. A headless render-callback benchmark is available; end-to-end frame rate has not been verified.

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

Enter commits, Escape cancels, and blur commits unless the editor is pinned; IME composition does not commit. Textareas accept Alt/Ctrl/Cmd+Enter for a newline; Tab/Shift+Tab save and move to the next/previous cell. Other controls retain native Tab behavior. Failed validation/parser/write keeps the draft with `aria-invalid` and an associated inline alert; input/change clears the error for retry. Native control keys and clipboard stay in the editor. Factory errors or invalid/attached/foreign-document elements produce an alert without mounting an editor. Destroy removes the editor and discards its draft. Factories must not mutate grid/source. Use `onEditorMount` to mount external UI and return its cleanup; see Developer integration recipes. Async validation is not supported.

## API

`LocalDataSource(rows, getRowId)` copies the row array and shallow-copies each row. IDs must be unique strings or finite numbers. Nested objects are not cloned. Use setValue(index, columnKey, value) to replace an existing field without mutating caller rows. Row IDs stay stable through structural commands. Invalid indices and missing fields are rejected; missing properties return `undefined`, while invalid row indices throw `RangeError`.

The `DataSource` interface exposes `getRowCount()`, `getRowId(index)`, and `getValue(index, columnKey)`. Use grid structural commands to change row count while preserving the mount. External source dimension changes are not automatically observed; call `refreshData(previousIds)` after capturing identities before a host structural change. Custom sources must provide synchronous values and valid counts.

`createGrid(options)` returns `selectRow(index)`, `selectColumn(index)`, `openSearch()`, `setFrozen(rows, columns)`, `setLocked(target, locked)`, `format(targets, patch)`, size/query helpers, `render()`, `updateCells(updates)`, `undo()`, `redo()`, `getCellPermission(rowIndex, columnIndex)`, `getSelection()`, `getSelectionRange()`, `copySelection()`, `paste(text)` and `destroy()`. `render()` schedules a viewport redraw, coalesced into the next animation frame. `destroy()` removes only the grid's own DOM and releases its listeners and observer; repeated calls are safe. Calls to `render()` after destruction do nothing.

Column keys must be unique. All cell dimensions must be positive finite numbers. Values are rendered as plain text using `String(value)`; `null` and `undefined` display as empty cells.

## Limits

All local rows reside in memory. Virtualization bounds cell rendering work, not data storage. Native scrolling is subject to browser scroll-size limits, so this preview does not guarantee arbitrary dataset dimensions. External editor UI can use `onEditorMount`; asynchronous validation and setters are not implemented.

## Selection and keyboard

Click a data cell to select it and focus the viewport. Arrow keys move one cell; Home/End move to the first/last column; Ctrl/Meta+Home/End move to the first/last cell. Navigation clamps at dataset boundaries and scrolls the active cell into view. With no selection, arrows/Home start at the first cell; End starts at the last column and Ctrl/Meta+End at the last cell. Escape clears selection; Tab leaves the viewport normally. Shift-modified navigation extends a rectangular range. See range selection and clipboard below.

`grid.getSelection()` returns a fresh `{ rowIndex, rowId, columnIndex, columnKey }` object or `null`. Indices are zero-based. Pass `onSelectionChange(selection)` to `createGrid` to observe changes, including `null` when cleared. Callback objects are copies; selecting the same cell does not fire again. Destroy clears selection without emitting an event. Headers select whole columns; blank space and scrollbar clicks do not select cells. Ctrl/Meta+click adds a range and Shift-click extends it. The viewport label describes the active cell, and the optional viewport accessibility mode exposes bounded visible rows, cells and headers; assistive-technology verification remains incomplete.
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

After external value writes with unchanged row identities/order/count, call `grid.refreshData('values')` to reconcile and redraw. Grid commands repaint only changed cells in the viewport through the existing frame scheduler. Async writes and automatic source subscriptions are not implemented.

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

The grid retains the latest 100 commands, with shallow old/new value references. This limits command count, not memory bytes. New changes clear redo; no-ops preserve it. Undo/redo reject conflicts if a recorded row ID or current value differs after external mutation. Direct source writes are outside history; use `refreshData` to reconcile and clear stale history.

When the viewport has focus, Ctrl/Cmd+Z undoes and Ctrl/Cmd+Shift+Z or Ctrl/Cmd+Y redoes. The DOM editor keeps native text undo. `updateCells` throws while editing or after destruction; undo/redo return `false` while editing, after destruction or when the stack is empty. Destroy releases both history stacks.

Value commands coalesce dirty cells into one animation frame. Offscreen changes are read when scrolled into view. Scroll, resize, selection changes and explicit `render()` request a full viewport redraw. Explicit resize/freeze and structural commands share history; async and persistent history are not implemented.

## Range selection and clipboard

Drag with a mouse/pen, Shift-click, or use Shift+Arrow/Home/End to extend a rectangular range from its anchor. Ctrl/Cmd+Shift+Home/End extends to the first/last grid cell. Ordinary clicks or navigation collapse the range; Escape clears it. Dragging captures the pointer and clamps to viewport/data bounds. Mouse/pen dragging auto-scrolls while the pointer stays within 24px of a scrolling edge or outside the viewport, at 16 CSS pixels per animation frame. Release, cancellation, capture loss, Escape, window blur or destruction stops the loop. Touching body cells preserves native scrolling; after touch selection, range handles adjust the range with edge auto-scroll. Multiple ranges support packed TSV and structured clipboard operations; see the core clipboard contract.

`getSelection()` still returns the active endpoint. `getSelectionRange()` returns a fresh normalized `{ startRow, endRow, startColumn, endColumn }` object or `null`; bounds are zero-based and inclusive. `onSelectionRangeChange(range)` receives a copy when bounds change, or `null` on clear. The grid draws both the outer range and active-cell borders. Editing changes the active cell while keeping the range.

```js
const text = grid.copySelection(); // TSV; does not access the system clipboard
grid.paste('Grace\tOperations\r\nAda\tDesign'); // one undoable command
```

Native copy/paste events support Ctrl/Cmd+C/V on the focused viewport without Clipboard API permissions. The text editor keeps native clipboard behavior. Copy exports values only, with null/undefined as empty text. TSV quotes tabs/newlines/quotes and doubles embedded quotes. Paste accepts quoted multiline TSV with tab and CRLF/LF/CR separators; one trailing row separator is ignored. Ragged rows and malformed quotes are rejected.

Paste starts at the selected range's top-left cell and uses the clipboard rectangle's dimensions. It does not tile/fill the selection, add rows or skip read-only columns. Every destination must be within bounds and permit `pasteable`/`writable`; values pass through column parsers. Non-string existing values require a parser. All values are validated before the atomic write, so parser/bounds/read-only failures leave data/history unchanged. Multi-cell paste requires an atomic source `setValues` implementation.

Clipboard work is limited to 100,000 cells and 10,000,000 UTF-16 code units per payload. Over-limit transfers throw `RangeError`. Copy/paste APIs throw while editing or after destruction; no selection yields empty copy/no-op paste. Event errors use native alerts. Rich native clipboard and structured payloads preserve supported styles; cut and formula processing are not supported. Actual OS clipboard and spreadsheet interoperability have not been verified; browser tests exercise native event handlers with controlled `DataTransfer` payloads.

## Row/column resize and context menu

```js
grid.setColumnWidth(1, 240);
grid.setRowHeight(0, 48);
```

Sizes are finite positive CSS pixel values; indices are zero-based integers. Invalid indices/sizes are rejected before layout changes. Calls throw while editing or after destruction. Sizes default to `columnWidth`/`rowHeight`, with sparse per-index overrides; rows do not require a size array. Resizing updates scroll dimensions and fully redraws, keeping hit testing, editor placement and selection aligned. Explicit resize commands share undo/redo; automatic row measurement stays outside history.

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

The single DOM editor uses a clipped overlay following its pane. A frozen editor stays fixed on that dimension; a scrolling editor cannot cover a frozen pane. Scrolling the edited cell offscreen clips the input while preserving its draft/focus, without committing or cancelling it. Commit still rechecks permissions. Explicit frozen-count and resize changes share undo/redo history. Right/bottom freezing is not implemented. Native browser scroll-size and accessibility limitations remain.

## Multiple selection ranges

Ctrl/Cmd+click retains previous rectangles and starts a new active range. Shift/click/drag and Shift navigation extend the active range. Shift+F8 arms the next unshifted click/navigation to add a range; press it again or Escape to cancel that mode. This supports keyboard addition, for example Shift+F8 then Ctrl+End and Shift+ArrowLeft. Plain click/navigation replaces the selection; Escape clears all ranges. Overlapping rectangles are kept separately, with a maximum of 128.

`getSelectionRanges()` returns copies, active range last; `getSelectionRange()` remains the active rectangle. `onSelectionRangesChange` receives copies when the list changes. Existing single-range/cell callbacks retain their semantics; domain `selection:change` now also carries a frozen `ranges` array. Editing preserves all ranges and changes the active cell. Right-click inside the active rectangle preserves the set; outside it selects a new single cell. Copy/paste support multiple ranges. Plain TSV packs copied ranges and broadcasts pasted data at target starts. Native keyboard copy also writes application/x-acheron-grid+json; keyboard paste uses it to preserve gaps or pair equal source/target range counts. If the browser removes that format, TSV remains available. The context menu uses the browser plain-text clipboard API. All destinations validate before one atomic command. copySelectionBlocks()/pasteSelectionBlocks(text) expose the structured payload APIs. Borders use the same frozen-pane clips and partial repaint path; partial updates redraw borders only inside dirty cells, including translucent colors.

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

Use `columnEditors: { status: { type: 'select', values: ['Review', 'Active'] }, approved: { type: 'checkbox' } }` for native editors without a factory. Select values may be unique strings or `{ value, label, disabled }` objects; configurations are snapshotted, and `setColumnEditor` replaces a runtime configuration. A custom `createEditor` result takes precedence. Provide a column parser to validate allowed choices on paste as well as editing.

Checkbox cells store booleans and draw a checkbox in Canvas. Clicking the box toggles through the edit command; clicking elsewhere selects normally. F2 opens a native checkbox; Space changes it, Enter saves, Escape cancels. Editable checkbox columns require a parser accepting only `'true'`/`'false'` and returning a boolean; read-only checkbox columns can omit it. Non-boolean values cannot open the built-in editor. Permissions/locks, parsing, events and undo/redo share the existing pipeline. Custom renderers can override checkbox drawing. No DOM checkbox is created for each row.

## Images in cells

Set `imageColumns: ['avatar']` for URL-valued columns. Images use contain sizing with padding, preserving aspect ratio and cell/pane clipping; empty values draw nothing. Loading and unavailable states are drawn inside the cell. Custom renderers take precedence. Image completion schedules repaint without closing menus or changing layout. Image value changes repaint the viewport so old resources can be released; ordinary text changes still use dirty-cell repaint.

Only visible cells request images, sharing one image per visible URL. The cache is pruned on full redraw/scroll and handlers are released on eviction/destroy. Pending browser requests may finish after eviction, but cannot repaint the destroyed grid. URLs can be relative, HTTP(S), image data URLs or blob URLs; other schemes are rejected. Images use anonymous CORS and no referrer, so cross-origin servers must permit CORS. Callers own blob URLs. There is no image upload, cropping, gallery or automatic row sizing. Canvas screen-reader limitations still apply.

## Cell formatting and admin control

Right-click → **Format cells…** opens the native color dialog. Choose selected cells (including multiple ranges), this row, this column or the whole table. Apply changes enabled background/text colors; Clear formatting resets both colors to theme defaults in that scope. Escape/Cancel dismisses. Formatting preserves values and selection, shares Ctrl/Cmd+Z/Y history with edits, and throws through the API while editing or destroyed.

Canvas exposes core `format(targets, patch)`, `canFormat(targets)`, and `getFormat(row, col)`; see the [core formatting contract](../core/README.md#sparse-cell-formatting). Set `permissions: { formatting: false }`, column permissions, or a resolver veto to disable formatting in the menu, API and history, independently of editing. Existing colors remain visible. The demo admin checkbox illustrates this host policy; it is not server authorization.

Default text, checkbox strokes, cell backgrounds and native editor colors use effective styles. Custom renderers receive frozen `cell.format` and decide how to apply content colors; their paint may override the cell background. Color changes repaint the viewport, while value updates retain dirty-cell drawing. Headers retain the theme. Bold/italic and rich formatting clipboard are supported; arbitrary font families, per-cell borders and persistence of cell formatting remain outside this preview.

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

Pass the original DataSource and use grid.setView(criteria) for core-managed local sorting/filtering. Initial view is supported; header actions apply without a host callback. This retains the mount, selection, history, locks, colors and sizes. Edits automatically reapply criteria. grid.view exposes current immutable criteria. View changes are rejected while a draft is open.

Sort is single-column ascending/descending. Filters combine columns with AND, using case-insensitive contains/equals or has-value/is-empty conditions. Empty text removes that column filter; Clear restores source order. Icons, tooltips and accessible headers reflect applied criteria. Public API row indexes and renderer/editor callbacks use display coordinates; core permission resolvers and non-selection domain events use source coordinates and stable row IDs. Clear active criteria before changing source structure or replaying a structural command.

For compatibility, supplying onViewChange without viewMode retains host-managed behavior: the host supplies its LocalDataView and owns reconciliation/remounting. Set viewMode: 'core' to use internal state-preserving views with an optional notification callback; viewMode: 'host' explicitly selects the legacy contract. See [LocalDataView](../core/README.md#local-row-views).

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

Groups must contain unique, existing leaf keys in the same contiguous order as `columns`; depth is capped at 16. Click or press Enter/Space on a group header to select its complete column span. Shift extends the active axis range; Ctrl/Cmd adds it. Leaf headers retain sort/filter and resize actions. Group geometry follows column sizes and frozen/scrolling panes. Viewport accessibility exposes header rows and row/column spans; group fragments may repeat when split by a frozen boundary.

`autoRowHeight` measures visible rows against visible columns, after edits, column resizing, horizontal scrolling and font/theme changes. It uses sparse row sizes, caps height at 1000px and preserves explicit `setRowHeight`/drag/auto-fit sizes. It does not scan the whole dataset or offscreen columns. Custom renderers can supply `measureCellHeight(value, columnKey, width)`: return a positive finite height, or `undefined` for built-in text measurement. This callback must be synchronous and side-effect free. With automatic height enabled, font changes can resize rows that were not manually sized.

Select editor lists may include `''` as an optional empty value; all values remain unique strings and the list must be nonempty. Parsers still validate commits. A desktop corner handle adjusts the selected range through the same pointer/permission pipeline as touch handles; it does not autofill values.


Scrollbars use native thin styling, with `scrollbarColor` for the thumb and `headerBackground` for the track. Frozen boundaries use the independent `freezeColor`, keeping them distinct from selection. Both colors support `setTheme`; scrollbar thickness follows browser/platform support with an 8px WebKit fallback.


`columnEditors: { tags: { type: 'multiselect', values: ['Idea', 'Design', 'Content'] } }` uses a native multiple-select list. Ctrl/Cmd-click toggles options; Enter saves and Escape cancels. Selected labels serialize as a comma-separated string through the column parser; option labels must be unique, nonempty and contain no commas. An empty selection saves an empty string. Active cells use a 1px outline; the corresponding leaf header and every ancestor group receive a tint.

### Choice panels and host-controlled reordering

Set `choiceEditor: {}` to replace built-in select/multiselect presentation with a searchable panel. Radios choose one value; checkboxes choose several without modifier keys. Apply/Enter commits through the existing parser, permissions and history; Cancel/Escape discards the draft. Native editors remain the default and `createEditor` overrides retain their own presentation.

Customize `placeholder`, `maxHeight`, `applyLabel`, `cancelLabel`, `emptyLabel` and `renderOption(info, document)` (return a detached element from that document). `info.columnKey` identifies the column so option colors can share the same palette as display chips. Theme variables style the panel; `[data-grid-choices]` and `[data-grid-reorder]` expose styling hooks. `renderCell` controls display chips, while `createEditor` can replace the editor completely. `selectionStyle: { activeBorderWidth: 1, headerTintOpacity: 0.12 }` controls the outline (1–4px) and header tint (0–1); selection color is in the theme.

Providing `onReorder(request)` enables dragging selected whole rows/columns directly from their visible index/header, with a grab cursor and no extra icon. Dragging moves all selected items of that axis. Selected group headers move their complete contiguous block. Drop on the first/second half of a target to insert before/after it. Focus a selected index/header and press Alt+arrow to move its item/group one position with the keyboard. Touch dragging an already selected axis uses a six-pixel movement threshold and the same reorder callback; body touch scrolling remains native.

`request` contains `axis: 'row' | 'column'`, immutable `indices` and `beforeIndex`, an insertion boundary in the current order **before removal**. `canReorder(request)` can veto the operation. `reorderedIndices(count, indices, beforeIndex)` validates the request and returns a stable index permutation. The host can call the structural APIs to apply ordering with state reconciliation and history, or handle external mutations itself. Omit `onReorder` to disable reordering entirely.


`editorOptions: { pinned: true, showLabel: true, guardNavigation: true }` keeps the active editor at its initial screen position while either the grid or page scrolls. It remains inside the browser viewport, with a label showing column title, row number and stable row ID. In pinned mode, blur alone does not save the draft; Enter, Escape, Apply/Cancel or selecting another cell use the existing commit/cancel pipeline. Pinned layout is opt-in; the default editor follows its cell. `showLabel: false` hides the label. Use `showLabel: 'scroll'` to display it only while scrolling has displaced the cell from the pinned editor; returning to the original position hides it again. `showLabel: 'always'` (or `true`, the default) always displays it in pinned mode.

While an editor is open, `beforeunload` requests the browser's native leave/close confirmation. The listener is removed on commit, cancel or destroy. Set `guardNavigation: false` to disable it. Browsers control whether the prompt appears and its text; forced process termination cannot be blocked. Choice search fields use a neutral border without an accent focus ring.

Custom renderer clipping includes the full cell rectangle. Grid boundary strokes paint after the renderer and selection tint, so full-cell semantic colors do not leave an inset gap. Returning false or throwing clears custom paint before drawing the default fallback.


### Row actions and selection appearance

Providing `onRowChange(request)` enables Insert row above/below, Insert rows… (1–1000) and Delete selected rows in the cell/index context menu. Requests are immutable: `{ kind: 'insert', beforeIndex, count }` or `{ kind: 'delete', indices }`. `canRowChange(request)` controls availability and is checked again before dispatch. Right-clicking a selected row preserves all selected whole-row ranges; deletion includes their unique indices in ascending order. An empty grid supports inserting its first row from the viewport menu.

With `onReorder`, **Move rows to…** and **Move columns to…** accept a one-based final position for the first moved item; the selected items form a stable block. The existing `canReorder` veto applies. Host callbacks supply row IDs/defaults and choose structural APIs or external mutations. Calling the core structural APIs preserves state and adds shared undo/redo; external mutations need host reconciliation.

Selection is a translucent Canvas overlay; it never changes cell formatting. Adjacent selected whole-row ranges share one visual outer boundary, while the underlying ranges and clipboard rules remain unchanged. `selectionStyle.rangeBorderWidth` (1–4px, default 1) and `rangeTintOpacity` (0–1, default 0.06) customize the appearance. Whole-axis selections omit the extra active-cell outline.

Selected row/column dragging shows a theme-colored insertion line across the viewport and a compact count/destination preview. Denied destinations hide the line and show a disabled message; drop permissions are checked again before dispatch. Ending or cancelling a native drag clears the preview.


## Rich text columns

Set `richTextColumns: { description: 'html', notes: 'markdown' }` to render portions of cell text in bold or italic, with inline code, links and line breaks. HTML also supports `<u>`. Core and Canvas have no Markdown parser dependency: Markdown columns require a synchronous `markdownToHtml(source): string` callback, supplied by your application or the optional [@acheron-grid/markdown adapter](../markdown/README.md). Without a callback, grid creation rejects Markdown configuration.

Canvas reads markup in an inert template and paints text. It never mounts parsed elements, applies embedded CSS/event handlers, or loads rich-text images; image alt text remains visible. Script/style/iframe/object/SVG content is excluded. HTTP(S) links reject credentials and control characters. This restricted display projection is not an HTML sanitizer for export or arbitrary DOM insertion. Custom adapters must disable raw HTML if that is their Markdown policy; the supplied adapter does so.

Rich-text columns use a visual contenteditable editor: users see formatted text rather than HTML/Markdown source. Unchanged edits retain the original string; changed edits serialize supported marks back to HTML or Markdown. Ctrl/Cmd+B and I toggle bold/italic; HTML also supports Ctrl/Cmd+U. Enter saves, Alt/Ctrl/Cmd+Enter inserts a line break, Escape cancels, and Tab saves and moves. Pinned positioning and navigation guards apply. Native custom editor factories retain their own behavior.

Canvas copy exposes displayed text as TSV and carries HTML plus sparse formatting in its structured clipboard payload. Copy/paste between grid cells preserves inline marks, colors and a per-cell `contentFormat` hint, including when pasting into an ordinary text column. Canonical rich clipboard content uses HTML, so a destination cell may have an HTML hint even in a Markdown-configured column. Read `grid.getFormat(row, column).contentFormat` alongside the stored value when persisting overrides. Numeric/boolean/choice destinations use visible text for their existing parsers. Value and format paste share one undo/redo entry and check formatting permissions before writing. Formatting-disabled targets reject formatted grid paste; plain TSV paste remains available through `paste(text)`.

Menu Copy/Paste uses HTML when the browser Clipboard API supports it; text-only APIs cannot preserve style. Rich editor paste builds allowed DOM nodes without mounting untrusted markup. Search and accessibility use displayed text; auto-fit and wrapping measure formatted runs. Core sort/filter still operates on source values. Existing `renderCell` callbacks take priority over rich-text painting, and `measureCellHeight` overrides automatic measurement.

Formatting supports text marks rather than full document layout: headings use the normal cell font, lists retain markers, code uses a monospace font, and images display alt text. Editing normalizes supported marks and line breaks; document block structure and unsupported markup are not round-tripped after changes. Cache holds at most 256 source strings of at most 4,096 characters each. Sources exceeding 100,000 characters or rejected by parsing show an unavailable message; editing/copying that content is blocked to avoid exposing source or losing data. HTML traversal stops beyond 128 nested elements. No document formatting toolbar is provided.

Context-menu rows use inset focus styling with separate hit areas. Type while the menu is open to filter actions; Up/Down navigates enabled matches and Enter activates one. Escape clears the query first, then closes the menu. Disabled items remain visible when their labels match. Dismissed popovers are removed.

## Runtime structure

Canvas exposes insertRows/deleteRows/moveRows/insertColumns/deleteColumns/moveColumns and current rowCount/columns getters, matching the [core structural contract](../core/README.md#structural-commands-and-layout-history). They retain the mount and mapped domain state, reject calls while editing, update header/index/accessibility geometry and share undo/redo. Grouped columns must stay contiguous; leaves may reorder inside groups, and deleted groups are pruned. Undo restores their structure.

Keep onRowChange/onReorder for menu/drag intents and call these APIs from the callbacks to create core history. External callback mutations remain host-owned. canChangeStructure applies host/admin policy to API and replay. New row IDs/defaults and column definitions remain host choices. Initial columnWidths configures sizes by key without history commands. Explicit resize/freeze are undoable; automatic row measurement is excluded.


## Column creation menu

allowColumnChanges: true enables Insert column left/right and Delete selected columns in the header menu. The native dialog collects key, title, type and default value. Built-in types are text, finite number (empty means null) and boolean checkbox (true/false, empty means false). Defaults and insertion are one structural command; undo restores definitions and hidden values. The menu retains at least one column; the core API permits an empty schema. Right-click inside selected whole columns retains their selection. Group and host policy validation runs again at commit.

columnTypes replaces the built-in list with {key, label, create(input)} definitions. Input contains key/title/defaultText; return {column, editor?}, retaining the supplied key. Column supports defaultValue; editor uses the existing select/multiselect/checkbox contract. Factories own parsing and validation and may throw to retain the dialog draft. Invalid editor configurations are rejected before insertion. Defaults initialize missing fields without overwriting hidden values.


Context menus use bundled Lucide SVG icons and separators between clipboard, selection, view, structure, editing, permissions, freeze and layout actions. theme.iconColor controls icon contrast independently of header text; use a light icon color for dark themes. Icons have no opaque header backing. Select/multiselect cells show a chevron on hover when editable; click the trailing chevron area to open the existing editor. Locked cells do not show an editable affordance.

Find inputs retain their neutral input border without a focus ring. Matches use a translucent theme.searchHighlightColor overlay (default amber); the current match has stronger tint and a narrow leading marker. This does not change cell formatting or values, and closes with the search panel.


Choice panels support Up/Down to navigate enabled filtered options. Single-choice arrows update only the draft; Enter/Apply commits and Escape/Cancel discards it. Multiple-choice arrows move focus, Space toggles a value, and Enter/Apply commits the set. Home/End jump to the first/last enabled option when focus is in the options; search input Home/End retain text-caret behavior. Focused options have a theme tint and scroll into view. Tab stays inside the panel; Enter on Cancel activates Cancel.

Touch dragging an already selected row index or column header reorders the selected items through the same onReorder/canReorder contract as desktop drag. A six-pixel movement threshold prevents taps from issuing moves. The preview shows the insertion boundary; release dispatches one request, and policy is checked again. Edge auto-scroll follows the dragged axis. Pointer cancel, lost capture, Escape, blur and destroy discard the drag. Touching an unselected axis retains selection behavior; body touch scrolling remains native.
## Merged cells and row outlines

The Canvas grid exposes `mergeCells(range)`, `unmergeCells(range)`, `getMerge(row, col)`, `getMergedCells()`, `canMerge(range)`, `groupRows(first, last)`, `ungroupRows(id)`, `getRowGroups()` and `setGroupCollapsed(id, collapsed)`.

Select a rectangular range and use **Merge cells** / **Unmerge cells** in the context menu. Select contiguous whole rows for **Group selected rows**. Nested row outlines show SVG collapse/expand buttons and continuous guide lines in the index gutter; buttons expose `aria-expanded`. Row index and editor labels retain source row numbers. The context menu also offers collapse/expand and ungroup actions. Merge geometry is shared by rendering, pointer hit tests, resize and editors; arrow navigation skips the covered span and the accessibility mirror exposes `aria-rowspan` / `aria-colspan`. Search only includes visible representative values.

Hosts can disable these features with `allowMerging: false`, `allowRowGrouping: false`, or veto commands with `canChangeLayout`. Options, themes, custom renderers and editor factories remain available. Source values under a merge are retained on unmerge. Sorting/filtering requires removing merges and groups; expand groups before insert/delete/reorder and unmerge intersecting cells before collapse. See the core README for clipboard, structural and projection limits.

Automatic row height measures all columns for each visible row and caches the result, so horizontal scrolling does not change row geometry. For very wide schemas, use fixed/manual row heights to avoid measuring every column. Adjacent whole-row or whole-column selections share one outer outline; Ctrl-added ranges remain separate in selection state.


Locking the table through `setLocked({ scope: 'table' }, true)` displays a non-blocking notice for four seconds. It uses the grid theme; it does not change selection or clipboard permissions. Configure `tableLockNotice: { title: 'Read only', description: 'Custom host message' }` or set `tableLockNotice: false` to hide it. `motion: false` disables grid motion; reduced-motion preferences are respected automatically. Headless core has no visual notifications.


Canvas animates row/column reordering and group collapse/expand using temporary visible-strip snapshots. State, focus and hit testing update immediately. Freeze separators draw in; context menus and choice panels use short entrance/exit transitions. The default layout duration is 220ms; customize it with `motion: { duration: 300 }` (0–1000ms, 0 disables motion). Scrolling cancels layout snapshots, reduced motion is respected, and at most 64 visible strips participate per transition. Selection and ordinary scrolling do not animate. Very wide/tall viewports beyond that cap update the remaining strips immediately.

Multi-cell selections use one uniform tint and an outer range border by default. Set `selectionStyle.activeCellBorderInRange: true` to also outline the active cell inside a range. Single-cell focus keeps its border.

## Export and restore configuration

```ts
import { restoreGridConfiguration } from '@acheron-grid/core';
import { createGrid } from '@acheron-grid/canvas';

const saved = JSON.stringify(grid.exportConfiguration());
// Recreate with the original application-owned source and column definitions.
const restored = restoreGridConfiguration(JSON.parse(saved), columns, dataSource.getRowCount());
grid.destroy();
grid = createGrid({ container, dataSource, ...restored, viewMode: 'core' });
```

The same version-1 configuration contract as the headless engine applies: order/widths, frozen counts and local sort/filters only. Storage is host-owned. Validation runs before mounting when you call the restore helper first. Reuse your application theme, editors, permissions and other options explicitly. No live restore or history/selection/data/row-group persistence is implied. Nested header groups must remain compatible with restored column order; the existing header validation still applies.

`grid.exportConfiguration()` requires core-managed views (`viewMode: 'core'`, or the default without `onViewChange`). Host-managed view mode throws because the renderer cannot know the original source projection; persist that host state separately. Destroyed grids also reject export.

## Copy feedback and motion details

Successful cell copy through Ctrl/Cmd+C, the context menu, `copySelection()` or `copySelectionBlocks()` shows a 1px dashed outline around the copied source, including a single cell. The marker persists when selecting another cell and follows scrolling, clipped by frozen panes. Dashes move slowly when motion is enabled; reduced motion or `motion: false` keeps them static. Another copy replaces the marker. Data/layout changes, resizing, Escape, theme changes and destroy clear it. A pending menu clipboard write cannot show stale feedback after data/layout changes. Native text selection inside an editor retains native copy behavior.

With motion enabled the marker fades in for at most 120ms; reduced motion or `motion:false` keeps the static marker. There is no indefinite marching animation or Canvas repaint loop. Visual feedback is bounded to the first 64 selected ranges; clipboard content is unaffected. Programmatic copy methods return content and show feedback, but do not themselves write to the operating-system clipboard.

Menu/choice surfaces use a 2px translation without scaling text (up to 160ms enter, 100ms exit). Interrupted exits start from the rendered opacity/transform. Table-lock notice moves 2px and cancels prior notice animation before replay. Selection, focus, scrolling and resize guides remain immediate; layout transitions retain the existing bounded strip snapshot and reduced-motion behavior.

## Cut and repeating a single copied cell

Ctrl/Cmd+X and the searchable menu's **Cut** action stage a same-grid move. The source stays unchanged until a successful paste; destination writes and source clearing share one undo/redo entry. Escape or copying another value cancels the pending move. Source changes, locks, parsers and destination formatting permissions are checked before deletion. The source is cleared to `null`, retaining its cell formatting; the destination receives the copied content/formatting. Cut from merged cells is rejected.

`grid.cutSelectionBlocks()` returns a structured staged-cut payload; paste that exact payload through `grid.pasteSelectionBlocks(payload)` on the same grid. `grid.cancelCut()` cancels it. Ctrl/Cmd+V and menu paste recognize the matching structured/HTML clipboard payload. After the first successful move, further pastes act as copies. Copying/pasting through an editor keeps native text behavior. Cross-grid/app moves are not implemented; they do not delete the original source. Plain-text-only clipboard transfers cannot authenticate the structured pending cut and remain copy operations.

Copy one cell, select multiple rows/cells, then paste to fill the target range(s). A structured one-cell payload repeats its formatting too. All target cells validate atomically. Multi-cell matrices retain existing placement rules; automatic matrix tiling is not provided.

## Developer integration recipes

### Multiple images and people in one cell

```ts
const rows = [{
  id: 'r1',
  photos: [{ src: '/images/front.jpg', alt: 'Front' }, { src: '/images/back.jpg', alt: 'Back' }],
  people: [{ id: 'ada', name: 'Ada Lovelace', src: '/avatars/ada.jpg' }, { id: 'lin', name: 'Lin Chen' }],
}];
const grid = createGrid({
  container, dataSource: new LocalDataSource(rows, row => row.id),
  columns: [{ key: 'photos', title: 'Photos', editable: true }, { key: 'people', title: 'People', editable: true }],
  imageColumns: ['photos'], avatarColumns: ['people'],
  rowHeight: 48, columnWidth: 200,
  mediaOptions: { size: 32, maxVisible: 4 },
});
```

Image columns accept an existing single URL string or a list of strings/`{src, alt}` objects. People lists use `{id?, name, src?}`; missing/broken avatar images display initials. Lists preserve order, with at most 100 items per cell. Thumbnails have rounded corners; avatars overlap slightly. `+N` summarizes overflow without resizing the row. Double-click or Alt+Enter opens a themed, keyboard-accessible details dialog with names/alt text. Empty lists remain empty. `getCellLabel` can replace generated accessible descriptions. `renderCell` still takes precedence if the host wants another presentation.

`mediaOptions.size` is 20–96 CSS pixels, `maxVisible` is 1–20; cell dimensions can reduce the visible count. Use explicit row heights or auto-fit. Image loading uses only visible thumbnails and a viewport-bounded cache, with the existing URL protocol checks, anonymous CORS and no-referrer policy. Gallery images load lazily. Remote servers must permit Canvas CORS for thumbnail drawing.

Ctrl/Cmd+C/X/V between configured media cells preserves list values, names, IDs and alt text using the structured grid clipboard. Paste uses the normal parser/validation/permission pipeline and one undo command; cut clears its source only after a successful destination write. Plain text clipboard representation is JSON for lists. Canvas installs `parseMediaValue` as the default parser on media columns; a supplied column parser takes precedence. The helper is exported for a headless host or custom parser. F2 edits the JSON representation; double-click opens details rather than editing JSON. Pasting a media list into an ordinary text column leaves JSON text, not a media widget.

To paste a screenshot/image directly, select a configured editable image/people cell, focus the grid viewport and press Ctrl/Cmd+V. Browser clipboard image files replace that cell's list; multiple files become one list. A selected range receives the same list through normal scalar broadcasting. Paste while a native text editor is open retains native editor behavior. The browser must expose image files in the paste event; plain HTML containing an image is not an image-file upload.

By default pasted files create **temporary blob URLs owned by the grid**, retained for undo/redo and revoked on destroy. They are not a durable upload and must not be saved as permanent URLs or reused after their owner is destroyed. To persist images, provide a host upload hook:

```ts
mediaOptions: {
  upload: async (file, { columnKey, signal }) => {
    const body = new FormData();
    body.append('file', file); body.append('column', columnKey);
    const response = await fetch('/api/images', { method: 'POST', body, signal });
    if (!response.ok) throw new Error('Image upload failed');
    const { url } = await response.json();
    return { src: url, alt: file.name };
  },
}
```

Paste accepts at most 100 image files, each up to 20 MiB. Uploads commit only when all results validate and the destination selection/row identity/value is still unchanged. Superseded uploads and grid destruction abort the supplied signal. Failure never clears cut sources or partially writes the grid. The host owns file-content validation, allowed origins, storage, authorization and cleanup of uploads that were completed on the server but never attached to a cell. Context-menu text paste does not upload files; use the native paste shortcut for clipboard images.

Canvas accepts application hooks without coupling the engine to a framework or backend. These examples extend the `createGrid({ container, dataSource, columns, ... })` setup in the package reference above. Give the container a non-zero width/height and call `grid.destroy()` on unmount.

### Searchable select and multiselect

```ts
const grid = createGrid({
  container, dataSource, columns,
  choiceEditor: {}, // Enable searchable panels globally; false uses native controls.
  columnEditors: {
    status: {
      type: 'select',
      values: [
        { value: 'active', label: 'Active' },
        { value: 'archived', label: 'Archived', disabled: true },
      ],
      choiceEditor: {
        placeholder: 'Find a status',
        searchLabel: 'Search statuses',
        optionsLabel: 'Statuses',
        noMatchLabel: 'No matching status',
        applyLabel: 'Apply', cancelLabel: 'Cancel',
        matches: (query, option) =>
          `${option.label} ${option.value}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()),
      },
    },
    tags: {
      type: 'multiselect',
      values: ['Design', 'Content', 'Review'],
      choiceEditor: {
        valueOrder: 'input',
        selectedLabel: count => `${count} tags selected`,
      },
    },
  },
});
```

Values are stored independently from labels. Disabled options cannot be chosen through the editor; enforce business constraints in the column parser and server too. Multiselect stores comma-separated values, so values cannot contain commas. `valueOrder: 'input'` preserves the original value order; `'options'` explicitly follows the supplied option order. Opening the editor never randomly reorders existing values.

Per-column `choiceEditor` overrides global settings. Use `{ searchable: false }` for a panel without search or `false` for a native select. Arrow keys navigate; typing from an option moves focus to the search input. Enter applies, Escape cancels and Space toggles multiple choices. Customize `placeholder`, `searchLabel`, `optionsLabel`, `selectedLabel`, `noMatchLabel`, `emptyLabel`, `applyLabel`, `cancelLabel`, `loadingLabel` and `errorLabel` for localization.

Replace a lookup list after loading your own API:

```ts
grid.setColumnEditor('status', {
  type: 'select',
  values: [{ value: 'active', label: 'Active' }, { value: 'review', label: 'Review' }],
  choiceEditor: {},
});
// grid.setColumnEditor('status', null) removes the configured editor.
```

The configuration is validated and snapshotted. Replacing the editor for the currently edited column cancels its draft. A non-null `createEditor` factory result takes precedence over configured column editors.

### Remote option search

```ts
grid.setColumnEditor('tags', {
  type: 'multiselect',
  values: ['Design'], // Initial/current choices; provide a nonempty list.
  choiceEditor: {
    searchDelay: 180,
    loadingLabel: 'Loading tags...',
    errorLabel: 'Could not load tags. Search again to retry.',
    loadOptions: async (query, { signal, columnKey }) => {
      const url = new URL('/api/options', location.origin);
      url.searchParams.set('q', query);
      url.searchParams.set('column', columnKey ?? '');
      const response = await fetch(url, { signal });
      if (!response.ok) throw new Error(`Options request failed: ${response.status}`);
      return await response.json(); // [{ value: 'design', label: 'Design', disabled: false }]
    },
  },
});
```

The panel loads the initial empty query, debounces later queries, aborts superseded requests and cancels on apply/cancel/destroy. Stale responses are ignored. Selected values remain available even when absent from the latest result. The server owns matching when `loadOptions` is present; `matches` applies only to local lists. Results must have unique string values with optional string labels and boolean disabled flags. The host owns authentication, validation and pagination of its option endpoint; there is no infinite-scroll protocol.

### Custom chip rendering

```ts
const choiceEditor = {
  renderOption: (option, document) => {
    const chip = document.createElement('span');
    chip.textContent = option.label;
    chip.className = `status-chip status-${option.value}`;
    return chip;
  },
};
```

`renderOption` receives value, label, disabled, selected, multiple and columnKey. Return a detached element from the supplied document; use `textContent` for untrusted labels. The panel owns checkbox/radio semantics. Reuse the same application color mapping in `renderCell` so painted chips and editor chips agree in both themes. Canvas does not impose a status palette on host data.

### External editor UI and cleanup

```ts
const grid = createGrid({
  container, dataSource, columns,
  editorOptions: { pinned: true },
  createEditor: (cell, document) => {
    if (cell.columnKey !== 'name') return null;
    const input = document.createElement('input');
    input.type = 'text';
    return input;
  },
  onEditorMount: (cell, editor) => {
    // Optional React/Vue portal or application popover, anchored to editor.
    const onInput = () => console.log(cell.columnKey, editor.value);
    editor.addEventListener('input', onInput);
    return () => editor.removeEventListener('input', onInput);
  },
});
```

The factory returns a detached input/select/textarea from the grid document; Canvas initializes its value and mounts it. `onEditorMount` runs after mounting and may return cleanup, called on apply/cancel/destroy. Use that cleanup to unmount a framework portal, remove listeners and abort application requests. Cleanup errors go to `onObserverError`. Mount errors cancel the draft and show an accessible error.

External UI writes to the backing control's `value` and dispatches `input`/`change` in its document. Enter commits through normal parsing/permissions/history; Escape cancels. `pinned: true` prevents portal focus from committing on blur. The host owns portal focus/keyboard/ARIA semantics. Returning an arbitrary framework node from `createEditor` is unsupported. Parsing and validation remain synchronous; use column `invalidInput: 'allow'` for a visible warning that permits saving, or the default rejection policy to retain an invalid draft. Never use client validation as server authorization.

### Link popup and optional website metadata

```ts
const grid = createGrid({
  container, dataSource, columns,
  detectLinks: true,
  allowOpenLinks: true,
  linkPreview: {
    enabled: true,
    allowMetadata: true,
    load: async (href, signal) => {
      const response = await fetch('/api/link-preview', {
        method: 'POST', signal,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: href }),
      });
      if (!response.ok) throw new Error(`Preview request failed: ${response.status}`);
      return await response.json(); // { title?: string, description?: string, image?: string }
    },
  },
});
```

Canvas does not fetch websites by itself. A basic popup with distinguishable URLs and an open action remains available without metadata. `linkPreview: false` disables metadata; an object with `allowMetadata: false` prevents loader calls and removes the website-details toggle. `enabled: false` starts website details hidden but allows the user to enable them when metadata is permitted. Closing/replacing the popup aborts the loader signal. Handle backend errors; failed metadata does not remove the basic URL entry.

Use a same-origin backend endpoint. Next.js route handlers work for this; a static export needs a separate backend. Enforce the policy on the server too: allowed origins, HTTP/HTTPS only, public network destinations, redirect checks, response size/time limits and authorization. Turning off metadata in UI is not a server security boundary. The bundled demo uses its own trusted-origin policy; the library does not hardcode those origins. Images and metadata are optional; do not inject remote HTML.

### Other extension points and ownership

| Area | Public extension point | Host responsibility |
| --- | --- | --- |
| Data and remote loading | `dataSource`, `createAsyncDataSource` from core | Storage, server queries, authorization, async save coordination |
| External source changes | `captureRowIdentity`, `refreshData` | Capture IDs before structure changes; use `'values'` only for unchanged identities |
| Notifications | `subscribe`, `onEvent`, `onObserverError` | Unsubscribe on unmount; avoid nested mutations from callbacks |
| Persisted state | `exportState`, `restoreState`, `exportConfiguration` | Persist/version storage; supply matching row IDs/schema and application policies |
| Painted content | `renderCell`, `measureCellHeight` | Return handled=true only when fully painted; honor bounds/format; provide height measurement |
| Accessible content | `getCellLabel`, `accessibility` | Describe custom content and use viewport accessibility when appropriate |
| Parsing/validation | column parser, `invalidInput`, permissions/resolver | Validate paste and editor values; enforce server authorization |
| Appearance | `theme`, `selectionStyle`, `motion`, choice renderer | Shared light/dark tokens, reduced-motion support and meaningful labels |
| Host sorting/filtering | `viewMode: 'host'`, `onViewChange` | Fetch/reconcile a server view; local search does not query unloaded records |
| Structural changes | `canChangeStructure`, `onRowChange`, `onReorder`, column types | Veto disallowed actions and persist application data |
| Context menu | `contextMenuSuggestions` | Enable contextual suggestions or the complete built-in menu; custom menu items are not supported |

Canvas forwards the headless refresh, state and subscription APIs. See the core integration recipes for complete paging/refresh contracts. `destroy()` releases grid-owned UI and listeners; it does not destroy a host-owned source, subscriptions outside the grid or a metadata backend.

React/Vue adapters expose the grid instance through their documented ref/getGrid API. Keep construction options stable and call runtime methods on that instance; replacing factory options is not a reactive configuration update. Mount external components through `onEditorMount` and return their unmount function. Use the same hooks in vanilla, React and Vue; no framework dependency is added to core.
