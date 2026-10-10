# Version 1.0 contracts and acceptance

This is the selected acceptance policy for a future 1.0, not a stable release announcement.
Current packages remain 0.x/source previews. Publication is postponed. All features and optional
modules remain free and open source; stability is evaluated separately for each package.

## Scope and compatibility

The first acceptance priority is the headless engine, Canvas and React/Vue lifecycle adapters.
Existing public exports and names, including `core/headless`, are retained. A package can receive
1.0 only after every public API it exports has a documented contract and passes its applicable gates.
Calling an export experimental does not exempt a published 1.x package from compatibility obligations.
Markdown, export, charts and MCP need their own input/output, lifecycle, safety and dependency checks.

The current publisher aligns and publishes all eight packages together. An all-package 1.0 therefore
requires all eight packages to pass. Releasing only a stable subset first would require a separately
reviewed publisher/versioning change; this document does not enable that release path.

Formula/workbook calculation, pivot, collaboration, worker execution, reload-persistent drafts and
editing during a remote commit are outside this acceptance scope. They are not prerequisites for 1.0
when the limits below are explicit. Remote/MCP production integration gates apply to their support
claims; they do not require a backend to use the headless engine with local data.

## Behavioral contracts

| Area                 | Contract                                                                                                                                                                                                                                                                                |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Coordinates          | Engine commands use the visible row projection; DataSource methods use source indices. Column keys and stable row IDs identify records. A visible index is not a backend ID.                                                                                                            |
| Identity and refresh | Capture identity before external structural changes when remapping is needed. Refresh clears stale history/pending cut; values-only refresh requires unchanged IDs/order/count. Identity capture scans the source.                                                                      |
| Mutations            | Validate the complete command, current permissions and values before one controlled write. Typed update bypasses text parsing, not validation or writable permissions. Text editing/paste have their own capabilities.                                                                  |
| Permissions          | Hiding is presentation, not authorization. Value locks and formatting capabilities are independent. Backend authorization remains server-owned.                                                                                                                                         |
| History              | Undo/redo rechecks current identity, values and permissions. Locks are outside history. Retention counts commands/value-format records, not heap bytes. Read history availability after the command settles; notification order across different command types is not an API guarantee. |
| Callbacks            | Host callbacks are trusted synchronous code unless their signature explicitly returns a promise. Observer failures are isolated in the bounded error queue. Read committed data from notifications; do not perform nested mutations.                                                    |
| Bulk                 | Explicit cooperative APIs yield during preparation; the final atomic write/history/invalidation and some projections remain synchronous. A host revision must cover external data/schema/policy changes for guarded final checks to yield safely. Native paste stays synchronous.       |
| Local views          | Local sort/filter operates on the complete local working set. Do not apply it to a partly loaded remote dataset and call the result global ordering. Structural commands require the documented projection restrictions.                                                                |
| State                | Exported UI state/configuration excludes row data, callbacks and history. Validate unknown input through restore APIs; unsupported schemas fail explicitly. Generated group IDs and internal ordering counters are opaque, not contiguous sequence contracts.                           |
| Lifecycle            | Destroy is idempotent. Hosts still own external sources, subscriptions, storage and transport deadlines. React/Vue options identity changes may remount. Render is not identity reconciliation.                                                                                         |
| Remote               | JSON payload bounds, revisions, previous values and mutation coverage are checked before acceptance. Retry uncertain writes with the exact mutation ID/payload. Pending/conflicting writes block unsafe edits; adoption/merge and engine reconciliation are explicit host actions.      |

The generated [core API](core-api.md), [Canvas API](canvas-api.md), [bulk guide](bulk-commands.md)
and [remote guide](editing-and-remote.md) give the owning method and validation details. No existing
export is deprecated by this policy; a future rename/removal needs an actual replacement and migration.

## Version and deprecation policy

For a package that has reached 1.0:

1. Incompatible exports, signatures, behavior or persisted wire schemas require a major version.
   Compatible additions are minor; fixes conforming to the documented contract are patch releases.
2. A planned removal includes `@deprecated`, its replacement, a before/after migration example and a
   changelog entry. Keep it for at least two minor releases and 90 days, whichever finishes later;
   remove it only in the next major version. Deprecation starts when that notice is published.
3. A security fix that cannot preserve compatibility needs an explicit advisory, migration and release
   decision. It is not a general exemption for unannounced removals.
4. Package SemVer, UI-state/configuration versions and remote/MCP protocol revisions have separate
   meanings. Preserve old persisted input with an explicit migration or reject it without partial state.

0.x/source previews still require pinned installation, a Git revision for source builds, migration notes
and the same correctness checks. No 1.0 version, tag or npm channel is created by this policy.

## Acceptance ledger

The local source baseline `d3daa37` has 150 Node tests, 15 MCP tests, 110 Chromium tests,
106 WebKit tests with four Chromium-only exclusions, six playground tests on each browser,
eight packed consumers and eight default benchmark tests. Two timing profiles are opt-in; the new
cooperative profile was run separately. These results describe that baseline, not later release commits.
Firefox could not launch on the Windows host. Required Linux CI must pass on the exact candidate SHA.

| Gate           | Evidence required before closing                                                                                                                                                                          |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API            | Package export maps and built declarations reviewed, semantic contracts recorded, no unresolved incompatible change; migrate intentional changes.                                                         |
| Correctness    | Clean install; typecheck, Node/MCP/release/docs/format, Chromium/Firefox/WebKit integration and playground; independent packed consumers. Preserve existing assertions and exclusions.                    |
| Browser/device | Record actual OS/browser versions. Playwright WebKit is not Safari certification; physical Safari/touch/native clipboard need separate evidence before promising support.                                 |
| Accessibility  | Keyboard/focus/validation/selection/menu/virtualization regression and serious/critical axe findings resolved; NVDA and VoiceOver workflows recorded manually.                                            |
| Performance    | Declare dataset shape and host budget before testing; warmups, raw samples, p50/p95/task delay and memory method. Reference budgets are not universal guarantees.                                         |
| Remote/MCP     | Authorized real-host accepted/rejected/conflict/lost-receipt/retry/resync/destroy scenarios; durable server CAS/idempotency and metadata disclosure policy. SDK tests are separate from model evaluation. |
| Documentation  | Catalog hashes, complete examples, source site snapshots and release availability match the candidate; frozen 0.1.0 scope remains separate.                                                               |
| Distribution   | Inspect all tarballs, versions/internal dependencies, licenses/NOTICE/third-party obligations, release notes and exact-head CI. Publishing requires a separate decision.                                  |

Use the [manual acceptance protocol](manual-validation.md) to record PASS / FAIL / NOT RUN with an
owner, revision, environment and evidence. Missing equipment or a production host leaves a gate open;
it does not turn an automated fixture into a manual pass.

## Operational limits

Clipboard admission remains 100,000 cells and 10 million UTF-16 code units. These are validation caps,
not interactive latency promises. History cell budgets are optional; arbitrary object sizes can cost more.
Page/draft counts bound the remote working set, not exact bytes or unlimited total rows. Native browser
scroll geometry also limits directly addressable surfaces.

The 100k-cell guarded paste reference measured roughly 77 ms for its longest slice and 1.38 seconds
elapsed under 4x CPU/mobile emulation. It still misses a 50 ms frequent-interaction reference budget;
total throughput needs more work. See [raw measurement context](../BENCHMARKS.md). Physical-device
and true browser/GPU peak-memory acceptance remain open. Select a smaller local working set or
server-owned queries for applications whose interaction budget these workloads cannot meet.
