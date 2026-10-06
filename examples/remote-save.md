# Host-owned remote saving

This source example keeps a fixed local dataset editable while an application saves drafts to a server. It is not a published remote-write adapter and does not make `DataSource.setValues` asynchronous. It uses only public core APIs, with no transport or framework dependency.

```js
import { createRemoteSaveExample } from './remote-save.mjs';

const session = createRemoteSaveExample({
  datasetId: 'people',
  revision: initialServerRevision,
  rows: initialServerRows, // Unique stable id and string name.
  createRequestId: () => crypto.randomUUID(),
  save: request => applicationTransport.savePeople(request),
});

session.engine.editCell(0, 0, 'Updated name');
const result = await session.save();
// Report result.status and session.status in the host UI.
// Handle rejected promises; a transport error leaves status "uncertain".
session.destroy();
```

The editable draft uses normal engine validation, permissions, events and history. The example accepts at most 10,000 fixed rows and one `name` column containing strings of at most 100 characters. It retains an O(rows) baseline and scans the dataset after an acknowledgment. It vetoes structural changes; it does not adapt unloaded remote pages. No draft survives process termination unless the application persists it.

## Server contract

Requests contain `datasetId`, globally unique `requestId`, `expectedRevision` and immutable `changes` with `rowId`, `columnKey`, `previous`, `value`. The server must authenticate and authorize the dataset and each update, validate the entire batch, check revision/expected values, and commit atomically. It must save the receipt with the commit, deduplicate a retry before checking its old revision, and reject reuse of a request ID with a different payload. Deduplication keys must be scoped to the authenticated principal and dataset. The host supplies the real backend; this example provides none.

Return `{ datasetId, requestId, status: 'saved', revision: expectedRevision + 1 }` only after all submitted values commit exactly. Server normalization requires a different receipt/reconciliation contract. Return matching IDs with `status: 'validation'` or `'conflict'` only when nothing committed; extra host error details may accompany the receipt. A transport exception or malformed receipt does not prove the transaction failed.

## Draft and failure behavior

- One save may run at a time. Editing, paste and undo can continue during the request.
- Success advances the baseline for the submitted values. Newer edits remain dirty; acknowledgments never write into the grid or clear its history.
- Validation/conflict preserves every draft. Resolve a conflict by retaining `getDrafts()`, reading an authoritative snapshot and opening a new session; use an application reconciliation UI before reapplying them. No automatic rebase or force overwrite is provided.
- On an uncertain outcome, `save()` retries the exact original frozen request, even if newer drafts exist. A successful retry reconciles that batch before a later save submits new drafts. Request IDs must remain unique across sessions, and the server must retain receipts long enough for the application's retries.
- `discardDrafts()` explicitly returns local values to the last acknowledged baseline through `engine.updateCells`. It respects current permissions, is one atomic history command, and can be undone. Clear filters hiding dirty rows before discarding. It is blocked while saving or uncertain because the server might already have committed.
- Destroy closes the engine and prevents a late receipt from updating session state. It does not cancel or undo a server transaction; reopening requires authoritative reconciliation. Export/persist drafts before closing if they must survive.

For production, the host owns transport timeouts, durable drafts/pending requests, session identity, server authorization/idempotency storage, conflict UI and reconnection. Live updates and remote history synchronization require their own contracts.

Run the reproducible integration checks from the repository root:

```sh
npm run build
node --test packages/core/tests/remote-save-example.test.mjs
```

These checks are included in `npm test` and CI: edits/undo during save, atomic local validation, server rejection, permission veto and rollback history, lost acknowledgment/idempotent retry, malformed receipts and teardown.
