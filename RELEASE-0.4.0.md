# Acheron Grid 0.4.0 — development preview

This candidate adds local grouping/tree views and bounded remote viewport integration across eight aligned packages. Publication and exact-registry consumer verification are pending. Earlier releases remain immutable. All features and optional modules remain open source and free.

## Changes since 0.3.0

- Local grouping by one scalar column with count/sum snapshots, separate group metadata, expansion state, leaf-only writes/exports, Canvas disclosure, keyboard navigation and treegrid accessibility.
- Local parent-ID trees with duplicate/orphan/cycle/depth validation, sibling sorting, ancestor-preserving filtering, expansion state and Canvas navigation. Parent-ID editing and unsupported row-layout operations are rejected.
- `refreshRows(startRow, endRow)` refreshes an inclusive source-row window without a whole-source ID map. Matching identities retain value history; stale-identity batches are dropped atomically with an explicit result/event.
- `resetData()` adopts flat source epoch/count changes without scanning logical row IDs. It clears selection/history and row metadata while preserving documented column geometry and application policies.
- Canvas `getViewport()` / `onViewportChange` share core geometry and coalesce notifications. Hosts own loading, cache budgets and server queries. `allowSearch: false` disables local Find without scanning remote records.
- Runnable read-only 100k/1M viewport examples and a separate writable 10k paged example with one source/grid, bounded cache eviction, editor protection, explicit Save, exact-request recovery, conflict adoption and draft checkpoints.
- React/Vue inherit Canvas options and handles. HTML/MCP treat synthetic group headers separately from source records. Accessibility fixes cover bounded refresh, disabled Find shortcuts and group-focus clearing; numeric zero expansion accepts either sign.
- A usable native scroll prefix when an oversized browser spacer collapses. This preserves a working range; it does not provide full-range scroll scaling.

See the [comparison with 0.3.0](https://github.com/haodn-dev/acheron-grid/compare/v0.3.0...v0.4.0), [core contracts](packages/core/README.md), [Canvas contracts](packages/canvas/README.md) and [examples](examples/paged/README.md).

## Installation and migration

After publication, install matching versions of the packages your application uses:

```sh
npm install @acheron-grid/core@0.4.0 @acheron-grid/canvas@0.4.0
```

The aligned packages are [core](https://www.npmjs.com/package/@acheron-grid/core/v/0.4.0), [Canvas](https://www.npmjs.com/package/@acheron-grid/canvas/v/0.4.0), [Markdown](https://www.npmjs.com/package/@acheron-grid/markdown/v/0.4.0), [React](https://www.npmjs.com/package/@acheron-grid/react/v/0.4.0), [Vue](https://www.npmjs.com/package/@acheron-grid/vue/v/0.4.0), [export](https://www.npmjs.com/package/@acheron-grid/export/v/0.4.0), [charts](https://www.npmjs.com/package/@acheron-grid/charts/v/0.4.0) and [MCP](https://www.npmjs.com/package/@acheron-grid/mcp/v/0.4.0). Framework peers remain host dependencies.

Existing export paths and default flat-grid behavior remain. Grouping/tree are opt-in; no existing engine-state migration is required. Their separate view-state formats start at version 1. TypeScript consumers that exhaustively handle `GridInvalidation` must handle the new `rows` and `reset` variants; event consumers must account for `data:rows` and `data:reset` when adopting these methods.

Grouped display indices include synthetic headers. Inspect `getRowMetadata()` before calling identity getters: a group has no source RowId, and `getRowId()` / `getRowSourceIndex()` reject it. Copy and export operate on visible selected leaves. Tree rows remain source records, including parents; reparenting through the parent-ID field is unavailable.

Keep existing `refreshData()` integrations unless deliberately adopting the stricter bounded refresh/reset contracts. Finish editors, close local Find and settle bulk work and pending/uncertain writes **before** changing a source epoch/query. Reset uses an explicit selection/history clear and scroll-to-zero fallback; it does not find a stable-ID anchor or preserve positional undo across epochs. Hosts must report every changed/evicted window within an unchanged epoch.

## Validation

The candidate must pass Node 22/24 CI, Chromium and portable Firefox/WebKit, independent packed consumers, documentation/API checks and the release workflow. Publication is complete only after all eight exact npm versions pass the registry consumer. Final revision, workflow and registry evidence will be recorded after those gates finish; source or dry-run checks alone are not publication evidence.

## Known limits

This remains a 0.x development preview, not stable 1.0. Manual screen-reader, physical-device and native OS clipboard acceptance remains unverified and deferred to users. Automated keyboard/Axe/synthetic clipboard checks do not establish those results.

Grouping/tree require a complete bounded local dataset and rebuild local projections on value changes; they are not server-wide operations over a partial cache. Unsupported merges, manual outlines, row sizing/hiding, frozen rows and structural combinations reject according to the package contracts. Formula, pivot, workbook, remote tree/grouping and collaboration remain separate work.

Affected browsers retain only a 16-million-pixel native scroll prefix when a larger spacer collapses. Rows beyond that prefix require host pagination; logical million-row tests do not prove complete native range, FPS or peak memory. Remote examples use explicit cache/request budgets and deny operations on unloaded placeholders. Demo receipts remain process-local and bounded; production authorization, durable atomic writes/idempotency and storage deadlines belong to the host.

## License

Apache-2.0, project NOTICE and embedded third-party obligations are unchanged. All features/modules are free and open source; there are no paid-only editions or license keys. The immutable npm 0.1.0 artifacts retain their original MIT license. MCP still advertises legacy `serverInfo.version` 0.1.0; identify the installed artifact through its package manifest/lockfile.
