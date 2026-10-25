# Writable remote pages

`createPagedRemoteDataSource` is available in npm 0.2.0. It combines the bounded
async page loader with the remote writer's validation and exact retry protocol. Use it when the dataset
exceeds a practical local working set. Every module remains free and open source.

Run `npm run playground` and open `http://127.0.0.1:4180/paged/` for the complete HTTP example. It holds
10,000 server records, loads 20 at a time, retains two pages and demonstrates dirty-page eviction,
server sort/filter, rejection, lost receipt retry and conflict review. The example renders one page
through a source adapter; it deliberately remounts the grid at page boundaries and clears local history.
The backend is process-local, with a bounded receipt table, and has no production authentication.

## Construction and loading

Pass `datasetId`, `columnKeys`, injected `createAbortController` and `createMutationId`, plus `load` and
`write`. Paging options are `rowCount` (an initial hint), `pageSize` (default 100), `maxPages` (10),
`maxConcurrentLoads` (4), `maxPendingLoads` (100) and immutable `query`. `maxPendingCells` defaults to 1,000.

`load({ offset, limit, signal, query, expectedRevision })` returns
`{ datasetId, revision, total, rows: [{ id, values }] }`. Rows must cover the requested page exactly,
with every configured column and globally unique stable string/finite-number IDs. JSON values must be
finite/serializable within the shared remote payload/depth limits. The first page establishes a revision
and total. Later pages must match both; a stale response is rejected rather than mixed into the cache.
The server must apply query criteria to the complete authorized dataset, with deterministic ordering.

`loadPage(offset)` and inclusive `loadRange(start, end)` retain their bounded queue/cache semantics.
Unloaded values are `undefined`; `getPageState(offset)` distinguishes loaded/error state. Unloaded IDs
use a reserved `\0acheron-unloaded:` placeholder prefix; server IDs must not use it. Placeholders are
not backend record IDs. Loaded/draft rows expose their stable server ID.

## Staging and committing

`setValue`/atomic `setValues` stage JSON-safe edits only for loaded or already-dirty rows. Drafts retain
the original values and stable IDs independently of page eviction, bounded by pending cell count.
Direct source setters do not enforce engine permissions/history; user edits should flow through the
engine. `pendingCellCount` and frozen `getPendingChanges()` expose review state.

Object values retain their references while staged, so engine undo can recognize its own edits.
Treat these host-owned objects as immutable during commands. `commit()` snapshots the dirty cohort
before its first asynchronous wait; later host changes cannot alter the submitted intent or its retry.

`commit()` calls `write(mutation, signal, query)` with the existing immutable `RemoteMutation` contract:
dataset, unique mutation ID, expected dataset revision and cell previous/new values. The backend must
authorize every cell, atomically compare revision/previous values, apply the whole batch and durably
deduplicate IDs. Retrying an uncertain write must return the same stored receipt. Concurrent commit
calls reject; editing and query changes are blocked until the operation settles.

Every receipt includes `total` for the current server query:

- **Accepted delta:** the normal remote delta shape, covering every submitted cell and canonical side
  effects within the dirty-row cohort. A cohort contains the complete original row for every dirty ID.
  The base revision must match and the new revision must advance. The full page cache is then invalidated,
  so side effects on other rows and changes in query ordering are read on subsequent page loads.
- **Accepted snapshot:** a bounded canonical dirty-row cohort snapshot, never the entire dataset.
- **Rejected:** dataset/mutation ID and message. Drafts remain editable; correction or retry creates a
  new mutation ID because the previous request received a definite rejection.
- **Conflict:** a bounded server snapshot for the dirty-row cohort. Drafts and the conflict remain
  available for review; `acceptServer()` adopts its revision/total, discards drafts and invalidates pages.

