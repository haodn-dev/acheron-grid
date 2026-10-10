# Acheron Grid — React and Vue

Lifecycle adapters are separate packages; core remains framework-independent. Version 0.1.0 of all packages is published on npm. Install core, Canvas and the chosen framework adapter; local built checkouts remain supported for development.

## React

React lifecycle adapter for the Acheron Grid Canvas renderer. Current source is Apache-2.0 licensed; published npm 0.1.0 retains MIT. Version 0.1.0 is available on npm as an experimental development preview.

### Usage

Install with `npm install @acheron-grid/core @acheron-grid/canvas @acheron-grid/react`. Supply React 18.3 or 19 as a peer dependency. This adapter does not bundle React.

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

### Contract

- `options` is `GridOptions` without `container`. Keep its identity stable with `useMemo`. Replacing it destroys the old grid and creates a fresh instance, resetting local UI/history and cancelling any unsaved draft. The adapter does not deep-watch options or rows.
- `theme`, `view`, `frozenRows` and `frozenColumns` are separate runtime props. Replace object props immutably; they call the existing public Canvas setters and preserve the instance. Theme patches merge. Pass `{}` to clear a view; undefined means no command. Underlying validation and permissions still apply.
- `onReady(grid)` receives the live instance; `onReady(null)` signals cleanup. `ref.current?.getGrid()` returns the current instance or null. Use it for edits, structure, history and other public methods.
- `onEvent` receives typed core events. `options.onEvent`, if supplied, is also called. Runtime callback changes do not recreate the grid; callbacks inside `options` remain part of the mount configuration.
- Only the adapter owns the container DOM. Do not put React children inside it. The host must provide a non-zero size.
- Effects mount/destroy the renderer. SSR renders an empty container without DOM access; hydration mounts the browser grid. React StrictMode setup/cleanup replay is supported.
- Use `grid.updateCells()` for value changes, `grid.render()` after externally changing a compatible source, or replace `options` to intentionally recreate. This is not a controlled `rows` component.

Tested with React/React DOM 19.1.0 and React 18-compatible type declarations; the complete React version matrix is not verified. Screen-reader support follows Canvas limits. Custom rendering and editors remain Canvas hooks, not React cell components.

## Vue

Vue 3 lifecycle adapter for the Acheron Grid Canvas renderer. Current source is Apache-2.0 licensed; published npm 0.1.0 retains MIT. Version 0.1.0 is available on npm as an experimental development preview.

### Usage

Install with `npm install @acheron-grid/core @acheron-grid/canvas @acheron-grid/vue`. Supply Vue 3.5 as a peer dependency. This adapter does not bundle Vue.

```vue
<script setup lang="ts">
import { shallowRef } from 'vue';
import { LocalDataSource } from '@acheron-grid/core';
import { AcheronGrid } from '@acheron-grid/vue';
import type { AcheronGridHandle } from '@acheron-grid/vue';

const grid = shallowRef<AcheronGridHandle | null>(null);
const options = shallowRef({
  columns: [{ key: 'name', title: 'Name', editable: true }],
  dataSource: new LocalDataSource([{ id: 1, name: 'Alpha' }], row => row.id),
});
</script>

<template>
  <AcheronGrid ref="grid" :options="options" style="height:400px;width:100%"
    @event="event => console.log(event.type)" />
</template>
```

### Contract

- `options` is `GridOptions` without `container`. Use `shallowRef` or `markRaw` for sources/options to retain class identity. Replacing the options object destroys the old grid and creates a fresh one, resetting local UI/history and cancelling unsaved drafts. No deep watch of rows or options is performed.
- `theme`, `view`, `frozenRows` and `frozenColumns` update through public Canvas setters without remounting. Replace theme/view objects immutably. Theme patches merge; `{}` clears a view; undefined sends no command. Validation and permissions are unchanged.
- `@ready` emits the live grid and null on cleanup. The component ref exposes `getGrid(): Grid | null` for public operations.
- `@event` forwards typed core events. `options.onEvent`, if supplied, also runs. Latest Vue event listeners receive events without rebuilding the grid.
- Class, style and accessibility attributes fall through to the container. Supply a non-zero size. Slots inside the grid container are not supported.
- `onMounted` creates the renderer; `onBeforeUnmount` destroys it. SSR returns an empty container; browser hydration mounts the renderer.
- Update values through `grid.updateCells()`; use `grid.refreshData('values')` after external value changes with unchanged row identities/order/count; capture identities before structural changes and call `grid.refreshData(previousIds)`, or replace `options` for an intentional reset. There is no separate controlled rows model.

The current source validation uses Vue 3.5.43. Custom cells/editors remain Canvas hooks, not Vue cell components. Screen-reader support follows Canvas limits.

## Configuration persistence

Get the mounted grid through `getGrid()` or the ready callback and call `grid.exportConfiguration()`. To restore, import `restoreGridConfiguration` from `@acheron-grid/core`, validate the saved JSON against application columns/source row count, and spread its returned options into a new `options` object with `dataSource` and the application's theme/editors/permissions. Replacing `options` intentionally remounts the grid; it resets selection/history and discards unsaved editor drafts. Runtime `view`/freeze props override restored initial values when supplied. Core-managed view mode is required for export; host-managed projections remain host-owned. No automatic storage is performed.
