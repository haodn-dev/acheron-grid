# Remote HTTP editing example

Run `npm run playground`, then open http://127.0.0.1:4180/remote/. This example uses a real local HTTP server and the public `createRemoteDataSource`/Canvas APIs. Data and idempotency receipts live only in this server process; restart to reset them. This is an integration fixture, not a production service or authentication implementation.

Stage an edit, then save. Edits pause during loading/commit. A rejected response keeps the draft and displays the server message. Correct it or switch back to Accept and retry. Another-client simulation changes the server revision; the next save shows the server snapshot and the draft. Accept the server version, or explicitly reapply reviewed draft fields through engine validation against current stable row IDs, then save again. Reapply is not automatic merge or a force overwrite.

The lost-receipt mode applies the write, stores its receipt, then returns HTTP 503 to model a gateway failure after commit. The client cannot infer whether the write succeeded. Explicit retry sends the same mutation ID/payload, and the backend returns the stored receipt without advancing its revision again. Browsers may transparently retry connection resets, so a 503 makes this demonstration observable and deterministic.

The backend validates dataset/row/field/value bounds, checks expected revision and previous values, preflights the entire batch and rejects reuse of an ID with a different payload. Requests cap at 16 KiB/100 changes; title values cap at 200 characters and receipts cap at 100. It binds through the loopback playground server and denies cross-origin JSON writes. Simulation endpoints are demonstration controls, never production endpoints.

For production, implement principal authentication, per-dataset/row/field authorization, durable atomic storage/CAS and durable idempotency receipts, transport deadlines and safe error messages. In-memory receipts cannot protect retries across server restarts. Add endpoint integration evidence before claiming backend support. Paged writes, persisted drafts across reload and concurrent editing during commit are separate contracts and are not implemented here.

The playground suite exercises pending, rejection, conflict review, idempotent retry and axe scans at desktop/mobile viewport sizes. Browser emulation and axe do not establish screen-reader, physical touch or OS clipboard support. See the [manual acceptance protocol](../../guides/manual-validation.md).