Validation completes before accepted state is installed. A malformed receipt or lost transport response
leaves the exact mutation available for retry. An uncertain mutation cannot be discarded or edited.
Conflict merge/keep-mine is host-owned: save selected drafts, adopt the server, load the new rows, map
stable IDs to the new query indices, then reapply through current engine permissions/validation.
Do not reapply old positional indices blindly.

Successful commit does **not** fetch the dataset or even automatically reload a page. Call `loadPage`
for the visible working set. A write may change the query total or ordering, so it invalidates all cached
pages rather than pretending to patch a globally sorted query locally.

## Draft checkpoints (source preview)

Source builds after npm 0.2.1 add `exportDrafts()` and `restoreDrafts(unknown)`. These methods are not
available in the immutable 0.2.1 artifacts. The checkpoint is versioned JSON containing dataset ID,
revision, query, column keys/order, total, source positions, stable row IDs and previous/new values.
The host owns storage, privacy, quota errors and when to save; core has no browser/storage dependency.

```ts
import type { createPagedRemoteDataSource, PagedRemoteDraftSnapshot } from '@acheron-grid/core';

export function saveDraft(source: ReturnType<typeof createPagedRemoteDataSource<AbortSignal>>): string {
  const checkpoint: PagedRemoteDraftSnapshot = source.exportDrafts();
  return JSON.stringify(checkpoint);
}

export async function restoreDraft(
  source: ReturnType<typeof createPagedRemoteDataSource<AbortSignal>>,
  stored: string,
): Promise<void> {
  await source.restoreDrafts(JSON.parse(stored));
}
```

Export requires a loaded idle source; definitely rejected drafts can be exported, but in-flight,
uncertain or conflicting writes must be resolved first. This is not an idempotency/receipt log.
Restore requires no existing drafts/writer and an exactly matching query and column-key order.
It validates the bounded JSON payload, then loads affected pages sequentially (even with a one-page
cache) and checks server revision/total, stable IDs and serialized previous values. Only after all
checks succeed are the drafts installed together. Mismatch, transport error, cancel or destroy installs
no drafts; pages loaded during validation may remain cached. Changed query/schema/revision needs
explicit host reconciliation, not automatic positional migration.

Restore before mounting the engine, or remount/clear history afterward. Direct source restore, like
source setters, does not enforce application permissions or column validators. Treat storage as
untrusted, recheck current policies/values before committing and always enforce authorization/validation
on the server. Clear the stored checkpoint after an accepted commit; retain it when storage/restore
fails so the user can recover it. The runnable paged example has explicit save/restore buttons and uses
localStorage only for synthetic demo data; it does not autosave or restore on startup.

## Query, identity and lifecycle

`setQuery(criteria, rowCount?)` and `reset(rowCount?)` validate before clearing pages/revision and cancel
old generations. Unsent/rejected drafts must first be committed or explicitly `discardPending()`.
Uncertain/conflicting writes require resolution. `cancel()` cancels page loads; it does not cancel a
write or permit discarding a possibly accepted mutation. `destroy()` disposes cache/writer and aborts
owned requests. The host owns transport timeouts and persistence.

Observe page state with `subscribe`; commit status is read from `status`, `lastError`, `revision` and
`conflict` after awaiting the operation. Show pending/retry/review controls outside an inert grid region,
as the runnable example does. Page subscriptions are not write-status subscriptions.

After a query/load/commit changes identity or ordering, reconcile or recreate the engine before accepting
more user commands. Avoid `captureRowIdentity()` over a remote million-row dataset: it scans every row.
The example uses a bounded page adapter and remounts. Infinite viewport hosts should load visible pages,
clear stale history/row metadata and explicitly handle identity changes; positional placeholders are not
a substitute for stable IDs. Do not apply local sort/filter to a partly loaded dataset.

Durable persistence of uncertain mutations, editing during commit, row insertion/deletion transport,
automatic resync after server changes and production backend certification are outside this adapter. Memory bounds
cover page/draft counts, not arbitrary value byte sizes or exact browser heap usage.
