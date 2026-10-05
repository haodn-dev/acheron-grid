# Integration guide

Use this guide after mounting a grid. Examples refer to the `grid` returned by `createGrid` and use zero-based data coordinates. The row-index gutter is not a data column. Check the exported types in your checkout before integrating this experimental API.

## Choose the correct object

Use the Canvas grid returned by createGrid for browser interactions. Use createGridEngine for a headless workflow. They share data/permission/history contracts, but their browser and selection methods differ: Canvas uses pointer/keyboard selection, selectRow/selectColumn/selectAll; core also exposes select/selectRange/navigate. Do not assume a core method exists on the Canvas Grid type.

## Define data and validation

Use stable, unique row IDs and persistent column keys. `LocalDataSource` keeps shallow row snapshots; nested objects remain application-owned. Editing needs a writable source and an editable column.

```ts
const columns = [
  { key: 'id', title: 'Code' },
  { key: 'title', title: 'Title', editable: true,
    parse: (text: string) => {
      if (!text.trim()) throw new Error('Title is required.');
      return text.trim();
    } },
  { key: 'approved', title: 'Approved', editable: true,
    parse: (text: string) => {
      if (text !== 'true' && text !== 'false') throw new Error('Use true or false.');
      return text === 'true';
    } },
];
```

Parsers convert editor and paste text before writes. `Column.validate(value)` returns an error or `undefined`; invalid input is rejected by default. `invalidInput: 'allow'` saves a value with a warning. Parser exceptions still reject input. `updateCells` accepts typed values, runs column validation and does not run parsers. Validate values received from your server separately. A failed parse keeps the editor draft available for correction.

## Framework adapters

React and Vue own Canvas mounting and cleanup. Follow the [framework integration guide](frameworks.md) and the matching package README; core and Canvas are different objects.

## Configure editors

Pass these options to `createGrid`, alongside your columns and source:

```ts
columnEditors: {
  priority: { type: 'select', values: ['High', 'Medium', 'Low'] },
  tags: { type: 'multiselect', values: ['Idea', 'Design', 'Content'] },
  approved: { type: 'checkbox' },
},
choiceEditor: { placeholder: 'Find an option…', maxHeight: 220 },
multilineEditor: true,
wrapText: true,
editorOptions: { pinned: true, showLabel: 'scroll', guardNavigation: true },
```

Select values must be unique strings; an empty string can represent no choice. Multiselect values serialize as comma-separated labels, so labels cannot contain commas. Add column parsers to validate choices during paste as well as editing.

Up/Down navigates searchable choices. Space toggles a multiselect option; Enter/Apply commits, Escape/Cancel discards. During text editing, Enter saves, Tab saves and moves, and Alt+Enter inserts a newline. Pinned editors retain their screen position while scrolling; the label can show only when displaced or always. Navigation guarding requests the browser's native confirmation, whose display depends on browser policy.

Use `choiceEditor.renderOption` to style dropdown options, `renderCell` to draw display chips, or `createEditor` for a custom editor. Share a palette between display and editor rendering to keep them consistent.

## Select and use the keyboard

Click a cell and Shift-click to extend a rectangle. Ctrl/Cmd-click adds another range. Click row indexes, leaf headers or grouped headers to select their complete spans. Selected whole axes can be dragged when the host enables reordering.

| Task | Shortcut |
| --- | --- |
| Move / extend | Arrow keys / Shift+Arrow |
| Select row / column | Shift+Space / Ctrl/Cmd+Space |
| Select all / add range | Ctrl/Cmd+A / Shift+F8 |
| Edit / cancel | Enter or F2 / Escape |
| Copy / paste | Ctrl/Cmd+C / Ctrl/Cmd+V |
| Undo / redo | Ctrl/Cmd+Z / Ctrl/Cmd+Shift+Z |
| Bold / italic | Ctrl/Cmd+B / Ctrl/Cmd+I |
| Find / context menu | Ctrl/Cmd+F / Shift+F10 |
| Open safe links | Alt+Enter outside an editor |

