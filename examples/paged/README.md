# Paged remote editing

## Remote viewport source preview

The current checkout also serves [remote viewport](http://127.0.0.1:4180/paged/viewport) after `npm run playground`. This separate read-only mode keeps one Canvas mount and one `createPagedRemoteDataSource`. Choose 100,000 or 1,000,000 synthetic records and lowest/highest ID first, then Apply data view. It disposes the old coordinator, changes the source query/count (canceling its old page generation), calls `grid.resetData()`, and explicitly starts a new coordinator from `grid.getViewport()`. Selection/history and row metadata are cleared; the source/grid are reused. These source APIs and the example are not included in npm 0.3.0.

The host coordinator in `viewport-loader.js` reads public viewport regions, prioritizes visible pages, then adds at most one neighboring page per edge within the eight-page cache budget. It uses 100-row pages and one in-flight request; rapid scrolling changes the next requested window instead of building a request backlog. Oversized visible windows report a cache-budget error. Requests use the existing source's explicit `loadRange`; the synthetic endpoint generates only the requested page.

Each coordinator exclusively owns loading within one fixed query/count/revision epoch and starts with an empty cache. On each ready notice it compares its bounded known-page set against `getPageState`, refreshing each newly loaded or evicted page separately. A distant eviction never creates a large continuous refresh window. Failed pages wait for explicit retry. Refresh rejection retains bounded pending windows and pauses further loading until retry succeeds; it does not cancel an editor or local Find. Dispose before destroying grid/source or changing its epoch; transport generation protection rejects late results. Do not reset or change query/count/revision behind a live coordinator. This synthetic endpoint supports only numeric task-ID ordering, not general server queries.

Local Find is disabled with `allowSearch: false`, host-managed sort/filter has no callback, and structural/layout changes are denied. Placeholder rows remain navigable but cannot be copied or edited. Ctrl+A/copy uses existing clipboard bounds and never loads the full source. This example does not expose export or save actions. Loaded-row draft/history retention across eviction is covered separately in the coordinator's headless integration tests; the viewport UI remains read-only.

Native scrollbar limits still apply. Automated probes record actual `scrollHeight`, `clientHeight` and maximum scroll offset for these workloads in each working browser; a logical million-row source alone does not prove reachability, FPS, peak memory or network latency. Reset uses an explicit selection clear and scroll-to-zero fallback; stable-ID anchoring and writable remote viewport controls remain later work. The paged editing example below retains its explicit remount boundaries.

Firefox Linux CI exposed collapse of a 32-million-pixel row spacer. Canvas now preserves a 16-million-pixel prefix when the browser collapses the requested extent. Rows beyond that working range remain unreachable by native scrolling. Use host pagination for complete access beyond that prefix; the separate 10,000-record paged editing example demonstrates the pattern. No scroll scaling or full-range support is claimed.

Run `npm run playground` at the repository root and visit `http://127.0.0.1:4180/paged/`.
Build matching core/Canvas packages from the checkout. Writable paging is included in npm 0.2.0; npm 0.1.0 does not include it.

The server holds 10,000 records. The source loads 20-row pages, retains two cached pages and up to 100
dirty cells. Stage an edit, visit three other pages to force eviction, then save: the mutation and
receipt contain changed cells, not the whole dataset. Successful writes invalidate cached pages and
the application reloads only its visible page. Drafts survive eviction independently of the page cache.

Use the response selector to reject a draft or lose a receipt after accepting it. Retry resends the exact
mutation. Simulate an external edit to review a conflict, then explicitly adopt the server version.
Version 0.3.0 also lets you Save draft locally, reload the page, then Restore saved draft.
This explicit localStorage checkpoint contains unsent synthetic data; restore verifies affected pages
and rejects stale revisions/IDs/values without installing partial drafts or sending writes. Accepted saves
remove the checkpoint. Resolve uncertain writes first; their receipt/mutation IDs are not persisted.
Search and ordering run on the complete server dataset. This demo supports one title contains filter
and one title sort; it is not a general query server.

Version 0.3.0 adds paged mutation recovery. The example journals its synthetic query,
total, dirty-row positions and exact writer checkpoint in localStorage before HTTP write. Reload restores
only that dirty cohort, without loading the old server revision or sending automatically. Choose Save /
retry to reuse the same request and query. Accepted receipts invalidate the cache and update the query
total/order before reloading the visible page. Navigation/editing stays blocked while uncertain; definite
rejection reloads the current page before enabling edits. Storage/restore errors retain the journal for
explicit recovery. This is not production auth, durable server receipts or unsent-draft autosave.

The UI uses a bounded page adapter and remounts Canvas after page/query changes or accepted writes.
That clears local history and row metadata at each boundary. It is a pagination example, not an
infinite-scroll renderer or durable write-receipt store. Query/refresh is disabled while drafts remain; edits
during transport are disabled. The server keeps receipts in memory and caps them at 100; restart to
clear them. Production authentication, per-cell authorization, durable atomic write/idempotency storage,
timeouts, migration and deployment remain host responsibilities.

See the [full source contract](../../guides/paged-remote.md) and [cooperative bulk APIs](../../guides/bulk-commands.md).
