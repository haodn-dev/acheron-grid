# Canvas integration recipes and advanced behavior

These recipes use the public Canvas APIs in npm 0.2.0. Start with the [Canvas package guide](../packages/canvas/README.md) for installation, mounting, keyboard behavior and basic configuration. The host owns application data, authentication, storage and callbacks.

## Rich text columns

Set `richTextColumns: { description: 'html', notes: 'markdown' }` to render portions of cell text in bold or italic, with inline code, links and line breaks. HTML also supports `<u>`. Core and Canvas have no Markdown parser dependency: Markdown columns require a synchronous `markdownToHtml(source): string` callback, supplied by your application or the optional [@acheron-grid/markdown adapter](../packages/markdown/README.md). Without a callback, grid creation rejects Markdown configuration.

Canvas reads markup in an inert template and paints text. It never mounts parsed elements, applies embedded CSS/event handlers, or loads rich-text images; image alt text remains visible. Script/style/iframe/object/SVG content is excluded. HTTP(S) links reject credentials and control characters. This restricted display projection is not an HTML sanitizer for export or arbitrary DOM insertion. Custom adapters must disable raw HTML if that is their Markdown policy; the supplied adapter does so.

Rich-text columns use a visual contenteditable editor: users see formatted text rather than HTML/Markdown source. Unchanged edits retain the original string; changed edits serialize supported marks back to HTML or Markdown. Ctrl/Cmd+B and I toggle bold/italic; HTML also supports Ctrl/Cmd+U. Enter saves, Alt/Ctrl/Cmd+Enter inserts a line break, Escape cancels, and Tab saves and moves. Pinned positioning and navigation guards apply. Native custom editor factories retain their own behavior.

Canvas copy exposes displayed text as TSV and carries HTML plus sparse formatting in its structured clipboard payload. Copy/paste between grid cells preserves inline marks, colors and a per-cell `contentFormat` hint, including when pasting into an ordinary text column. Canonical rich clipboard content uses HTML, so a destination cell may have an HTML hint even in a Markdown-configured column. Read `grid.getFormat(row, column).contentFormat` alongside the stored value when persisting overrides. Numeric/boolean/choice destinations use visible text for their existing parsers. Value and format paste share one undo/redo entry and check formatting permissions before writing. Formatting-disabled targets reject formatted grid paste; plain TSV paste remains available through `paste(text)`.

Menu Copy/Paste uses HTML when the browser Clipboard API supports it; text-only APIs cannot preserve style. Rich editor paste builds allowed DOM nodes without mounting untrusted markup. Search and accessibility use displayed text; auto-fit and wrapping measure formatted runs. Core sort/filter still operates on source values. Existing `renderCell` callbacks take priority over rich-text painting, and `measureCellHeight` overrides automatic measurement.

Formatting supports text marks rather than full document layout: headings use the normal cell font, lists retain markers, code uses a monospace font, and images display alt text. Editing normalizes supported marks and line breaks; document block structure and unsupported markup are not round-tripped after changes. Cache holds at most 256 source strings of at most 4,096 characters each. Sources exceeding 100,000 characters or rejected by parsing show an unavailable message; editing/copying that content is blocked to avoid exposing source or losing data. HTML traversal stops beyond 128 nested elements. No document formatting toolbar is provided.

Context-menu rows use inset focus styling with separate hit areas. Type while the menu is open to filter actions; Up/Down navigates enabled matches and Enter activates one. Escape clears the query first, then closes the menu. Disabled items remain visible when their labels match. Dismissed popovers are removed.

## Runtime structure

