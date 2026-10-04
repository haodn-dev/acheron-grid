# Acheron Grid — Practical guide

Use this guide after mounting a grid. Examples refer to the `grid` returned by `createGrid` and use zero-based data coordinates. The row-index gutter is not a data column. Check the exported types in your checkout before integrating this experimental API.

## 1. Define data and validation

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

Parsers validate editor and paste input before writes. `updateCells` accepts already-validated values and does not run parsers. Validate values received from your server separately. A failed parse keeps the editor draft available for correction.

## 2. Configure editors

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

## 3. Select and use the keyboard

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

## 4. Update values, clipboard and history

```ts
grid.updateCells([{ rowIndex: 0, columnKey: 'title', value: 'Lorem ipsum' }]);
grid.selectRow(0);
const text = grid.copySelection();
grid.undo();
grid.redo();
```

Value edits, formatting, explicit resize/freeze and structural commands share bounded history. User locks remain outside history. A new change clears redo; a no-op does not. Replay checks current permissions and rejects conflicting external changes.

`grid.paste(text)` accepts TSV and applies column parsers. Bounds, permissions and parsing are checked before an atomic write. It does not create missing rows or automatically tile a selection. Multiple selection ranges support packed TSV; structured clipboard APIs retain range offsets and formatting. Native grid copy/paste can carry rich styles, while plain TSV is a values-only interchange. Do not expect unrelated applications to preserve every grid format.

Multi-cell writes require a synchronous atomic `setValues` implementation; `LocalDataSource` provides one. Clipboard payloads are capped at 100,000 cells and 10 million UTF-16 code units. Direct source writes bypass grid history; prefer public grid commands.

## 5. Search and local views

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

Clear views before structural commands. Remove merges/groups before sorting/filtering. Local filtering scans the in-memory source and sorting costs grow with matching rows; virtualization only limits rendering work.

## 6. Headers, size and frozen panes

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

Freeze counts include data rows/columns, not the header or index gutter. Overlarge prefixes can consume the viewport. Resize dragging shows a guide and applies on release; double-click fits visible content. Automatic row measurement considers visible columns and respects explicit sizes; it is not a full-dataset fit.

## 7. Reorder and change structure

```ts
onReorder: request => {
  if (request.axis === 'row') grid.moveRows(request.indices, request.beforeIndex);
  else grid.moveColumns(request.indices, request.beforeIndex);
},
allowColumnChanges: true,
```

This callback runs after mounting, when `grid` is available. `beforeIndex` is an insertion boundary in the order before removal. The host supplies IDs/default values for inserted rows through `onRowChange`, calling `insertRows`/`deleteRows`. Enable column changes to expose column insertion/deletion menus.

Use `canReorder`, `canRowChange` and `canChangeStructure` for host policy. `canChangeStructure` also covers direct commands and history replay. Structure changes preserve surviving row IDs, column keys and mapped state. Grouped columns must stay contiguous; expand groups and remove intersecting merges before incompatible moves.

## 8. Merge cells and group rows

```ts
grid.mergeCells({ startRow: 2, endRow: 3, startColumn: 1, endColumn: 2 });
grid.unmergeCells({ startRow: 2, endRow: 3, startColumn: 1, endColumn: 2 });
const groupId = grid.groupRows(3, 6);
grid.setGroupCollapsed(groupId, true);
grid.setGroupCollapsed(groupId, false);
grid.ungroupRows(groupId);
```

Range ends are inclusive. Merging retains underlying values for unmerge and displays the representative cell. Grouping creates manual row outlines, not aggregation. Menus expose these operations for appropriate selections. `allowMerging`, `allowRowGrouping` and `canChangeLayout` control availability.

## 9. Rich text, images and links

```ts
import { markdownToHtml } from '@acheron-grid/markdown';

// createGrid options:
richTextColumns: { notes: 'markdown', description: 'html' },
markdownToHtml,
imageColumns: ['avatar'],
```

Rich-text users see formatted text, not source markup. Bold/italic can apply to selected words during editing or to selected cells outside editing. HTML supports underline; Markdown has no extra underline syntax. Source strings remain suitable for host storage.

Canvas projects a restricted set of text runs; it does not mount rich-text HTML, run embedded handlers or load its images. The optional Markdown adapter disables raw HTML. This display projection is not a general HTML sanitizer: sanitize independently if your application inserts stored HTML into a DOM elsewhere.

Image columns load visible URL values with contain sizing; cross-origin servers must allow anonymous CORS. There is no upload/cropping workflow. Safe HTTP(S) links show per-link shortcuts on hover/focus. Link behavior and custom image/rich-text renderers remain host concerns.

## 10. Permissions, locks and themes

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

Always call `grid.destroy()` on unmount. Remote/async sources, collaboration, formulas and an MCP server are not included. Read package README files and exported contracts for detailed limits; browser security policy can affect clipboard and navigation prompts.
