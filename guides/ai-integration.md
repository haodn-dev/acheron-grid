# Acheron Grid — AI integration notes

## Read first

Read [getting-started.md](getting-started.md), then the package README files and exported TypeScript types in the version being integrated. Acheron Grid is an experimental preview; all six packages have version 0.1.0 on npm; APIs remain experimental. Read-only async paging is implemented; do not infer async writes or server-wide local queries. React and Vue adapters are implemented; read their package references for the exact contract.

## Architecture

Application → Canvas interaction → public core API → data source and sparse state.

The host owns storage, authentication and business rules. Core owns controlled commands, permissions and history. Canvas reads state and maps browser gestures to public operations. Markdown parsing is an optional adapter.

## Supported interaction

Selection/ranges, local edits with parsing and reject/warn validation, TSV/structured clipboard, scalar broadcast and staged same-grid cut, undo/redo, independent capability permissions, sparse formatting, frozen panes, resizing, reordering, merges and row groups. Local sort/filter views and text search are available. HTML/Markdown source strings are displayed as safe text runs; visual editors hide markup from users. Galleries, people stacks, media editors, native image paste and optional host upload hooks are implemented.

## Integration rules

Use stable row IDs and column keys. Keep dimensions non-zero. Release the grid with `destroy()` on unmount. Use public mutation APIs rather than writing internal state. Honor format metadata in custom renderers. Do not treat client permissions as server authorization. Validate incoming data in the host boundary.

## MCP adapter — implemented development preview

The optional `@acheron-grid/mcp` package now provides a stdio documentation server and a host-owned GridEngine adapter. Read the [MCP package reference](/reference/mcp) for launch instructions and tool contracts.

- Documentation resources: five package README snapshots in npm 0.1.0; seven in Source preview (including export and charts), no grid data by default.
- Host tools: approved schema, bounded cell reads, optional atomic cell updates by row ID and column key.
- Writes require host authorization, validation, expected-value conflict checks and core writable permissions; use normal core history.
- No browser bridge or HTTP authentication setup is included. Running the CLI does not connect to the browser playground. Structural, view and formatting tools remain future scope.

## Machine-readable reading index

Use [/llms.txt](/llms.txt) to discover public Markdown snapshots. Human-readable pages are under [/reference](/reference); source Markdown is linked on every page.

## Data and state

Capture row identities before source structure changes and call `refreshData(previousIds)`. Use `refreshData('values')` only for unchanged identities/order/count. Refresh clears history/cut. Multiple `subscribe` observers are supported, with isolated errors through `onObserverError` / `takeObserverErrors`.

`createAsyncDataSource` is a read-only cache with explicit loading, cancellation/retries and bounded successful/error states. Hosts own visible-page loading, server queries, query identity resets and concurrency. Async setters and optimistic saves are not included.

`exportConfiguration` stores a layout/view subset. `exportState` / `restoreState` also cover row identities/heights, selection, locks, formatting, groups and merges. Restore checks matching identities/schema and policies and requires an unlocked table. Data, callbacks, history, drafts and pending clipboard are excluded.

## Extensions and limits

Remote choices use `loadOptions`; external editor UI uses `onEditorMount` with cleanup. Metadata uses host-owned `linkPreview.load`; `allowMetadata: false` disables requests. Canvas projection is not a general HTML sanitizer. Blob images require host uploads for durable use.

MCP provides host-authorized schema/reads and optional scalar writes, not an automatic browser bridge or complete agent dataset API. Formulas, pivots, workbooks, realtime collaboration remain outside scope. Optional charts/export, multi-column sorting, live sources, query snapshots, find/replace, paste special, hidden axes, number formats, Canvas localization and bounded remote snapshot writes are implemented in Source preview, outside npm 0.1.0. Select the matching documentation channel before using them. Chromium automation does not prove complete browser, accessibility, physical touch, frame-rate or peak-memory support.


For source-only optimistic remote writes, reconnect/resync and explicit conflicts, follow the [editing and remote contract](editing-and-remote.md). Async page sources remain read-only; the host server must implement atomic revision checks, authorization and durable mutation deduplication.
