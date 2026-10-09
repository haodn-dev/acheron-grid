import type { GridEngine } from '@acheron-grid/core';

export function axisCellRect(
  engine: GridEngine,
  view: ReturnType<GridEngine['getViewport']>,
  row: number,
  col: number,
) {
  return {
    x: engine.columnsLayout.position(col) - (col < engine.frozenColumns ? 0 : view.scrollLeft),
    y: engine.rows.position(row) - (row < engine.frozenRows ? 0 : view.scrollTop),
    width: engine.columnsLayout.size(col),
    height: engine.rows.size(row),
  };
}

export function reorderInsertionIndex(
  point: Readonly<{ clientX: number; clientY: number }>,
  bounds: Readonly<{ top: number; left: number; height: number; width: number }>,
  axis: 'row' | 'column',
  first: number,
  last: number,
): number {
  return (
    axis === 'row' ? point.clientY > bounds.top + bounds.height / 2 : point.clientX > bounds.left + bounds.width / 2
  )
    ? last + 1
    : first;
}
