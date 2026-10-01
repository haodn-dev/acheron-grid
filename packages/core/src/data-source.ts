export type RowId = string | number;
export interface CellUpdate { rowIndex: number; columnKey: string; value: unknown; }

export interface DataSource {
  getRowCount(): number;
  getRowId(index: number): RowId;
  getValue(index: number, columnKey: string): unknown;
  setValue?(index: number, columnKey: string, value: unknown): void;
  /** Synchronous, atomic: either all writes succeed or none do. */
  setValues?(updates: readonly CellUpdate[]): void;
}

/** A shallow snapshot of local rows. Nested values remain caller-owned. */
export class LocalDataSource<T extends Record<string, unknown>> implements DataSource {
  private readonly rows: Readonly<T>[];
  private readonly ids: RowId[];

  constructor(rows: readonly T[], getRowId: (row: T, index: number) => RowId) {
    this.rows = rows.map(row => Object.freeze({ ...row }));
    this.ids = this.rows.map((row, index) => getRowId(row as T, index));
    const seen = new Set<RowId>();
    for (const id of this.ids) {
      if ((typeof id !== 'string' && typeof id !== 'number') || (typeof id === 'number' && !Number.isFinite(id))) {
        throw new TypeError('Row IDs must be strings or finite numbers.');
      }
      if (seen.has(id)) throw new Error(`Duplicate row ID: ${id}`);
      seen.add(id);
    }
  }

  getRowCount(): number { return this.rows.length; }

  getRowId(index: number): RowId {
    this.assertIndex(index);
    return this.ids[index]!;
  }

  getValue(index: number, columnKey: string): unknown {
    this.assertIndex(index);
    const row = this.rows[index]!;
    return Object.hasOwn(row, columnKey) ? row[columnKey] : undefined;
  }

  /** Replace one snapshot value; row identity remains fixed at construction. */
  setValue(index: number, columnKey: string, value: unknown): void {
    this.setValues([{ rowIndex: index, columnKey, value }]);
  }

  setValues(updates: readonly CellUpdate[]): void {
    const next = new Map<number, Readonly<T>>();
    for (const { rowIndex, columnKey, value } of updates) {
      this.assertIndex(rowIndex);
      if (!Object.hasOwn(this.rows[rowIndex]!, columnKey)) throw new Error(`Unknown column: ${columnKey}`);
      next.set(rowIndex, Object.freeze({ ...(next.get(rowIndex) ?? this.rows[rowIndex]!), [columnKey]: value }));
    }
    for (const [index, row] of next) this.rows[index] = row;
  }

  private assertIndex(index: number): void {
    if (!Number.isInteger(index) || index < 0 || index >= this.rows.length) {
      throw new RangeError(`Row index out of range: ${index}`);
    }
  }
}
