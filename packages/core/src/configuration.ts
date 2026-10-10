import type { Column } from './types.js';
import type { LocalViewOptions } from './data-source.js';

export interface GridConfiguration {
  readonly version: 1;
  readonly columns: readonly { readonly key: string; readonly width: number }[];
  readonly frozenRows: number;
  readonly frozenColumns: number;
  readonly view: LocalViewOptions;
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new TypeError('Invalid grid configuration object.');
  return value as Record<string, unknown>;
}

/** Validate untrusted JSON and reuse application-owned column definitions. */
export function restoreGridConfiguration(input: unknown, columns: readonly Column[], rowCount: number) {
  const state = record(input);
  if (state.version !== 1) throw new TypeError('Unsupported grid configuration version.');
  if (!Number.isSafeInteger(rowCount) || rowCount < 0) throw new RangeError('Invalid row count.');
  const definitions = new Map(columns.map((column) => [column.key, column]));
  if (definitions.size !== columns.length) throw new TypeError('Column keys must be unique.');
  if (!Array.isArray(state.columns) || state.columns.length !== columns.length)
    throw new TypeError('Configuration must contain all current columns.');
  const seen = new Set<string>();
  const widths: [string, number][] = [];
  const ordered = Array.from(state.columns, (value: unknown) => {
    const entry = record(value);
    if (typeof entry.key !== 'string' || !definitions.has(entry.key) || seen.has(entry.key))
      throw new TypeError('Unknown or duplicate configuration column.');
    if (typeof entry.width !== 'number' || !Number.isFinite(entry.width) || entry.width <= 0)
      throw new RangeError('Invalid configuration column width.');
    seen.add(entry.key);
    widths.push([entry.key, entry.width]);
    return definitions.get(entry.key)!;
  });
  function count(value: unknown, limit: number): number {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > limit)
      throw new RangeError('Invalid configuration frozen count.');
    return value;
  }
  function key(value: unknown): string {
    if (typeof value !== 'string' || !definitions.has(value)) throw new TypeError('Unknown configuration view column.');
    return value;
  }
  const savedView = record(state.view);
  let view: LocalViewOptions = {};
  if (savedView.sort !== undefined) {
    const sort = record(savedView.sort);
    if (sort.direction !== 'asc' && sort.direction !== 'desc')
      throw new TypeError('Invalid configuration sort direction.');
    view = { sort: { columnKey: key(sort.columnKey), direction: sort.direction } };
  }
  if (savedView.sorts !== undefined) {
    if (savedView.sort !== undefined || !Array.isArray(savedView.sorts))
      throw new TypeError('Invalid configuration sorts.');
    const sorts: NonNullable<LocalViewOptions['sorts']> = Array.from(savedView.sorts, (value: unknown) => {
      const sort = record(value);
      if (sort.direction !== 'asc' && sort.direction !== 'desc')
        throw new TypeError('Invalid configuration sort direction.');
      return { columnKey: key(sort.columnKey), direction: sort.direction };
    });
    if (new Set(sorts.map((sort) => sort.columnKey)).size !== sorts.length)
      throw new TypeError('Duplicate configuration sort column.');
    view = { sorts };
  }
  if (savedView.filters !== undefined) {
    if (!Array.isArray(savedView.filters)) throw new TypeError('Invalid configuration filters.');
    view = {
      ...view,
      filters: Array.from(savedView.filters, (value: unknown) => {
        const filter = record(value);
        if (typeof filter.query !== 'string') throw new TypeError('Invalid configuration filter query.');
        const operator = filter.operator;
        if (
          operator !== undefined &&
          operator !== 'contains' &&
          operator !== 'equals' &&
          operator !== 'not-empty' &&
          operator !== 'empty'
        )
          throw new TypeError('Invalid configuration filter operator.');
        return {
          columnKey: key(filter.columnKey),
          query: filter.query,
          ...(operator !== undefined ? { operator } : {}),
        };
      }),
    };
  }
  return {
    columns: ordered,
    columnWidths: Object.fromEntries(widths),
    frozenRows: count(state.frozenRows, rowCount),
    frozenColumns: count(state.frozenColumns, columns.length),
    view,
  };
}
