export type PivotScalar = string | number | boolean | null;

/** Count records or sum finite numeric values for two scalar dimensions. */
export function pivotRows(
  records: readonly Readonly<Record<string, unknown>>[],
  rowKey: string,
  columnKey: string,
  sumKey?: string,
): ReadonlyMap<PivotScalar, ReadonlyMap<PivotScalar, number>> {
  if (records.length > 100_000) throw new RangeError('Pivot accepts at most 100,000 records.');
  const result = new Map<PivotScalar, Map<PivotScalar, number>>();
  function dimension(value: unknown): PivotScalar {
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    throw new TypeError('Invalid pivot dimension.');
  }
  for (const record of records) {
    const row = dimension(Object.hasOwn(record, rowKey) ? record[rowKey] : null);
    const column = dimension(Object.hasOwn(record, columnKey) ? record[columnKey] : null);
    const value = sumKey === undefined ? 1 : Object.hasOwn(record, sumKey) ? record[sumKey] : undefined;
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError('Invalid pivot measure.');
    let cells = result.get(row);
    if (!cells) result.set(row, (cells = new Map()));
    const total = (cells.get(column) ?? 0) + value;
    if (!Number.isFinite(total)) throw new RangeError('Pivot total exceeds numeric range.');
    cells.set(column, total);
  }
  return result;
}
