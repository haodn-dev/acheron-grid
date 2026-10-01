# @acheron-grid/core

An experimental, framework-independent Canvas data grid engine written in TypeScript.

## Current capabilities

- Read-only Canvas rendering with fixed row heights and column widths.
- Row and column virtualization, native scrolling, and a pinned column header.
- A local data source with unique row IDs and shallow row snapshots.
- Resize observation, coalesced rendering, and explicit cleanup.

This package is a development preview, not a published release. Selection, editing, remote data sources, and framework adapters are not implemented. Canvas cell content is not yet accessible to screen readers. Performance has not been benchmarked.

## Build from source

From the repository root, using Node.js 22 or later:

```sh
npm ci
npm run build
```

The package exports ESM JavaScript and TypeScript declarations from `dist/`. It has no runtime dependencies.

## Usage

Install the built package from a local checkout in your consumer project:

```sh
npm install /path/to/acheron-grid-engine/packages/core
```

```ts
import { createGrid, LocalDataSource } from '@acheron-grid/core';

const container = document.querySelector<HTMLElement>('#grid')!;
const dataSource = new LocalDataSource([
  { id: 'row-1', name: 'Ada', score: 42 },
  { id: 'row-2', name: 'Lin', score: 57 },
], row => row.id);

const grid = createGrid({
  container,
  columns: [
    { key: 'name', title: 'Name' },
    { key: 'score', title: 'Score' },
  ],
  dataSource,
  rowHeight: 32,
  columnWidth: 160,
  headerHeight: 36,
});

// On unmount:
grid.destroy();
```

Give the container explicit dimensions, such as `width: 100%; height: 480px`. Mount in a browser with Canvas 2D and ResizeObserver support. Importing the package alone does not access the DOM.

## API

`LocalDataSource(rows, getRowId)` copies the row array and shallow-copies each row. IDs must be unique strings or finite numbers. Nested objects are not cloned. This initial source is read-only; missing properties return `undefined`, while invalid row indices throw `RangeError`.

The `DataSource` interface exposes `getRowCount()`, `getRowId(index)`, and `getValue(index, columnKey)`. Grid dimensions use the row count at mount time; changing the row count requires remounting. Custom sources must provide synchronous values and valid counts.

`createGrid(options)` returns `render()` and `destroy()`. `render()` schedules a viewport redraw, coalesced into the next animation frame. `destroy()` removes only the grid's own DOM and releases its listeners and observer; repeated calls are safe. Calls to `render()` after destruction do nothing.

Column keys must be unique. All cell dimensions must be positive finite numbers. Values are rendered as plain text using `String(value)`; `null` and `undefined` display as empty cells.

## Limits

All local rows reside in memory. Virtualization bounds cell rendering work, not data storage. Native scrolling is subject to browser scroll-size limits, so this preview does not guarantee arbitrary dataset dimensions. Cells have a uniform width and height; there are no custom renderers, editors, or mutation APIs yet.
