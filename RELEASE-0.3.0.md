# Acheron Grid 0.3.0 — development preview

This minor release adds recovery APIs for unsent drafts and uncertain remote writes across all eight aligned packages. It is being verified for publication; npm 0.2.1 remains available until publication completes. Earlier artifacts and tags remain immutable.

## Changes since 0.2.1

- Paged `exportDrafts()` / `restoreDrafts(unknown)` preserve unsent edits in host-owned storage. Restore checks affected server pages and installs the whole cohort atomically.
- Bounded and paged `exportMutation()` / `restoreMutation(unknown)` recover an immutable request without loading a newer revision or generating a new mutation ID. Restoring never sends automatically.
- Optional `persistMutation` hooks complete host storage before transport. Storage failure prevents writes; disposal while persisting cannot start a late write.
- Paged mutation checkpoints retain the exact query, original total and stable dirty-row positions without storing the whole dataset. Accepted receipts invalidate cached pages and update query totals/order.
- HTTP examples demonstrate browser reload, exact retry, changed filter membership, stale/corrupt checkpoint rejection and host-owned localStorage for synthetic data.

## Installation and migration

```sh
npm install @acheron-grid/core@0.3.0 @acheron-grid/canvas@0.3.0
```

Upgrade all installed Acheron packages together. React, Vue, Markdown, export, charts and MCP use the same version. Existing package export paths and APIs are retained; the new APIs are additive. No existing engine-state migration is required. The new JSON checkpoint formats start at version 1 and are separate from engine UI state. Match the checkpoint type to its source and do not treat a draft checkpoint as a write receipt.

Hosts must scope storage to the authenticated principal/dataset, authorize before displaying cached data and enforce server authorization, validation, durable CAS and idempotency. Keep globally unique IDs for subsequent new mutations. Clear journals after validated definite results or explicit conflict adoption; retain them on uncertain errors. See the [paged recovery guide](guides/paged-remote.md) and [bounded recovery guide](guides/editing-and-remote.md).

## Validation and known limits

The integrated candidate is checked with typecheck, Node tests, Chromium and portable Firefox/WebKit integration, standalone playground, eight independent packed consumers, MCP/release tooling, documentation examples and formatting. Exact revision, counts, CI and registry results are recorded after verification completes; configuration alone is not a pass.

This remains a 0.x development preview, not stable 1.0. Screen-reader/physical-device/native clipboard acceptance is deferred to users and remains unverified. Production backend/MCP-host acceptance remains host-owned. Editing during commit, query/schema migration, collaboration and worker execution outside TSV remain separate work. Bounded mutation checkpoints capture the bounded working snapshot; paged checkpoints capture the dirty cohort. Both must fit the JSON payload/depth limits. Storage callbacks must settle; transport/storage deadlines and privacy belong to the host.

Apache-2.0, NOTICE and embedded third-party obligations are unchanged. Original npm 0.1.0 artifacts retain their original MIT license. The MCP runtime still advertises legacy `serverInfo.version` 0.1.0; use the package manifest/lockfile to identify the installed artifact.
