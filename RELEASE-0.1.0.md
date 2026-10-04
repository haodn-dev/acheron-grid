# Acheron Grid 0.1.0 — prepared, not published

First release candidate: headless TypeScript grid, Canvas renderer, React/Vue adapters, optional Markdown and MCP adapters. Website: https://acheron-grid.haoduong.dev/.

All six packages share 0.1.0. Publish in dependency order: core, canvas, markdown, react, vue, mcp. Root workspace stays private. Scope ownership and credentials must be checked by the publisher. No tag, release or npm publication has been created.

## Install after publication

npm install @acheron-grid/core@0.1.0 @acheron-grid/canvas@0.1.0

Optional packages: @acheron-grid/react, @acheron-grid/vue, @acheron-grid/markdown, @acheron-grid/mcp at 0.1.0. Until publication install the tarballs together to resolve internal dependencies locally.

## Scope

Selection, clipboard, scalar paste, deferred same-grid cut, rich text, editing, permissions, formatting, history, grouped headers/rows, frozen panes, merged cells and structural commands. Successful paste selects the entire destination; failure preserves selection and data. ESM and TypeScript declarations.

## Limits

Synchronous local data; no formulas, collaboration, async source lifecycle or cross-grid cut. Optional parser remains separate from core. React >=18.3 <20, Vue >=3.5 <4. MCP local stdio documentation server and host-owned data adapter; no public HTTP endpoint or browser bridge. Chromium regression checks do not establish Safari/Firefox or full screen-reader support. Node 22/24 are CI targets; local results do not prove remote CI. Registry names and publication remain unverified.

MIT with bundled Lucide attribution. No previous public release to migrate from.
