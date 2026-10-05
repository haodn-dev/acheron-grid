# @acheron-grid/charts

Optional free/MIT inline line, column and horizontal bar renderer. Source preview, not yet published to npm. It depends on Canvas; core does not depend on charts. It allocates no listeners or persistent cache.

```ts
import { createGrid } from '@acheron-grid/canvas';
import { createChartRenderer } from '@acheron-grid/charts';

const grid = createGrid({ ...options,
  renderCell: createChartRenderer({ trend: 'line', volume: 'column', distribution: 'bar' }),
});
```

Configured cells contain numeric arrays, limited to 512 points; null, missing and non-finite entries are gaps. Empty series render no marks. Lines break at gaps; one-point/constant lines remain visible. Column/bar domains include zero; mixed signs use a shared zero baseline. Canvas owns DPR and repaint scheduling; the renderer clips to the cell and restores the drawing context. Extreme finite domains and subnormal numbers are supported. No downsampling, tooltip, hit testing, selection linking or large chart widget is included yet.

Keep a readable adjacent summary column for chart meaning, including missing points, extrema and direction. The renderer does not add ARIA nodes; existing grid accessibility exposes raw cell values. Choose a contrasting color for the active theme. `chartGeometry(series,width,height,kind)` exposes immutable normalized points/domain for independent verification or a host renderer.
