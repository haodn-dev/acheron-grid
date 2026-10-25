# Paged remote editing

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
