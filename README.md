# Acheron Grid

> Your data. Your rules.
>
> A TypeScript data grid with a headless core, Canvas rendering, and React and Vue adapters.

Acheron Grid displays and edits tabular data without a framework dependency. The headless engine owns data commands, selection, permissions, layout and history. The browser package adds Canvas rendering, scrolling, editors, menus and dialogs.

## Status

This is an experimental development preview. APIs may change, packages are not published, and npm manifests are marked `private` to prevent accidental publication. Build and install from a local checkout. The project is licensed under [MIT](LICENSE).

| Package | Purpose | Runtime dependencies |
| --- | --- | --- |
| [@acheron-grid/core](packages/core/README.md) | Headless engine, synchronous sources and local row views; usable in Node.js | None |
| [@acheron-grid/canvas](packages/canvas/README.md) | Browser rendering and interactions | @acheron-grid/core |
| [@acheron-grid/markdown](packages/markdown/README.md) | Optional Markdown parsing adapter | marked |
| [@acheron-grid/react](packages/react/README.md) | React lifecycle adapter | Canvas; React peer dependency |
| [@acheron-grid/vue](packages/vue/README.md) | Vue 3 lifecycle adapter | Canvas; Vue peer dependency |
| [@acheron-grid/mcp](packages/mcp/README.md) | Optional documentation server and host-authorized grid tools | MCP SDK; @acheron-grid/core |

Core does not import Canvas or framework code. `@acheron-grid/core/headless` remains an alias for the headless API.

## Implemented features

- Virtualized rows and columns, sparse sizes, resize guides and runtime frozen panes.
- A default fixed row index, whole-row/column selection, rectangular and multiple ranges, keyboard navigation and TSV clipboard operations, single-cell paste across ranges and staged same-grid cut/paste.
- Native text/select/checkbox editors, searchable choices and multiple tags, multiline overlays, parsing/validation, image cells and custom cell drawing.
- Safe HTML rich text and optional Markdown parsing; visual editing hides markup while preserving source strings and partial formatting.
- Structural row/column insertion, deletion and reordering, merged cells and nested manual row groups with undo/redo.
- Searchable context menus, detected links and per-link badges for hovered/focused cells.
- Bounded layout motion, reduced-motion support and single-cell/range copy feedback.
- Versioned, validated export/restore of column order/widths, frozen counts and local sort/filters.
- Atomic local value updates, partial cell repaint, delta undo/redo and typed domain events.
- Capability permissions, cell/row/column/table value locks, sparse formatting and application control over formatting.
- Local search, opt-in column sort/filter views, themes and native dialogs that tolerate host CSS resets.
- An active-cell ARIA mirror, opt-in bounded viewport accessibility tree and keyboard status announcements. Complete screen-reader support remains unverified.

Core-managed local sorting/filtering preserves selection, history, locks, colors and sizes and refreshes after edits. Legacy host-managed projections remain supported. Rendering virtualization does not make filtering or in-memory storage independent of dataset size.

## Documentation

Start with the [practical guide](examples/vanilla/practical-guide.md) for editor configuration, keyboard interactions, clipboard/history, local views, grouped headers, structural operations, rich text, permissions and troubleshooting. Package README files provide detailed contracts and limits.