Canvas exposes insertRows/deleteRows/moveRows/insertColumns/deleteColumns/moveColumns and current rowCount/columns getters, matching the [core structural contract](../packages/core/README.md#structural-commands-and-layout-history). They retain the mount and mapped domain state, reject calls while editing, update header/index/accessibility geometry and share undo/redo. Grouped columns must stay contiguous; leaves may reorder inside groups, and deleted groups are pruned. Undo restores their structure.

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

Hosts can disable these features with `allowMerging: false`, `allowRowGrouping: false`, or veto commands with `canChangeLayout`. Options, themes, custom renderers and editor factories remain available. Source values under a merge are retained on unmerge. Sorting/filtering projects complete merge/group units; expand groups before insert/delete/reorder and unmerge intersecting cells before collapse. See the core README for clipboard, structural and projection limits.

Automatic row height measures all columns for each visible row and caches the result, so horizontal scrolling does not change row geometry. For very wide schemas, use fixed/manual row heights to avoid measuring every column. Adjacent whole-row or whole-column selections share one outer outline; Ctrl-added ranges remain separate in selection state.

Locking the table through `setLocked({ scope: 'table' }, true)` displays a non-blocking notice for four seconds. It uses the grid theme; it does not change selection or clipboard permissions. Configure `tableLockNotice: { title: 'Read only', description: 'Custom host message' }` or set `tableLockNotice: false` to hide it. `motion: false` disables grid motion; reduced-motion preferences are respected automatically. Headless core has no visual notifications.

Canvas animates synchronous sort/filter views, row/column reordering and group collapse/expand using temporary visible-strip snapshots. State, focus and hit testing update immediately. Header sort/filter icons provide short state feedback. Selected rows and columns use pointer capture with a viewport-sized drag snapshot, a 6px activation threshold and an insertion guide; release commits, Escape/cancellation discards the drag. Column moves remain available with core-owned sort/filter views, subject to host policy. Freeze separators draw in; context menus and choice panels use short entrance/exit transitions. The default layout duration is 220ms. Visibility, insertion/deletion, resizing and undo/redo use the same bounded layout layer. Header state icons are keyboard-accessible buttons that open the existing sort/filter dialogs. Scrolling cancels layout snapshots, reduced motion is respected, and at most 64 visible strips participate per transition. Removing retained selection ranges fades their viewport outlines; focus, range dragging and ordinary scrolling remain immediate. Very wide/tall viewports beyond that cap update the remaining strips immediately.

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

Menu/choice surfaces use a 2px translation without scaling text (up to 160ms enter, 100ms exit). Interrupted exits start from the rendered opacity/transform. Table-lock notice moves 2px and cancels prior notice animation before replay. Focus, selection entry, scrolling and resize guides remain immediate; deselection has a short exit fade; layout transitions retain the existing bounded strip snapshot and reduced-motion behavior.

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

Ctrl/Cmd+C/X/V between configured media cells preserves list values, names, IDs and alt text using the structured grid clipboard. Paste uses the normal parser/validation/permission pipeline and one undo command; cut clears its source only after a successful destination write. Plain text clipboard representation is JSON for lists. Canvas installs `parseMediaValue` as the default parser on media columns; a supplied column parser takes precedence. The helper is exported for a headless host or custom parser. F2, Enter and Edit cell open a visual media editor with thumbnails, labels, URL fields, reorder/remove controls, and Apply/Cancel. Embedded data URLs stay hidden behind a replacement field. Apply uses the column parser, validation, current permissions and one history command; external changes to the destination reject stale drafts. A host createEditor override takes precedence. Double-click and Alt+Enter open read-only details. Pasting a media list into an ordinary text column leaves JSON text, not a media widget.

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

| Area                    | Public extension point                                         | Host responsibility                                                                              |
| ----------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Data and remote loading | `dataSource`, `createAsyncDataSource` from core                | Storage, server queries, authorization, async save coordination                                  |
| External source changes | `captureRowIdentity`, `refreshData`                            | Capture IDs before structure changes; use `'values'` only for unchanged identities               |
| Notifications           | `subscribe`, `onEvent`, `onObserverError`                      | Unsubscribe on unmount; avoid nested mutations from callbacks                                    |
| Persisted state         | `exportState`, `restoreState`, `exportConfiguration`           | Persist/version storage; supply matching row IDs/schema and application policies                 |
| Painted content         | `renderCell`, `measureCellHeight`                              | Return handled=true only when fully painted; honor bounds/format; provide height measurement     |
| Accessible content      | `getCellLabel`, `accessibility`                                | Describe custom content and use viewport accessibility when appropriate                          |
| Parsing/validation      | column parser, `invalidInput`, permissions/resolver            | Validate paste and editor values; enforce server authorization                                   |
| Appearance              | `theme`, `selectionStyle`, `motion`, choice renderer           | Shared light/dark tokens, reduced-motion support and meaningful labels                           |
| Host sorting/filtering  | `viewMode: 'host'`, `onViewChange`                             | Fetch/reconcile a server view; local search does not query unloaded records                      |
| Structural changes      | `canChangeStructure`, `onRowChange`, `onReorder`, column types | Veto disallowed actions and persist application data                                             |
| Context menu            | `contextMenuSuggestions`                                       | Enable contextual suggestions or the complete built-in menu; custom menu items are not supported |

Canvas forwards the headless refresh, state and subscription APIs. See the core integration recipes for complete paging/refresh contracts. `destroy()` releases grid-owned UI and listeners; it does not destroy a host-owned source, subscriptions outside the grid or a metadata backend.

React/Vue adapters expose the grid instance through their documented ref/getGrid API. Keep construction options stable and call runtime methods on that instance; replacing factory options is not a reactive configuration update. Mount external components through `onEditorMount` and return their unmount function. Use the same hooks in vanilla, React and Vue; no framework dependency is added to core.

## Paste special, visibility, numbers and localization (0.2.0)

Canvas exposes values-only/formats-only/transposed/skip-empty paste, hide/show rows and columns, and decimal/integer/percent/currency formats. Hidden axes retain data and positive stored sizes while painting, navigation and viewport ARIA skip them. Number display uses `Intl.NumberFormat`; editing and callbacks retain raw values. Set `locale`, `currency` and `messages` at construction; complete English/Vietnamese message inventories are exported for host language packs. Menus, dialogs, choice/media editors and accessibility share these messages. See the [complete editing and remote guide](editing-and-remote.md). These additions are included in npm 0.2.0.

Version 0.2.0 bulk APIs, busy/focus behavior and history budgets are documented in the [bulk guide](bulk-commands.md).

### Runtime motion settings

Motion belongs to Canvas; the headless core commits state synchronously. Menu and API actions share the renderer's motion layer. Configure at mount with `motion` or replace settings without remounting:

```ts
grid.setMotion({
  duration: 220,
  easing: 'cubic-bezier(.22,1,.36,1)',
  selectionDuration: 120,
  surfaceDuration: 160,
  layout: true,
  selection: true,
  surfaces: true,
  liveSort: true,
});
const settings = grid.getMotion();
grid.setMotion(false);
```

Durations accept 0–1000ms; global duration 0 disables motion. Easing accepts a single Web Animations easing value. Each call replaces the settings and fills omitted fields with defaults; `liveSort` defaults to false. When enabled, `refreshData('values')` animates visible records that move under an active core sort, following stable row IDs. Update the DataSource first and retain row count, identities and order as required by values-only refresh. A newer operation or scrolling cancels temporary layers; reduced motion overrides all settings. Exit selection feedback is capped at 64 clipped rectangles; layout feedback at 64 strips. Bulk async operations, theme changes and ordinary value painting remain immediate. These preview settings are not serialized in core configuration/state.

Value repaint no longer dismisses an open context menu. Header menus survive live reordering when their column remains valid; cell menus close if their displayed row changes identity. Selection, layout changes, scrolling, actions and native popover dismissal still close menus as appropriate.

### Live value feedback

Set `motion: { valueIndicators: true, chartUpdates: true }` for numeric direction arrows and inline chart transitions. Arrows compare successive painted values of the same row ID and column key; initial values have no arrow, unchanged repaints retain direction. Canvas reserves a 16px leading gutter in numeric cells at least 40px wide, including custom renderers. Customize `theme.increaseColor` and `theme.decreaseColor`; arrow orientation also conveys direction.

Indicators default off, chart updates default on. Change switches through `setMotion`. Chart transitions use shared duration/easing and redraw only active cells. Reduced motion keeps arrows and applies chart geometry immediately; `motion: false` disables both. Canvas retains at most 4,096 recently painted snapshots and 512 samples per array; offscreen values outside that cache have no update history. Custom renderers receive optional `previousValue` and `animationProgress`. Source and accessible values update immediately; destroy releases snapshots.

Selection exit fades only removed tint outside the retained selection. Old borders disappear immediately; further selection changes cancel exit feedback. Highly fragmented rectangle subtraction falls back to immediate painting.
