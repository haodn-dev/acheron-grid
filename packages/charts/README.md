# @acheron-grid/charts

Optional free/Apache 2.0 inline line, area, column and horizontal bar renderer. Source preview, not yet published to npm. It depends on Canvas; core does not depend on charts. It allocates no listeners or persistent cache.

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

## Smooth curves and per-column styling

Existing string bindings and the second color argument remain supported. Use an options object for each column to enable smooth curves or area fills:

```ts
const renderCell = createChartRenderer({
  trend: { kind: 'line', curve: 'smooth', color: '#2563eb', lineWidth: 2, markerRadius: 0 },
  volume: { kind: 'area', curve: 'smooth', color: '#059669', fillOpacity: 0.2, showBaseline: true },
  balance: { kind: 'bar', color: '#d44b21', showBaseline: true },
});
```

`curve` defaults to `linear`. Smooth cubic segments share monotone tangents at samples, flatten at local extrema and stay within each pair's value range; they do not invent extrema or bridge missing values. Area fills close each continuous segment independently to zero, and their domain includes zero. Isolated samples are visible through markers; disabling markers hides isolated line samples.

Options: `color` defaults to the renderer color, `lineWidth` to 1.5, `markerRadius` to 1.5 (0 hides markers), `fillOpacity` to 0.18 (0–1), and `showBaseline` to false. Baselines follow chart orientation. For constant line series, samples stay centered while the zero baseline uses the nearest domain edge (or the center for zero). Curves, markers and line width apply to line/area; fill opacity applies to area. Invalid numeric options, chart kinds and curve modes throw during renderer creation. Colors are trusted host CSS Canvas colors; choose accessible contrast for your theme. All settings are captured when the renderer is created; recreate it to change them.

## Comparing inline charts

Use the same `domain: [min, max]` on columns/rows that should be visually comparable. The bounds must be finite and strictly increasing; area, column and bar domains must include zero. Out-of-domain values saturate at the edge; summaries should still report raw values. The domain is never expanded automatically. `chartGeometry(values, width, height, kind, domain)` accepts the same optional bounds.

```ts
const renderCell = createChartRenderer({
  trend: {
    kind: 'area', curve: 'smooth', domain: [0, 100],
    color: '#2563eb', markerRadius: 0,
    threshold: 70, thresholdColor: '#64748b',
    highlight: ['min', 'max', 'last'], highlightColor: '#059669',
  },
});
```

A finite `threshold` draws one dashed reference line across the chart, including gaps, if it is inside the current domain and at least one valid sample exists. It does not change the domain. It follows the value axis for horizontal bars. `thresholdColor` defaults to `#64748b`.

`highlight` defaults to an empty array and applies to line/area charts. Min/max use raw finite values (the first sample wins ties); last means the last finite sample, even with trailing gaps. Overlapping selections draw once. Highlight radius is at least 3 pixels and remains visible when `markerRadius: 0`; `highlightColor` defaults to the renderer's second color argument. Domain and highlight arrays are copied on creation. Keep an adjacent text summary; do not rely on highlight color alone to communicate meaning.

## Live updates

Canvas supplies optional `previousValue` and `animationProgress`. The stateless renderer interpolates normalized points/baseline for all four chart types; appended points start from the previous endpoint, gaps remain gaps. Configure `motion.chartUpdates`, `motion.duration` and `motion.easing` on the grid. Reduced motion applies geometry immediately. Provide readable summaries; animated frames never write intermediate source values.
