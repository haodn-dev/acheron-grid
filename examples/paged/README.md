# Paged remote editing

Run `npm run playground` at the repository root and visit `http://127.0.0.1:4180/paged/`.
Build matching source-preview core/Canvas packages; npm 0.1.0 does not include writable paging.

The server holds 10,000 records. The source loads 20-row pages, retains two cached pages and up to 100
dirty cells. Stage an edit, visit three other pages to force eviction, then save: the mutation and
receipt contain changed cells, not the whole dataset. Successful writes invalidate cached pages and
the application reloads only its visible page. Drafts survive eviction independently of the page cache.

Use the response selector to reject a draft or lose a receipt after accepting it. Retry resends the exact
mutation. Simulate an external edit to review a conflict, then explicitly adopt the server version.
Search and ordering run on the complete server dataset. This demo supports one title contains filter
and one title sort; it is not a general query server.

The UI uses a bounded page adapter and remounts Canvas after page/query changes or accepted writes.
That clears local history and row metadata at each boundary. It is a pagination example, not an
infinite-scroll renderer or durable draft store. Query/refresh is disabled while drafts remain; edits
during transport are disabled. The server keeps receipts in memory and caps them at 100; restart to
clear them. Production authentication, per-cell authorization, durable atomic write/idempotency storage,
timeouts, migration and deployment remain host responsibilities.

See the [full source contract](../../guides/paged-remote.md) and [cooperative bulk APIs](../../guides/bulk-commands.md).
