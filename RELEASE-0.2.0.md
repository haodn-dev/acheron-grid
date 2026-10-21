# Acheron Grid 0.2.0 — development preview candidate

This is the release candidate for all eight packages. It has not yet been published to npm.
Version 0.1.0 remains the published preview for the original six packages. Do not install
0.2.0 from the registry until publication and registry-consumer verification complete.

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
Until publication, build and install matching tarballs from this candidate. After publication,
the intended browser installation is:

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

Release acceptance is recorded on the exact candidate commit and in its CI run. A local test pass
does not establish remote CI or registry publication. The release workflow tests independent
tarball consumers before publication and exact npm versions afterward.

This is a 0.x preview, not stable 1.0. Manual NVDA/VoiceOver, physical Safari/iOS/Android,
native clipboard interoperability and representative host performance remain open. Playwright
WebKit does not certify Safari. Production remote authorization, durable CAS/idempotency and
MCP-host acceptance remain application responsibilities. Cooperative preparation can yield;
final commits and structural history remain synchronous. Formula calculation, pivot and
multi-user collaboration are outside this release.

See [the changelog](CHANGELOG.md), [support limits](SUPPORT.md),
[manual acceptance](guides/manual-validation.md) and [release procedure](guides/releasing.md).