Type while the context menu is open to filter actions. Native editor inputs keep their own text clipboard and undo behavior. Accessibility mirrors expose viewport content; complete screen-reader behavior remains unverified.

## Update values, clipboard and history

```ts
grid.updateCells([{ rowIndex: 0, columnKey: 'title', value: 'Lorem ipsum' }]);
grid.selectRow(0);
const text = grid.copySelection();
grid.undo();
grid.redo();
```

Value edits, formatting, explicit resize/freeze and structural commands share bounded history. User locks remain outside history. A new change clears redo; a no-op does not. Replay checks current permissions and rejects conflicting external changes.

`grid.paste(text)` accepts TSV and applies column parsers. Bounds, permissions and parsing are checked before an atomic write. A one-cell payload fills the selected range(s); larger matrices do not tile. Paste does not create missing rows. Multiple selection ranges support packed TSV; structured clipboard APIs retain range offsets and formatting. Native grid copy/paste can carry rich styles, while plain TSV is a values-only interchange. Do not expect unrelated applications to preserve every grid format.

Multi-cell writes require a synchronous atomic `setValues` implementation; `LocalDataSource` provides one. Clipboard payloads are capped at 100,000 cells and 10 million UTF-16 code units. Direct source writes bypass grid history; prefer public grid commands.

## Search and local views

```ts
grid.openSearch();
grid.setView({
  sort: { columnKey: 'title', direction: 'asc' },
  filters: [{ columnKey: 'title', operator: 'contains', query: 'Lorem' }],
});
grid.setView({});
```

Search highlights displayed text without modifying formatting. Header menus expose single-column sort and per-column filters. Filters combine with AND; operators are `contains`, `equals`, `not-empty` and `empty`.

Core-managed views retain the mount and mapped state and refresh after edits. If you supply `onViewChange`, set `viewMode: 'core'` to keep that behavior; otherwise the callback selects the legacy host-managed contract. API row coordinates describe the displayed view, while permission resolvers and non-selection domain events use source coordinates and stable IDs.

Clear views before structural commands. Sort/filter keeps merged/grouped rows in blocks: sort uses the first row and a filter retains a block when any member matches. Collapsed children remain hidden. Local filtering scans the in-memory source and sorting costs grow with matching rows; virtualization only limits rendering work.

## Headers, size and frozen panes

```ts
headerGroups: [{ title: 'Availability', children: [
  { title: 'Channels', children: ['online', 'onsite'] },
  { title: 'Delivery', children: ['shipping'] },
] }],
headerHeight: 28,
autoRowHeight: true,
wrapText: true,
```

Keep columns flat and group leaves contiguous, unique and in column order. `headerHeight` applies to each header row. Group headers select all their leaves; ancestor headers receive selection tint.

```ts
grid.setFrozen(1, 1);
grid.setColumnWidth(1, 240);
grid.setRowHeight(0, 64);
grid.setFrozen(0, 0);
```

Freeze counts include data rows/columns, not the header or index gutter. Overlarge prefixes can consume the viewport. Resize dragging shows a guide and applies on release; double-click fits visible content. Automatic row measurement considers all configured columns for each visible row and respects explicit sizes; it does not scan offscreen rows.

## Reorder and change structure

```ts
onReorder: request => {
  if (request.axis === 'row') grid.moveRows(request.indices, request.beforeIndex);
  else grid.moveColumns(request.indices, request.beforeIndex);
},
allowColumnChanges: true,
```

This callback runs after mounting, when `grid` is available. `beforeIndex` is an insertion boundary in the order before removal. The host supplies IDs/default values for inserted rows through `onRowChange`, calling `insertRows`/`deleteRows`. Enable column changes to expose column insertion/deletion menus.

Use `canReorder`, `canRowChange` and `canChangeStructure` for host policy. `canChangeStructure` also covers direct commands and history replay. Structure changes preserve surviving row IDs, column keys and mapped state. Grouped columns must stay contiguous; expand groups and remove intersecting merges before incompatible moves.

## Merge cells and group rows

