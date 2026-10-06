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
  <AcheronGrid
    ref="grid"
    :options="options"
    style="height:400px;width:100%"
    @event="event => console.log(event.type)"
  />
</template>