- [React integration](packages/react/README.md) and [Vue 3 integration](packages/vue/README.md).
- [Portable layout/view configuration](packages/core/README.md#portable-layout-and-view-configuration).
- [Copy feedback and motion](packages/canvas/README.md#copy-feedback-and-motion-details).
- [Changes](CHANGELOG.md) and [release preparation](RELEASING.md).

## Quick start

Use Node.js 22 or later to build the repository:

```sh
npm ci
npm run build
npm run playground
```

Open [the standalone playground](http://127.0.0.1:4180). It uses browser import maps and local packages, without a framework or CDN. Stop the server with Ctrl+C. See [the example guide](examples/vanilla/README.md).

In a separate application with an ESM-capable bundler, install both built packages:

```sh
npm install /path/to/acheron-grid-engine/packages/core /path/to/acheron-grid-engine/packages/canvas
```

Provide a container with explicit dimensions:

```html
<div id="grid" style="width:100%;height:480px"></div>
```

```ts
import { createGrid } from '@acheron-grid/canvas';
import { LocalDataSource } from '@acheron-grid/core';

const dataSource = new LocalDataSource([
  { id: 'row-1', name: 'Ada' },
  { id: 'row-2', name: 'Lin' },
], row => row.id);

const grid = createGrid({
  container: document.querySelector<HTMLElement>('#grid')!,
  columns: [{ key: 'name', title: 'Name', editable: true }],
  dataSource,
});

```

Call `grid.destroy()` when the owning view unmounts to release its DOM, listeners, observer and pending work.

For server-side or renderer-independent use, start with [`createGridEngine`](packages/core/README.md#usage). For browser options, contracts and keyboard behavior, read [the Canvas guide](packages/canvas/README.md).

## Development and verification

Run commands from the repository root after `npm ci`:

| Command | Purpose |
| --- | --- |
| `npm run build` | Build core, Canvas, optional Markdown, React and Vue adapters; ESM and TypeScript declarations |
| `npm run typecheck` | Build dependency declarations, then check all packages and the headless boundary |
| `npm test` | Build and run Node.js tests |
| `npm run test:mcp` | Verify MCP documentation, host authorization and grid tools |
| `npm run test:browser` | Build and run Chromium grid integration tests |
| `npm run test:playground` | Build and verify the standalone example |
| `npm run benchmark` | Measure headless Chromium render-callback cost and source reads |

Install the test browser with `npx playwright install chromium` before running browser tests. Benchmarks measure callback CPU time; they do not establish end-to-end FPS, GPU cost or peak memory. Browser tests and benchmarks share port 4179; the playground uses port 4180. Run suites using the same port sequentially and stop a manual playground server before its tests.

See [Contributing](CONTRIBUTING.md) for changes and bug reports.

[CI](.github/workflows/ci.yml) checks Node 22 and 24 on Ubuntu for pushes and pull requests: type checking, Node/SSR and MCP tests, package dry runs, Chromium integration and the standalone playground. Failed browser runs retain traces, screenshots and reports for seven days. The workflow does not publish packages.

## Limits and planned work

Data sources and validation are synchronous. Rows and columns can change through structural commands with state remapping and undo/redo; external source structure changes require a new view/mount. Local values, user state and history are in memory. Version-1 configuration exports a subset of layout/view state for initialization; storage, backend authorization and schema migration belong to the application. Cell data, row order/heights, groups, merges, formatting, locks, selection and history are not included.

Native browser scroll dimensions impose practical limits. Remote/async data, multi-column sorting and complete assistive-technology coverage are not implemented. Only Chromium is currently covered by browser tests.

Formula evaluation, charts, pivot tables, multi-sheet workbooks, Excel calculation compatibility and real-time collaboration are outside the current scope.

## License

Acheron Grid is available under the [MIT License](LICENSE). Copyright (c) 2026 Hao Duong. You may use, modify and redistribute it, including in commercial applications, subject to the license terms and preservation of the required notices.

The Canvas package embeds Lucide SVG assets under their existing ISC/MIT terms. Their attribution and license text are included in [LICENSE.lucide](packages/canvas/LICENSE.lucide); these terms cover those assets, not the entire project.

## Optional MCP adapter

See [@acheron-grid/mcp](packages/mcp/README.md) for a stdio documentation server and host-controlled read/update tools. It is separate from core and does not automatically connect to a browser playground.

## Author

Created by [Hao Duong](https://haoduong.dev/). See [Contributing](CONTRIBUTING.md) for bug reports and contributions. The author website is separate from the grid demo; a public demo domain has not been finalized.
