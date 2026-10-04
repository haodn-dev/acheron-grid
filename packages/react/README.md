# @acheron-grid/react

React lifecycle adapter for the Acheron Grid Canvas renderer. MIT licensed. Development preview; install from a local built checkout, not npm.

## Usage

Install `@acheron-grid/core`, `@acheron-grid/canvas` and this package from the same checkout. Supply React 18.3 or 19 as a peer dependency. This adapter does not bundle React.

```tsx
import { useMemo, useRef } from 'react';
import { LocalDataSource } from '@acheron-grid/core';
import { AcheronGrid } from '@acheron-grid/react';
import type { AcheronGridHandle } from '@acheron-grid/react';

export function Sheet() {
  const ref = useRef<AcheronGridHandle>(null);
  const options = useMemo(() => ({
    columns: [{ key: 'name', title: 'Name', editable: true }],
    dataSource: new LocalDataSource([{ id: 1, name: 'Alpha' }], row => row.id),
  }), []);
  return <AcheronGrid ref={ref} options={options}
    style={{ height: 400, width: '100%' }}
    onEvent={event => console.log(event.type)} />;
}
```

## Contract

- `options` is `GridOptions` without `container`. Keep its identity stable with `useMemo`. Replacing it destroys the old grid and creates a fresh instance, resetting local UI/history and cancelling any unsaved draft. The adapter does not deep-watch options or rows.
- `theme`, `view`, `frozenRows` and `frozenColumns` are separate runtime props. Replace object props immutably; they call the existing public Canvas setters and preserve the instance. Theme patches merge. Pass `{}` to clear a view; undefined means no command. Underlying validation and permissions still apply.
- `onReady(grid)` receives the live instance; `onReady(null)` signals cleanup. `ref.current?.getGrid()` returns the current instance or null. Use it for edits, structure, history and other public methods.
- `onEvent` receives typed core events. `options.onEvent`, if supplied, is also called. Runtime callback changes do not recreate the grid; callbacks inside `options` remain part of the mount configuration.
- Only the adapter owns the container DOM. Do not put React children inside it. The host must provide a non-zero size.
- Effects mount/destroy the renderer. SSR renders an empty container without DOM access; hydration mounts the browser grid. React StrictMode setup/cleanup replay is supported.
- Use `grid.updateCells()` for value changes, `grid.render()` after externally changing a compatible source, or replace `options` to intentionally recreate. This is not a controlled `rows` component.

Tested with React/React DOM 19.1.0 and React 18-compatible type declarations; the complete React version matrix is not verified. Screen-reader support follows Canvas limits. Custom rendering and editors remain Canvas hooks, not React cell components.

## Configuration persistence

Get the mounted grid through `getGrid()` or the ready callback and call `grid.exportConfiguration()`. To restore, import `restoreGridConfiguration` from `@acheron-grid/core`, validate the saved JSON against application columns/source row count, and spread its returned options into a new `options` object with `dataSource` and the application's theme/editors/permissions. Replacing `options` intentionally remounts the grid; it resets selection/history and discards unsaved editor drafts. Runtime `view`/freeze props override restored initial values when supplied. Core-managed view mode is required for export; host-managed projections remain host-owned. No automatic storage is performed.
