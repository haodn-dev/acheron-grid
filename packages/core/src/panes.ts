import type { GridAxis } from './axis.js';

export interface ViewportOptions { width: number; height: number; scrollLeft: number; scrollTop: number; }
export interface ViewportRect { readonly x: number; readonly y: number; readonly width: number; readonly height: number; }
export interface ViewportRegion {
  readonly clip: ViewportRect;
  readonly rows: Readonly<{ start: number; end: number }>;
  readonly columns: Readonly<{ start: number; end: number }>;
  readonly offsetX: number;
  readonly offsetY: number;
}

/** Numeric geometry only. Re-query after scrolling or changing axis sizes. */
export function createViewport(rows: GridAxis, columns: GridAxis, frozenRows: number, frozenColumns: number, options: ViewportOptions) {
  const { width, height } = options;
  for (const value of [width, height, options.scrollLeft, options.scrollTop]) {
    if (!Number.isFinite(value) || value < 0) throw new RangeError('Invalid viewport dimensions or offsets.');
  }
  const scrollLeft = Math.min(options.scrollLeft, Math.max(0, columns.position(columns.count) - width));
  const scrollTop = Math.min(options.scrollTop, Math.max(0, rows.position(rows.count) - height));
  const frozenWidth = Math.min(width, columns.position(frozenColumns));
  const frozenHeight = Math.min(height, rows.position(frozenRows));
  function segments(axis: GridAxis, count: number, extent: number, frozenExtent: number, scroll: number) {
    const fixed = axis.range(0, frozenExtent);
    const moving = axis.range(axis.position(count) + scroll, extent - frozenExtent);
    return [
      { start: 0, end: Math.min(count, fixed.end), position: 0, extent: frozenExtent, offset: 0 },
      { start: Math.max(count, moving.start), end: moving.end, position: frozenExtent, extent: extent - frozenExtent, offset: -scroll },
    ];
  }
  const regions: ViewportRegion[] = [];
  for (const row of segments(rows, frozenRows, height, frozenHeight, scrollTop)) {
    for (const col of segments(columns, frozenColumns, width, frozenWidth, scrollLeft)) {
      if (row.extent <= 0 || col.extent <= 0 || row.start >= row.end || col.start >= col.end) continue;
      regions.push(Object.freeze({
        clip: Object.freeze({ x: col.position, y: row.position, width: col.extent, height: row.extent }),
        rows: Object.freeze({ start: row.start, end: row.end }), columns: Object.freeze({ start: col.start, end: col.end }),
        offsetX: col.offset, offsetY: row.offset,
      }));
    }
  }
  return Object.freeze({ width, height, scrollLeft, scrollTop, frozenWidth, frozenHeight, regions: Object.freeze(regions),
    hitTest(x: number, y: number): { row: number; col: number } | null {
      if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x >= width || y >= height) return null;
      const row = rows.indexAt(y + (y < frozenHeight ? 0 : scrollTop));
      const col = columns.indexAt(x + (x < frozenWidth ? 0 : scrollLeft));
      return row < rows.count && col < columns.count ? { row, col } : null;
    },
    cellRect(row: number, col: number) {
      if (!Number.isSafeInteger(row) || row < 0 || row >= rows.count || !Number.isSafeInteger(col) || col < 0 || col >= columns.count) throw new RangeError('Invalid cell position.');
      const fixedRow = row < frozenRows;
      const fixedColumn = col < frozenColumns;
      return Object.freeze({
        x: columns.position(col) - (fixedColumn ? 0 : scrollLeft), y: rows.position(row) - (fixedRow ? 0 : scrollTop),
        width: columns.size(col), height: rows.size(row),
        clip: Object.freeze({ x: fixedColumn ? 0 : frozenWidth, y: fixedRow ? 0 : frozenHeight,
          width: fixedColumn ? frozenWidth : width - frozenWidth, height: fixedRow ? frozenHeight : height - frozenHeight }),
      });
    },
  });
}

export type ViewportLayout = ReturnType<typeof createViewport>;
