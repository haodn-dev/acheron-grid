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


export interface LocalViewOptions {
  readonly sort?: { readonly columnKey: string; readonly direction: 'asc' | 'desc' };
  readonly filters?: readonly { readonly columnKey: string; readonly query: string; readonly operator?: 'contains' | 'equals' | 'not-empty' | 'empty' }[];
}

/** An immutable local row projection. Build a new view to reapply sorting/filtering after edits. */
export class LocalDataView implements DataSource {
  private readonly indices: number[];
  readonly setValue?: (index: number, key: string, value: unknown) => void;
  readonly setValues?: (updates: readonly CellUpdate[]) => void;

  constructor(private readonly source: DataSource, options: LocalViewOptions = {}) {
    const count = source.getRowCount();
    if (!Number.isSafeInteger(count) || count < 0) throw new RangeError('Invalid local row count.');
    const filters = options.filters ?? [];
    if (!Array.isArray(filters) || filters.some(filter => !filter || typeof filter.columnKey !== 'string' || !filter.columnKey || typeof filter.query !== 'string' || (filter.operator !== undefined && !['contains', 'equals', 'not-empty', 'empty'].includes(filter.operator)))) throw new TypeError('Invalid local filters.');
    const sort = options.sort;
    if (sort && (typeof sort.columnKey !== 'string' || !sort.columnKey || !['asc', 'desc'].includes(sort.direction))) throw new TypeError('Invalid local sort.');
    this.indices = Array.from({ length: count }, (_, index) => index).filter(index => filters.every(filter => {
      const value = source.getValue(index, filter.columnKey);
      const empty = value == null || value === '';
      if (filter.operator === 'empty') return empty;
      if (filter.operator === 'not-empty') return !empty;
      if (filter.query === '') return true;
      if (empty) return false;
      const text = String(value).toLocaleLowerCase(); const query = filter.query.toLocaleLowerCase();
      return filter.operator === 'equals' ? text === query : text.includes(query);
    }));
    if (sort) {
      const values = new Map(this.indices.map(index => [index, source.getValue(index, sort.columnKey)]));
      const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
      this.indices.sort((a, b) => {
        const left = values.get(a); const right = values.get(b);
        if (left == null || right == null) return left == null ? (right == null ? a - b : 1) : -1;
        const order = typeof left === 'number' && typeof right === 'number' ? left - right : collator.compare(String(left), String(right));
        return (sort.direction === 'asc' ? order : -order) || a - b;
      });
    }
    if (source.setValue) this.setValue = (index, key, value) => source.setValue!(this.sourceIndex(index), key, value);
    if (source.setValues) this.setValues = updates => source.setValues!(updates.map(update => ({ ...update, rowIndex: this.sourceIndex(update.rowIndex) })));
  }
  private sourceIndex(index: number): number {
    if (!Number.isSafeInteger(index) || index < 0 || index >= this.indices.length) throw new RangeError('Invalid view row index.');
    return this.indices[index]!;
  }
  getRowCount(): number { return this.indices.length; }
  getRowId(index: number): RowId { return this.source.getRowId(this.sourceIndex(index)); }
  getValue(index: number, columnKey: string): unknown { return this.source.getValue(this.sourceIndex(index), columnKey); }
}
