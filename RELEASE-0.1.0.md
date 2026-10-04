# Acheron Grid 0.1.0 — prepared, not published

First release candidate: headless TypeScript grid, Canvas renderer, React/Vue adapters, optional Markdown and MCP adapters. Website: https://acheron-grid.haoduong.dev/.

All six packages share 0.1.0. Publish in dependency order: core, canvas, markdown, react, vue, mcp. Root workspace stays private. Scope ownership and credentials must be checked by the publisher. No tag, release or npm publication has been created.

## Install after publication

```sh
npm install @acheron-grid/core@0.1.0 @acheron-grid/canvas@0.1.0
```

Optional packages: @acheron-grid/react, @acheron-grid/vue, @acheron-grid/markdown, @acheron-grid/mcp at 0.1.0. Until publication install the tarballs together to resolve internal dependencies locally.

## Scope

Selection, clipboard, scalar paste, deferred same-grid cut, rich text, editing, permissions, formatting, history, grouped headers/rows, frozen panes, merged cells and structural commands. Successful paste selects the entire destination; failure preserves selection and data. Image galleries, people stacks, native image paste and visual media editing with add/remove/reorder. Headless subscriptions, external-source reconciliation, state persistence and bounded read-only async paging. ESM and TypeScript declarations.

## Validation

Runtime commit `7fa33c5` passed clean-checkout verification on Windows / Node.js 24: typecheck, 66 Node tests, 3 MCP tests, 102 Chromium tests, 2 playground tests, and independent installation of all six tarballs with strict TypeScript, SSR and Canvas lifecycle checks. Subsequent documentation changes do not alter runtime behavior. Confirm Node 22/24 Ubuntu CI on the final merge commit before publication; see [the release checklist](RELEASING.md).

## Limits

Synchronous reads and atomic writes; optional async read-only page loading, cancellation and bounded caching. Remote editing/optimistic rollback, formulas, collaboration and cross-grid cut are not implemented. Optional parser remains separate from core. React >=18.3 <20, Vue >=3.5 <4. MCP local stdio documentation server and host-owned data adapter; no public HTTP endpoint or browser bridge. Chromium regression checks do not establish Safari/Firefox or full screen-reader support. Node 22/24 are CI targets; local results do not prove remote CI. Registry names and publication remain unverified.

MIT with bundled Lucide attribution. No previous public release to migrate from.
