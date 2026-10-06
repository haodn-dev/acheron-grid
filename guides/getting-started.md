# Create your first grid

Use Canvas for an interactive browser grid. Use core alone for Node.js, a custom renderer or a headless data workflow. React and Vue wrap the same Canvas renderer; they do not introduce a different data model.

## Choose your version

Version 0.1.0 is available on npm for core, Canvas, React, Vue, Markdown and MCP. These are development previews, with experimental APIs. Pin the same version across packages. Export, charts, live data, multi-sort, query snapshots and find/replace are newer source previews; they are not included in npm 0.1.0.

This guide's minimal example works with npm 0.1.0 and the current source. See [documentation versions](versions.md) before using source-only recipes.

## Install

Use an ESM application with a bundler. Node.js 22 or later is required for repository builds and checks; browser mounting requires Canvas 2D and ResizeObserver.

```sh
npm install @acheron-grid/core@0.1.0 @acheron-grid/canvas@0.1.0
```

For a framework, add only its adapter and supply its peer dependency:

```sh
npm install @acheron-grid/react@0.1.0 react react-dom
# Or, for Vue:
npm install @acheron-grid/vue@0.1.0 vue
```

React accepts React 18.3 or 19; Vue requires Vue 3.5 or later within Vue 3. Browser/framework coverage is described in [support](../SUPPORT.md).

## Mount

Give the container explicit dimensions. A zero-height container cannot display a grid.

```html
<div id="grid" style="width:100%;height:480px"></div>
```

Put this in your browser entry module:

```ts
import { LocalDataSource } from '@acheron-grid/core';
import { createGrid } from '@acheron-grid/canvas';

const container = document.querySelector<HTMLElement>('#grid');
if (!container) throw new Error('Missing #grid container.');

const source = new LocalDataSource([
  { id: 'r1', name: 'Ada', score: 42 },
  { id: 'r2', name: 'Lin', score: 57 },
], row => row.id);

const grid = createGrid({
  container,
  dataSource: source,
  columns: [
    { key: 'name', title: 'Name', editable: true },
    { key: 'score', title: 'Score', editable: true,
      parse: text => Number(text),
      validate: value => typeof value === 'number' && Number.isFinite(value)
        ? undefined : 'Enter a finite number.' },
  ],
});

// Programmatic values are typed; parsers convert editor/paste text only.
grid.updateCells([{ rowIndex: 0, columnKey: 'score', value: 43 }]);
grid.undo();

// Call this when your application removes the grid's owning view.
export function dispose() { grid.destroy(); }
```

The grid shows two records. Double-click a name or press F2 to edit; numeric text is parsed and validated before saving. `updateCells()` uses typed values and still runs column validation and writable permissions. It does not run parsers or require the editor's `editable` flag.

## Understand the data model

| Concept | Rule |
| --- | --- |
| Row ID | Unique string or finite number; retain it when the same record changes |
| Column key | Unique field name; independent of its display title |
| Coordinates | Zero-based visible row/column indices; the row-index gutter is not a data column |
| Data source | Synchronous reads; writable sources provide synchronous atomic setters |
| Ownership | The grid owns its DOM/history; your application owns data transport and source lifetime |

`LocalDataSource` keeps shallow row snapshots. Nested arrays and objects remain application-owned. Use grid commands for tracked writes; direct source writes need an explicit refresh and do not become undo commands.

## Next steps

- [Integration guide](integration.md): validation, clipboard, views, refresh, persistence and extensions.
- [React](../packages/react/README.md) or [Vue](../packages/vue/README.md): stable options, runtime props and cleanup.
- [Core](../packages/core/README.md): headless contracts and source-only remote/live recipes.
- [Canvas](../packages/canvas/README.md): browser editors, media, layout and keyboard behavior.
- [Security boundaries](../SECURITY.md): server authorization and trusted host callbacks.

## Build a source preview

The website identifies the exact source revision for its preview docs. Check out that revision before using source-only APIs; do not assume the default branch or npm 0.1.0 contains them.

```sh
git clone --branch feat/core-readiness https://github.com/haodn-dev/acheron-grid.git
cd acheron-grid
npm ci
npm run build
npm run playground
```

For a consumer project, pack and install all packages you need together so the internal 0.1.0 dependency ranges resolve to the same source artifacts:

```sh
# In the built engine checkout:
npm pack --workspace @acheron-grid/core --workspace @acheron-grid/canvas --pack-destination /absolute/path/to/artifacts
# In your application:
npm install /absolute/path/to/artifacts/acheron-grid-core-0.1.0.tgz /absolute/path/to/artifacts/acheron-grid-canvas-0.1.0.tgz
```

Create the artifacts directory first. Add export/charts/framework tarballs to the same install command when needed. Their manifest version may still read 0.1.0; the source revision, not that number alone, identifies an unreleased build.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| Blank grid | Container dimensions, browser console, correct browser entry point |
| Editing is unavailable | Editable column, writable source, current permissions and locks |
| Numeric paste fails | Add a parser and validation for the typed column |
| Edits disappear after a React/Vue update | Keep options identity stable; a new options object intentionally remounts |
| External changes do not appear | Call `refreshData()` with the correct identity mode |
| API missing from npm | Switch docs to 0.1.0 or install a matching source build |
