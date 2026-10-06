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
