export type RowId = string | number;
export interface CellUpdate { rowIndex: number; columnKey: string; value: unknown; }

export interface DataRow { readonly id: RowId; readonly values: Readonly<Record<string, unknown>>; }
export interface RowSplice { readonly index: number; readonly deleteCount: number; readonly rows: readonly DataRow[]; }

export interface DataSource {
  getRowCount(): number;
  /** Full shallow row snapshot, including fields outside the visible columns. */
  getRow?(index: number): DataRow;
  /** Initialize missing fields atomically; existing hidden column values are retained. */
  addColumns?(keys: readonly string[], defaults?: Readonly<Record<string,unknown>>): void;
  /** Apply sequential splices atomically, preserving unique row IDs. */
  spliceRows?(splices: readonly RowSplice[]): void;
  getRowId(index: number): RowId;
  getValue(index: number, columnKey: string): unknown;
  setValue?(index: number, columnKey: string, value: unknown): void;
  /** Synchronous, atomic: either all writes succeed or none do. */
  setValues?(updates: readonly CellUpdate[]): void;
}

/** A shallow snapshot of local rows. Nested values remain caller-owned. */
export class LocalDataSource<T extends Record<string, unknown>> implements DataSource {
  private rows: Readonly<T>[];
  private ids: RowId[];
  private readonly addedColumns=new Set<string>();
  private columnDefaults:Record<string,unknown>={};

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
    const next = new Map<number, T>();
    for (const { rowIndex, columnKey, value } of updates) {
      this.assertIndex(rowIndex);
      if (!Object.hasOwn(this.rows[rowIndex]!, columnKey) && !this.addedColumns.has(columnKey)) throw new Error(`Unknown column: ${columnKey}`);
      let row = next.get(rowIndex);
      if (!row) { row = { ...this.rows[rowIndex]! }; next.set(rowIndex, row); }
      Object.assign(row, { [columnKey]: value });
    }
    for (const [index, row] of next) this.rows[index] = Object.freeze(row);
  }

  addColumns(keys: readonly string[], defaults:Readonly<Record<string,unknown>>={}): void {
    if(keys.some(key=>typeof key!=='string'||!key||['__proto__','constructor','prototype'].includes(key)))throw new TypeError('Invalid added column key.');
    const initial=Object.fromEntries(keys.filter(key=>Object.hasOwn(defaults,key)).map(key=>[key,defaults[key]]));
    const rows=Object.keys(initial).length ? this.rows.map(row=>Object.freeze({...initial,...row}) as Readonly<T>) : this.rows;
    for(const key of keys)this.addedColumns.add(key);
    this.columnDefaults={...this.columnDefaults,...initial};
    this.rows=rows;
  }

  getRow(index: number): DataRow {
    this.assertIndex(index);
    return Object.freeze({ id: this.ids[index]!, values: this.rows[index]! });
  }

  spliceRows(splices: readonly RowSplice[]): void {
    let rows = this.rows.slice(), ids = this.ids.slice();
    for (const splice of splices) {
      if (!Number.isSafeInteger(splice.index) || splice.index < 0 || splice.index > rows.length || !Number.isSafeInteger(splice.deleteCount) || splice.deleteCount < 0 || splice.deleteCount > rows.length - splice.index || !Array.isArray(splice.rows)) throw new RangeError('Invalid row splice.');
      const added = splice.rows.map(row => {
        if (!row || (typeof row.id !== 'string' && typeof row.id !== 'number') || typeof row.id === 'number' && !Number.isFinite(row.id) || !row.values || typeof row.values !== 'object' || Array.isArray(row.values)) throw new TypeError('Invalid inserted row.');
        return Object.freeze({ ...this.columnDefaults, ...row.values }) as Readonly<T>;
      });
      // Slice/concat avoids argument limits when inserting large batches.
      rows=rows.slice(0,splice.index).concat(added,rows.slice(splice.index+splice.deleteCount));
      ids=ids.slice(0,splice.index).concat(splice.rows.map(row=>row.id),ids.slice(splice.index+splice.deleteCount));
    }
    if (new Set(ids).size !== ids.length) throw new Error('Duplicate row ID.');
    this.rows=rows; this.ids=ids;
  }

  private assertIndex(index: number): void {
    if (!Number.isInteger(index) || index < 0 || index >= this.rows.length) {
      throw new RangeError(`Row index out of range: ${index}`);
    }
  }
}


export interface LocalViewOptions {
  readonly sort?: { readonly columnKey: string; readonly direction: 'asc' | 'desc' };
  readonly sorts?: readonly { readonly columnKey: string; readonly direction: 'asc' | 'desc' }[];
  readonly filters?: readonly { readonly columnKey: string; readonly query: string; readonly operator?: 'contains' | 'equals' | 'not-empty' | 'empty' }[];
}

