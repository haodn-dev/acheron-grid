# @acheron-grid/vue

Vue 3 lifecycle adapter for the Acheron Grid Canvas renderer. MIT licensed. Development preview; install from a local built checkout, not npm.

## Usage

Install `@acheron-grid/core`, `@acheron-grid/canvas` and this package from the same checkout. Supply Vue 3.5 as a peer dependency. This adapter does not bundle Vue.

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

## Contract

- `options` is `GridOptions` without `container`. Use `shallowRef` or `markRaw` for sources/options to retain class identity. Replacing the options object destroys the old grid and creates a fresh one, resetting local UI/history and cancelling unsaved drafts. No deep watch of rows or options is performed.
- `theme`, `view`, `frozenRows` and `frozenColumns` update through public Canvas setters without remounting. Replace theme/view objects immutably. Theme patches merge; `{}` clears a view; undefined sends no command. Validation and permissions are unchanged.
- `@ready` emits the live grid and null on cleanup. The component ref exposes `getGrid(): Grid | null` for public operations.
- `@event` forwards typed core events. `options.onEvent`, if supplied, also runs. Latest Vue event listeners receive events without rebuilding the grid.
- Class, style and accessibility attributes fall through to the container. Supply a non-zero size. Slots inside the grid container are not supported.
- `onMounted` creates the renderer; `onBeforeUnmount` destroys it. SSR returns an empty container; browser hydration mounts the renderer.
- Update values through `grid.updateCells()`; use `grid.render()` after changing a compatible source externally, or replace `options` for an intentional reset. There is no separate controlled rows model.

Tested with Vue 3.5.32. Custom cells/editors remain Canvas hooks, not Vue cell components. Screen-reader support follows Canvas limits.

## Configuration persistence

Get the mounted grid through `getGrid()` or the ready callback and call `grid.exportConfiguration()`. To restore, import `restoreGridConfiguration` from `@acheron-grid/core`, validate the saved JSON against application columns/source row count, and spread its returned options into a new `options` object with `dataSource` and the application's theme/editors/permissions. Replacing `options` intentionally remounts the grid; it resets selection/history and discards unsaved editor drafts. Runtime `view`/freeze props override restored initial values when supplied. Core-managed view mode is required for export; host-managed projections remain host-owned. No automatic storage is performed.
