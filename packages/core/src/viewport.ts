/** Exclusive end index; fixed-size cells with no overscan. */
export function visibleRange(
  count: number,
  size: number,
  offset: number,
  extent: number,
): { start: number; end: number } {
  if (
    !Number.isSafeInteger(count) ||
    count < 0 ||
    !Number.isFinite(size) ||
    size <= 0 ||
    !Number.isFinite(offset) ||
    !Number.isFinite(extent)
  ) {
    throw new RangeError('Invalid viewport dimensions.');
  }
  const start = Math.min(count, Math.floor(Math.max(0, offset) / size));
  const end = extent <= 0 ? start : Math.min(count, Math.ceil((Math.max(0, offset) + extent) / size));
  return { start, end };
}
