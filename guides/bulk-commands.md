# Cooperative bulk commands

These APIs are available in the source preview. Published npm 0.1.0 does not include them.

`updateCellsAsync(updates, options)`, `pasteAsync(tsv, options, pasteOptions?)`, `undoAsync(options)`,
`redoAsync(options)` and `setViewAsync(view, options)` prepare work in chunks. They share validation,
permissions and history with their synchronous counterparts. The complete write remains atomic:
cancellation or preparation failure never commits a partial batch. Reads see the previous committed state.
Other engine mutations reject while a job is pending; destruction cancels the job at its next checkpoint.

```ts
const cancellation = new AbortController();
await grid.pasteAsync(text, {
  signal: cancellation.signal,
  yieldControl: () => new Promise<void>((resolve) => setTimeout(resolve, 0)),
  getRevision: () => applicationRevision,
  onProgress: ({ phase, completed, total }) => showProgress(phase, completed, total),
});
```

The host owns scheduling. Supply a real task yield (for example `MessageChannel`, `scheduler.yield()`
where supported, or the timer above); `Promise.resolve()` alone does not allow browser painting.
Progress describes the current pass and can restart between passes. Cancellation is cooperative and
cannot interrupt a running callback or a write that has already started. Handle the rejected promise.

Use `getRevision` when external data, schema, validation or permission policy can change while awaiting.
It must change on every such change, including changes outside the edited cells. Callbacks must be pure.
Cell writes also recheck current identities, previous values and writable/pasteable permissions before
commit. Update coordinates/options are snapshotted at entry; object values retain the normal reference
semantics and must not be mutated in place. Do not mutate the source behind the engine without a revision
guard and the normal refresh lifecycle.

Canvas temporarily makes its root inert and sets `aria-busy` while these explicit APIs run. Put progress
and cancel controls outside that root. Finish or cancel an active editor first. Focus returns to the
viewport if it was inside the grid. Native clipboard events continue to use synchronous paste.

The final atomic source write, authority checks, history installation, projection installation and
invalidation remain synchronous. Value history preflight yields; structural/layout history does not.
Active local views can require synchronous reprojection after a write. Slow host callbacks, large
structural snapshots and final commits can still block the main thread. These APIs are not workers and
do not guarantee a frame-time budget or reduce total CPU time. Server-side sort/filter is preferable for
datasets larger than the local working set.

## Retained history

Pass `historyLimits: { maxCommands: 100, maxValueCells: 200_000 }` when constructing an engine or Canvas
grid. Both limits must be positive safe integers. Defaults preserve 100 commands with no value-cell
budget. A single value/format command exceeding `maxValueCells` is rejected before writing; otherwise
the oldest entries are evicted until both budgets hold. Undo/redo transfers retain the same records.
The budget counts value and format change records, not bytes. Nested values and structural snapshots
can consume substantially more memory; this is not a JavaScript heap cap.
