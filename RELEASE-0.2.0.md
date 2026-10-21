# Acheron Grid 0.2.0 — development preview

Version 0.2.0 is published on npm for all eight packages. The release workflow verified
independent tarball consumers before publication and exact registry versions afterward.
The original six npm 0.1.0 artifacts remain available and immutable.

## Changes since 0.1.0

- Add the optional export package with bounded CSV, XLSX and authorized semantic HTML output.
- Add the optional charts package with line, area, column and horizontal bar rendering.
- Add bounded live data, optimistic remote snapshots and writable paged sources with stable-ID
  drafts, canonical receipts, conflict handling and exact retry requirements.
- Add cooperative paste/update/history/view APIs, optional TSV worker decoding and history budgets.
- Extend paste special, hidden axes, numeric formats, localized messages, search and find/replace.
- Improve layout/value/chart motion, custom integrations, editor cleanup, accessibility metadata
  and independent package-consumer coverage.
- Preserve trailing empty rows in single-column TSV; reject malformed inserted row values before
  mutation; preserve parentheses in Markdown links. Harden rich clipboard, upload cancellation,
  menus and remote/MCP boundary validation.

## Packages and installation

The release aligns core, canvas, markdown, react, vue, export, charts and mcp at 0.2.0.
Install the browser packages with:

```sh
npm install @acheron-grid/core@0.2.0 @acheron-grid/canvas@0.2.0
```

Add optional packages at the same version. Core remains headless and framework-independent;
Canvas owns browser rendering. React and Vue remain thin lifecycle adapters.

## Migration from 0.1.0

Upgrade all installed Acheron packages together; do not mix the two versions. Existing core,
Canvas and adapter entry points, including `core/headless`, are retained. New APIs require
the matching 0.2.0 packages; consult their documented input, permission and lifecycle contracts.

Published 0.1.0 artifacts remain MIT. This release uses Apache-2.0 and ships LICENSE/NOTICE;
third-party attribution remains applicable. Review that license transition when upgrading.

## Validation and limits

Tag `v0.2.0` identifies commit `ac761dcdc908d81eeaa2d1f4c9b311b9bb41b788`.
The [release workflow](https://github.com/haodn-dev/acheron-grid/actions/runs/39637052405)
passed Node 22/24, Firefox and WebKit verification, independent tarball consumers and
exact npm-version consumers. Local checks also passed 253 unit tests, 181 Chromium
integration tests, 13 playground tests, 18 MCP tests and 2 release-tooling tests.

The six original packages publish through GitHub OIDC with provenance. The first export/charts
publication required an interactive bootstrap before npm allowed trusted-publisher setup;
those two initial artifacts have no CI provenance. All eight packages now restrict trusted
publishing to `haodn-dev/acheron-grid`, `release.yml` and `npm-production`, with publish and
stage-publish permissions. No dist-tag-management permission was granted.

This is a 0.x preview, not stable 1.0. Manual NVDA/VoiceOver, physical Safari/iOS/Android,
native clipboard interoperability and representative host performance remain open. Playwright
WebKit does not certify Safari. Production remote authorization, durable CAS/idempotency and
MCP-host acceptance remain application responsibilities. Cooperative preparation can yield;
final commits and structural history remain synchronous. Formula calculation, pivot and
multi-user collaboration are outside this release.

See [the changelog](CHANGELOG.md), [support limits](SUPPORT.md),
[manual acceptance](guides/manual-validation.md) and [release procedure](guides/releasing.md).
