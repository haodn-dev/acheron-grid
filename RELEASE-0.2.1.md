# Acheron Grid 0.2.1 — development preview

This patch aligns all eight packages at 0.2.1. The existing 0.1.0 and 0.2.0 artifacts and release tags remain unchanged. Publication and exact registry-consumer results are recorded after the release workflow completes.

## Changes since 0.2.0

- Omit empty virtualized header rows from the Canvas accessibility tree while preserving logical row indices and spans.
- Keep the Canvas npm README below the registry truncation limit. Advanced examples move into the canonical [Canvas recipes guide](guides/canvas-recipes.md); existing README heading anchors remain available.
- Correct copied MCP documentation links, package installation/version/support guidance and React/Vue instructions for external source changes using `refreshData`.

## Installation and migration

```sh
npm install @acheron-grid/core@0.2.1 @acheron-grid/canvas@0.2.1
```

Upgrade all installed Acheron packages together. Optional React, Vue, Markdown, export, charts and MCP packages use the same version. There are no public export/signature changes or data migrations from 0.2.0. Apache-2.0, NOTICE and third-party license obligations are unchanged. See [0.2.0 migration](RELEASE-0.2.0.md) when upgrading from 0.1.0.

## Validation and known limits

Release verification covers Node 22/24, portable Firefox/WebKit, strict independent tarball consumers and exact npm-version consumers. Results and the release commit are added when those checks complete; configuration alone does not imply a pass.

This is a 0.x development preview, not stable 1.0. Manual NVDA/VoiceOver, physical Safari/iOS/Android, native clipboard and representative host workload acceptance remain open. Remote authorization, durable storage and MCP-host acceptance remain host responsibilities. Bulk preparation can yield, but final validation/commit and view work still have main-thread costs; TSV Worker decoding does not move the whole engine into a Worker.

The MCP server still advertises the legacy `serverInfo.version` value `0.1.0`; use the installed package manifest/lockfile to identify the 0.2.1 npm artifact. This patch documents that metadata limitation without changing runtime APIs.