```ts
grid.mergeCells({ startRow: 2, endRow: 3, startColumn: 1, endColumn: 2 });
grid.unmergeCells({ startRow: 2, endRow: 3, startColumn: 1, endColumn: 2 });
const groupId = grid.groupRows(3, 6);
grid.setGroupCollapsed(groupId, true);
grid.setGroupCollapsed(groupId, false);
grid.ungroupRows(groupId);
```

Range ends are inclusive. Merging retains underlying values for unmerge and displays the representative cell. Grouping creates manual row outlines, not aggregation. Menus expose these operations for appropriate selections. `allowMerging`, `allowRowGrouping` and `canChangeLayout` control availability.

## Rich text, images and links

```ts
import { markdownToHtml } from '@acheron-grid/markdown';

// createGrid options:
richTextColumns: { notes: 'markdown', description: 'html' },
markdownToHtml,
imageColumns: ['avatar'],
```

Rich-text users see formatted text, not source markup. Bold/italic can apply to selected words during editing or to selected cells outside editing. HTML supports underline; Markdown has no extra underline syntax. Source strings remain suitable for host storage.

Canvas projects a restricted set of text runs; it does not mount rich-text HTML, run embedded handlers or load its images. The optional Markdown adapter disables raw HTML. This display projection is not a general HTML sanitizer: sanitize independently if your application inserts stored HTML into a DOM elsewhere.

Image columns load visible URL values with contain sizing; cross-origin servers must allow anonymous CORS. Galleries and people stacks have details dialogs and visual Apply/Cancel editors. Native image paste creates temporary grid-owned blob URLs; `mediaOptions.upload` connects to host storage. Cropping is not provided. Safe HTTP(S) links show per-link shortcuts on hover/focus. Link behavior and custom image/rich-text renderers remain host concerns.

## Permissions, locks and themes

```ts
resolveCellPermission: cell => cell.rowId === 'protected'
  ? { writable: false }
  : undefined,
permissions: { formatting: false },
```

Capabilities independently control selection, copy, paste, editing, writing and formatting. Explicit false vetoes survive more specific scopes. A read-only row can remain selectable/copyable. Dynamic resolver changes need `grid.render()` to refresh visible controls; commits recheck policy.

```ts
grid.setLocked({ scope: 'row', rowIndex: 0 }, true);
grid.setLocked({ scope: 'row', rowIndex: 0 }, false);
grid.format([{ scope: 'column', columnIndex: 1 }], { background: '#fff0dd' });
grid.setTheme({ selectionColor: '#d44b21', iconColor: '#334155' });
```

Locks can target cells, rows, columns or the table. Unlocking one scope does not remove another applicable lock. Freeze keeps content visible; it does not lock editing. Themes update appearance without remounting. Custom renderers must honor supported `cell.format` fields themselves.

Client permissions and locks are UI/domain controls, not server authorization. Keep persistence, authentication and remote validation in your application.

## Troubleshooting and boundaries

| Symptom | Check |
| --- | --- |
| Empty grid | Container dimensions, source row count, column keys and browser console |
| Cannot edit/paste | Column editable flag, parser, source setter, resolved permissions and locks |
| Markdown configuration rejected | Supply a synchronous Markdown adapter callback |
| Image unavailable | URL scheme, CORS, server response and visible cell size |
| Move/view change rejected | Active draft, sort/filter, collapsed groups, merges and host policy |
| Change missing from undo | Direct source mutation or automatic row measurement |
| Styles differ inside choices | Share option/display palettes and honor format metadata |

Always call `grid.destroy()` on unmount. Read-only async paging and a separate MCP documentation/host-tools adapter are available. Async writes, collaboration, formulas and an automatic MCP browser bridge are not included. Read package README files and exported contracts for detailed limits; browser security policy can affect clipboard and navigation prompts.


## Search engines and readable content

Canvas pixels are not a substitute for indexable HTML. Keep product explanations, column descriptions, examples and documentation in server-rendered HTML, available without clicking or running JavaScript. This demo serves its five-row interaction illustration and feature guides in HTML; the large playground remains an interactive Canvas view.

