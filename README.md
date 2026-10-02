# Acheron Grid Engine

> Spreadsheet UX. Data-grid semantics. Canvas performance.

Acheron Grid Engine is an early-stage project to build a framework-independent, Canvas-based data grid engine in TypeScript. Its focus is the rendering, interaction, and data primitives developers need to build editable grids for the web, with spreadsheet-style selection and keyboard navigation.

The planned architecture separates the core engine from framework integrations, with direct use in vanilla JavaScript and dedicated adapters for React and Vue.

## Project status

The first core preview implements read-only Canvas rendering, row and column virtualization, native scrolling, and a local data source. Single-cell selection and keyboard navigation are also available. It builds to an ESM package with TypeScript declarations. The API is experimental and may change.

Start with the [Canvas browser guide](packages/canvas/README.md) or [headless core guide](packages/core/README.md) for local installation, an example, and API limitations. No package has been published. Opt-in DOM editing, atomic local batch updates, partial cell repaint and undo/redo are available. Rectangular selection, TSV copy/paste, individual row/column resize and a built-in context menu are available. Multiple ranges, remote data sources and framework adapters remain planned. Canvas cell content is not yet accessible to screen readers. The V1 scope below remains the target, not a list of completed features.

@acheron-grid/core runs selection, layout, editing, clipboard and history without browser globals. @acheron-grid/canvas provides createGrid and depends on the public core entry. The earlier core/headless subpath remains supported; browser imports now use the Canvas package.

## Design goals

- **Canvas rendering:** draw grid content on Canvas, with DOM elements for editors, menus, overlays, and accessibility support.
- **Viewport-based rendering:** virtualize both rows and columns to keep rendering work focused on visible data.
- **Framework-independent core:** keep rendering, interaction, and data handling in plain TypeScript, with framework integration handled by adapters.
- **Explicit data identity:** address data through row IDs and column keys, with data sources for local and remotely loaded records.
- **Incremental updates:** support targeted invalidation and batched changes to avoid unnecessary redraws.
- **Extensibility:** provide custom cell renderers, editors, themes, and plugin APIs.

A reproducible headless Canvas callback benchmark is available via npm run benchmark. End-to-end frame rate and memory targets remain unverified.

## Planned V1 scope

| Area | Planned capabilities |
| --- | --- |
| Rendering and layout | Row and column virtualization, resizing, frozen panes |
| Interaction | Cell and range selection, multiple ranges, keyboard navigation |
| Editing | Inline editors, clipboard operations, undo and redo |
| Data | Local and asynchronous data sources, partial updates, batched updates |
| Customization | Custom renderers and editors, basic themes |
| Integration | Vanilla JavaScript API, React and Vue adapters |

V1 focuses on displaying and editing tabular application data. Formula evaluation, charts, pivot tables, multi-sheet workbooks, Excel calculation compatibility, and real-time collaboration are outside its scope.

## Repository structure

[`packages/core/`](packages/core/README.md) contains the headless engine and unit tests; [packages/canvas](packages/canvas/README.md) contains browser rendering and interactions. Browser integration tests live in `tests/`. Framework adapters, standalone examples and themes remain planned. The Canvas preview includes a render-callback benchmark in headless Chromium.

## Development

Use Node.js 22 or later. Run `npm ci`, then `npm run build`. Check types with `npm run typecheck` and run unit tests with `npm test`. For browser tests, install Chromium with `npx playwright install chromium` and run `npm run test:browser`.

## License

A license has not yet been selected. Licensing information will be added before the first library release.