/** Shared immutable criteria for local projections and host-managed server queries. */
export function snapshotLocalView(options: LocalViewOptions): Readonly<LocalViewOptions> {
  if (!options || typeof options !== 'object' || Array.isArray(options)) throw new TypeError('Invalid local view.');
  const filters = options.filters ?? [];
  if (options.filters !== undefined && !Array.isArray(options.filters) || !Array.isArray(filters) || Array.from(filters).some(filter => !filter || typeof filter.columnKey !== 'string' || !filter.columnKey || typeof filter.query !== 'string' || (filter.operator !== undefined && !['contains', 'equals', 'not-empty', 'empty'].includes(filter.operator)))) throw new TypeError('Invalid local filters.');
  const sorts = options.sorts ?? (options.sort ? [options.sort] : []);
  if (options.sort !== undefined && (!options.sort || typeof options.sort !== 'object') || options.sort && options.sorts !== undefined || options.sorts !== undefined && !Array.isArray(options.sorts) || !Array.isArray(sorts) || Array.from(sorts).some(sort => !sort || typeof sort.columnKey !== 'string' || !sort.columnKey || !['asc', 'desc'].includes(sort.direction)) || new Set(sorts.map(sort => sort.columnKey)).size !== sorts.length) throw new TypeError('Invalid local sort.');
  return Object.freeze({
    ...(options.sort ? { sort: Object.freeze({ ...options.sort }) } : {}),
    ...(options.sorts !== undefined ? { sorts: Object.freeze(options.sorts.map(sort => Object.freeze({ ...sort }))) } : {}),
    ...(options.filters !== undefined ? { filters: Object.freeze(options.filters.map(filter => Object.freeze({ ...filter }))) } : {}),
  });
}

/** An immutable local row projection. Build a new view to reapply sorting/filtering after edits. */
export class LocalDataView implements DataSource {
  private readonly indices: number[];
  readonly setValue?: (index: number, key: string, value: unknown) => void;
  readonly setValues?: (updates: readonly CellUpdate[]) => void;

  constructor(private readonly source: DataSource, options: LocalViewOptions = {}) {
    const count = source.getRowCount();
    if (!Number.isSafeInteger(count) || count < 0) throw new RangeError('Invalid local row count.');
    const criteria = snapshotLocalView(options);
    const filters = criteria.filters ?? [];
    const sorts = criteria.sorts ?? (criteria.sort ? [criteria.sort] : []);
    const queries = filters.map(filter => filter.query.toLocaleLowerCase());
    const indices = Array.from({ length: count }, (_, index) => index);
    this.indices = filters.length ? indices.filter(index => filters.every((filter, filterIndex) => {
      const value = source.getValue(index, filter.columnKey);
      const empty = value == null || value === '';
      if (filter.operator === 'empty') return empty;
      if (filter.operator === 'not-empty') return !empty;
      if (filter.query === '') return true;
      if (empty) return false;
      const text = String(value).toLocaleLowerCase(); const query = queries[filterIndex]!;
      return filter.operator === 'equals' ? text === query : text.includes(query);
    })) : indices;
    if (sorts.length) {
      const matched = this.indices;
      const values = sorts.map(sort => matched.map(index => source.getValue(index, sort.columnKey)));
      // Dense match positions avoid hashing in comparisons without allocating for filtered-out rows.
      const positions = matched.map((_, index) => index);
      const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
      positions.sort((a, b) => {
        for (let i = 0; i < sorts.length; i++) {
          const left = values[i]![a], right = values[i]![b];
          if (left == null || right == null) { if (left == null && right == null) continue; return left == null ? 1 : -1; }
          const order = typeof left === 'number' && typeof right === 'number' ? left - right : collator.compare(String(left), String(right));
          if (order) return sorts[i]!.direction === 'asc' ? order : -order;
        }
        return matched[a]! - matched[b]!;
      });
      this.indices = positions.map(index => matched[index]!);
    }
    if (source.setValue) this.setValue = (index, key, value) => source.setValue!(this.sourceIndex(index), key, value);
    if (source.setValues) this.setValues = updates => source.setValues!(updates.map(update => ({ ...update, rowIndex: this.sourceIndex(update.rowIndex) })));
  }
  private sourceIndex(index: number): number {
    if (!Number.isSafeInteger(index) || index < 0 || index >= this.indices.length) throw new RangeError('Invalid view row index.');
    return this.indices[index]!;
  }
  getSourceIndex(index: number): number { return this.sourceIndex(index); }
  getRowCount(): number { return this.indices.length; }
  getRowId(index: number): RowId { return this.source.getRowId(this.sourceIndex(index)); }
  getValue(index: number, columnKey: string): unknown { return this.source.getValue(this.sourceIndex(index), columnKey); }
}