For applications whose records should be publicly searchable, render an authorized, paginated HTML table or record detail pages from the same data source on the server. Link those pages from normal HTML navigation. Do not expose private records for indexing. The viewport accessibility option supports assistive technology during interaction; it does not provide server-side rendering or a complete search index. Markdown documentation and `/llms.txt` complement the HTML guides, without guaranteeing crawler support or search rankings.

## External data, subscriptions and state

Use grid commands for edits that belong in history. After external value changes with unchanged row IDs/order/count, call `grid.refreshData('values')`. Before source structure changes, capture `const previousIds = grid.captureRowIdentity()`, change the source, then call `grid.refreshData(previousIds)`. Without IDs, refresh drops row-dependent state. Every refresh clears stale undo/redo and pending cut.

`grid.subscribe({ onEvent, onInvalidate })` returns unsubscribe. Observers see committed state and cannot issue nested mutations. Exceptions are isolated through `onObserverError` / `takeObserverErrors()`.

`exportConfiguration()` saves column order/widths, frozen counts and local views. `exportState()` also saves row identities/heights, selection, groups/merges, locks and sparse formatting. `restoreState(unknown)` validates matching schema/identities and current policies before commit; unlock the table first. Data, callbacks, history, drafts and pending clipboard are excluded. Host storage remains separate.

## Read-only async pages

`createAsyncDataSource` is a synchronous cache with explicit `loadPage(offset)` and inclusive `loadRange(first,last)`. Load the first page to discover total before mounting; the host coordinates visible rows, loading/errors/retry and refresh. `maxPages` bounds successful pages and recent error states separately, not concurrent requests.

Unloaded values are `undefined`; default IDs are positions within one query. Reset the source and refresh without old identity state after a new server query. Local views see cached values, not all server rows. There is no async setter, optimistic save queue or persistent undo. Destroy the source separately from the grid. See the [core recipe](/reference/core#async-pages-and-cancellation).

## Remote choices and external editors

`ColumnEditor.values` accepts strings or `{ value, label, disabled }`; stored values are independent of labels. Multiselect preserves input order; `choiceEditor.valueOrder: 'options'` opts into option order. `loadOptions(query, { signal, columnKey })` supports debounce, cancellation and stale-response rejection; the host owns matching, authorization and validation.

`createEditor` returns a detached native control. `onEditorMount` can mount framework UI and returns cleanup on Apply/Cancel/destroy. Parsing, validation and setters remain synchronous. Custom renderers can provide `measureCellHeight` and `getCellLabel`. See [Canvas recipes](/reference/canvas#developer-integration-recipes).

## Media and metadata lifecycle

`imageColumns` supports single images/galleries; `avatarColumns` supports people lists. F2/Enter edits with add/remove/reorder and Apply/Cancel; double-click/Alt+Enter opens details. Structured clipboard preserves lists. Same-grid cut clears sources only after a successful destination write. Native image paste depends on browser/OS support.

Paste accepts at most 100 files of 20 MiB each. Blob URLs are revoked on grid destruction. Durable uploads require `mediaOptions.upload(file, { columnKey, signal })` and host authorization/storage; stale or failed uploads do not partially write cells. Cropping is outside scope.

Link popovers do not need metadata requests. A host `linkPreview.load` can provide title/description/image; `allowMetadata: false` forbids requests and hides the toggle. The backend enforces destinations, redirects, timeouts and response limits. Context-menu suggestions use deterministic rules, not autonomous AI commands; custom menu items are not implemented.

## Support boundaries

Chromium automation does not establish full Safari/Firefox, screen-reader or physical touch-device coverage. Native scroll sizes limit extreme dimensions. The 10,000-row demo is a sample, not a frame-rate/memory guarantee. Formula calculation, pivots, multi-sheet workbooks, realtime collaboration and async writes are outside core V1. Optional inline charts and multi-column sorting are source previews, not npm 0.1.0. See the selected documentation channel before using them.
