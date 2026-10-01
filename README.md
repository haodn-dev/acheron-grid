# Acheron Grid Engine

> Spreadsheet UX. Data-grid semantics. Canvas performance.

Acheron Grid Engine is an early-stage project to build a framework-independent, Canvas-based data grid engine in TypeScript. Its focus is the rendering, interaction, and data primitives developers need to build editable grids for the web, with spreadsheet-style selection and keyboard navigation.

The planned architecture separates the core engine from framework integrations, with direct use in vanilla JavaScript and dedicated adapters for React and Vue.

## Project status

The repository currently contains the initial project structure. The engine, public API, and framework adapters have not been implemented, and no installable package or runnable demo is available yet.

The capabilities described below are planned. Installation instructions, API documentation, and examples will be added as implementations become available.

## Design goals

- **Canvas rendering:** draw grid content on Canvas, with DOM elements for editors, menus, overlays, and accessibility support.
- **Viewport-based rendering:** virtualize both rows and columns to keep rendering work focused on visible data.
- **Framework-independent core:** keep rendering, interaction, and data handling in plain TypeScript, with framework integration handled by adapters.
- **Explicit data identity:** address data through row IDs and column keys, with data sources for local and remotely loaded records.
- **Incremental updates:** support targeted invalidation and batched changes to avoid unnecessary redraws.
- **Extensibility:** provide custom cell renderers, editors, themes, and plugin APIs.

Performance targets have not yet been validated by benchmarks.

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

[`packages/core/`](packages/core/README.md) is reserved for the TypeScript engine. It currently contains a placeholder README. Framework adapters, examples, themes, and benchmarks will be added as development progresses.

## License

A license has not yet been selected. Licensing information will be added before the first library release.
