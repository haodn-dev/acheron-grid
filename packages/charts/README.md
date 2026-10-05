# @acheron-grid/charts

Optional free/MIT inline line, column and horizontal bar renderer. Source preview, not yet published to npm. It depends on Canvas; core does not depend on charts. It allocates no listeners or persistent cache.

## Installation and complete example

Build a source revision that includes charts. Pack core, Canvas and charts, then install all three tarballs together. Charts are not available through a published npm 0.1.0 install. See [source installation](../../guides/getting-started.md#build-a-source-preview).

Use a browser container with explicit dimensions, as in Getting started:

```ts
import { LocalDataSource } from '@acheron-grid/core';
import { createGrid } from '@acheron-grid/canvas';
import { createChartRenderer } from '@acheron-grid/charts';

const container=document.querySelector<HTMLElement>('#grid');
if(!container)throw new Error('Missing #grid container.');
const grid = createGrid({
  container,
  columns:[{key:'trend',title:'Trend'},{key:'summary',title:'Text summary'}],
  dataSource:new LocalDataSource([{id:'r1',trend:[2,4,null,6],summary:'Up from 2 to 6; one missing sample'}],row=>row.id),
  renderCell: createChartRenderer({trend:'line'}),
  rowHeight:64,
  permissions:{writable:false},
});
export function dispose(){grid.destroy();}
```

Configured cells contain numeric arrays, limited to 512 points; null, missing and non-finite entries are gaps. Empty series render no marks. Lines break at gaps; one-point/constant lines remain visible. Column/bar domains include zero; mixed signs use a shared zero baseline. Canvas owns DPR and repaint scheduling; the renderer clips to the cell and restores the drawing context. Extreme finite domains and subnormal numbers are supported. No downsampling, tooltip, hit testing, selection linking or large chart widget is included yet.

Keep a readable adjacent summary column for chart meaning, including missing points, extrema and direction. The renderer does not add ARIA nodes; existing grid accessibility exposes raw cell values. Choose a contrasting color for the active theme. `chartGeometry(series,width,height,kind)` exposes immutable normalized points/domain for independent verification or a host renderer.
