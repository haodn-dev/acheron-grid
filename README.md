# Acheron Grid

> Your data. Your rules.
>
> A TypeScript data grid with a headless core, Canvas rendering, and React and Vue adapters.

Acheron Grid displays and edits tabular data without a framework dependency. The headless engine owns data commands, selection, permissions, layout and history. The browser package adds Canvas rendering, scrolling, editors, menus and dialogs.

[Live demo and documentation](https://acheron-grid.haoduong.dev/)

## Status

Version 0.1.0 is prepared as the first development preview. APIs may change before 1.0. Packages have not yet been published; build from source or install the packed artifacts until publication. The project is licensed under [MIT](LICENSE).

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
- Native text/select/checkbox editors, searchable choices and multiple tags, multiline overlays, parsing/validation, single images, image galleries, people stacks, visual media editing and custom cell drawing.
- Safe HTML rich text and optional Markdown parsing; visual editing hides markup while preserving source strings and partial formatting.
- Structural row/column insertion, deletion and reordering, merged cells and nested manual row groups with undo/redo.
- Searchable context menus, optional contextual suggestions and link popovers with host-controlled website metadata.
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

For server-side or renderer-independent use, start with [`createGridEngine`](packages/core/README.md#quick-start). For browser options, contracts and keyboard behavior, read [the Canvas guide](packages/canvas/README.md).

## Integration examples

### Input validation

Columns can validate typed values with `validate(value)`, returning an error message or `undefined`. Invalid values are rejected by default before any batch writes. Set `invalidInput: 'allow'` to save invalid values with a warning in Canvas. Parsing remains separate: a parser exception always prevents saving.

```ts
{ key: 'name', title: 'Name', editable: true,
  validate: value => String(value).trim() ? undefined : 'Name is required.' },
{ key: 'website', title: 'Website', editable: true, invalidInput: 'allow',
  validate: value => /^https?:\/\//.test(String(value)) ? undefined : 'Use an HTTP or HTTPS URL.' }
```

Canvas displays live editor feedback and a corner marker for saved invalid values; hover or the viewport accessibility mirror exposes the message. See the vanilla example for both policies.

### Choice order, contextual actions and link previews

Multiselect commits preserve the original input order by default. Newly selected values append in configured option order. `choiceEditor: { valueOrder: 'options' }` opts into configured order. Typing from an option moves focus into the filter; Space continues to toggle a choice.

`contextMenuSuggestions: true` starts with up to eight enabled actions relevant to the selection. Suggested actions can be switched off in the menu; Show all actions and typing always expose the complete command list. Suggestions use deterministic selection rules, with no model, telemetry or automatic command execution.

Whole-row Cut/Paste transfers cell contents and leaves record IDs and row positions intact. All source and destination cells must permit writing. Use Move rows to change record positions, including rows with read-only ID columns.

Hovering a link cell opens its name and full address by default, with an external-link icon inside each entry. `linkPreview: false` (or omitted) avoids metadata requests. For optional website details, provide a host callback:

```ts
linkPreview: {
  enabled: false, // keep the link popover; the user can enable website details
  load: async (href, signal) => {
    const response = await fetch('/api/link-preview?url=' + encodeURIComponent(href), { signal });
    if (!response.ok) throw new Error('Preview unavailable');
    return response.json(); // { title?, description?, image? }
  }
}
```

Use `linkPreview: false` to omit the loader entirely, or set `allowMetadata: false` on the configuration object to prohibit loading and hide the user toggle. `enabled: false` only sets the initial state and still allows the user to enable website details. Enforce permitted destinations on the backend as well.

Canvas aborts pending previews on close and preserves the link on failure. The host controls trusted domains, metadata caching and network access; core performs no network requests.

Developer integration examples: [headless refresh, state and async paging](packages/core/README.md#data-and-lifecycle), [remote choices, custom editor cleanup and URL metadata](packages/canvas/README.md#developer-integration-recipes).

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
| `npm run test:package` | Install six packed artifacts in an independent consumer; verify TypeScript, SSR and Canvas lifecycle |
| `npm run benchmark` | Measure headless Chromium render-callback cost and source reads |

Install the test browser with `npx playwright install chromium` before running browser tests. Benchmarks measure callback CPU time; they do not establish end-to-end FPS, GPU cost or peak memory. Browser tests and benchmarks share port 4179; the playground uses port 4180. Run suites using the same port sequentially and stop a manual playground server before its tests.

See [Contributing](CONTRIBUTING.md) for changes and bug reports.

[CI](.github/workflows/ci.yml) checks Node 22 and 24 on Ubuntu for pushes and pull requests: type checking, Node/SSR and MCP tests, package dry runs, Chromium integration, the standalone playground and independent packed-package consumers. Failed browser runs retain traces, screenshots and reports for seven days. The workflow does not publish packages.

## Limits and planned work

Engine reads and validation are synchronous; the optional async source loads remote pages into a synchronous read-only cache. Rows and columns can change through structural commands with state remapping and undo/redo; external source changes reconcile through `captureRowIdentity` / `refreshData`. Local values, user state and history are in memory. Version-1 configuration exports a subset of layout/view state for initialization; storage, backend authorization and schema migration belong to the application. `exportState` additionally persists row heights, groups, merges, formatting, locks and selection; data, policies and history are excluded.

Native browser scroll dimensions impose practical limits. Read-only async paging is supported through `createAsyncDataSource`; async setters, multi-column sorting and complete assistive-technology coverage are not implemented. Only Chromium is currently covered by browser tests.

Formula evaluation, charts, pivot tables, multi-sheet workbooks, Excel calculation compatibility and real-time collaboration are outside the current scope.

## License

Acheron Grid is available under the [MIT License](LICENSE). Copyright (c) 2026 Hao Duong. You may use, modify and redistribute it, including in commercial applications, subject to the license terms and preservation of the required notices.

The Canvas package embeds Lucide SVG assets under their existing ISC/MIT terms. Their attribution and license text are included in [LICENSE.lucide](packages/canvas/LICENSE.lucide); these terms cover those assets, not the entire project.

## Optional MCP adapter

See [@acheron-grid/mcp](packages/mcp/README.md) for a stdio documentation server and host-controlled read/update tools. It is separate from core and does not automatically connect to a browser playground.

## Author

Created by [Hao Duong](https://haoduong.dev/). See [Contributing](CONTRIBUTING.md) for bug reports and contributions. The public demo and documentation are available at [acheron-grid.haoduong.dev](https://acheron-grid.haoduong.dev/).

First release preparation: [0.1.0 release notes](RELEASE-0.1.0.md).
