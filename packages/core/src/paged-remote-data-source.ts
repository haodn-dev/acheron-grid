import { createAsyncDataSource } from './async-data-source.js';
import type { AsyncDataSourceOptions } from './async-data-source.js';
import type { CellUpdate, DataRow, LocalViewOptions, RowId } from './data-source.js';
import { LocalDataSource } from './data-source.js';
import { createRemoteDataSource } from './remote-data-source.js';
import type { RemoteMutation, RemoteSnapshot, RemoteWriteResult } from './remote-data-source.js';
import { jsonSnapshot } from './internal/remote-json.js';

export type PagedRemoteWriteResult = RemoteWriteResult & { readonly total: number };
export interface PagedRemoteDataSourceOptions<S> extends Pick<
  AsyncDataSourceOptions<S>,
  'rowCount' | 'pageSize' | 'maxPages' | 'maxConcurrentLoads' | 'maxPendingLoads' | 'query' | 'createAbortController'
> {
  readonly datasetId: string;
  readonly columnKeys: readonly string[];
  readonly maxPendingCells?: number;
  readonly createMutationId: () => string;
  readonly load: (request: {
    readonly offset: number;
    readonly limit: number;
    readonly signal: S;
    readonly query: Readonly<LocalViewOptions>;
    readonly expectedRevision: string | null;
  }) => Promise<RemoteSnapshot & { readonly total: number }>;
  /** Receipts contain only the dirty-row cohort. Every accepted write invalidates the page cache. */
  readonly write: (
    mutation: RemoteMutation,
    signal: S,
    query: Readonly<LocalViewOptions>,
  ) => Promise<PagedRemoteWriteResult>;
}

/** Bounded page cache plus stable-ID drafts. Server owns global query ordering and write authority. */
export function createPagedRemoteDataSource<S>(options: PagedRemoteDataSourceOptions<S>) {
  const keys = [...options.columnKeys],
    maxPendingCells = options.maxPendingCells ?? 1000;
  if (
    !options.datasetId ||
    typeof options.datasetId !== 'string' ||
    !keys.length ||
    new Set(keys).size !== keys.length ||
    keys.some((key) => typeof key !== 'string' || !key) ||
    !Number.isSafeInteger(maxPendingCells) ||
    maxPendingCells < 1
  )
    throw new TypeError('Invalid paged remote options.');
  const identity = Symbol('row identity'),
    unloadedPrefix = '\0acheron-unloaded:';
  let revision: string | null = null,
    generation = 0,
    destroyed = false,
    preparing = false;
  let writer: ReturnType<typeof createRemoteDataSource<S>> | undefined;
  let receiptTotal: number | undefined;
  let authoritativeTotal: number | null = null;
  type Draft = {
    readonly id: RowId;
    readonly values: Readonly<Record<string, unknown>>;
    readonly edits: ReadonlyMap<string, unknown>;
  };
  let drafts = new Map<number, Draft>();
  const identities = new Map<number, readonly RowId[]>();
  const cache = createAsyncDataSource<S>({
    ...options,
    getRowId: (index, row) =>
      (row as { [identity]?: RowId } | undefined)?.[identity] ?? `${unloadedPrefix}${generation}:${index}`,
    load: async (request) => {
      const token = generation;
      const result = jsonSnapshot(await options.load({ ...request, expectedRevision: revision }));
      if (token !== generation || destroyed) throw new Error('Page generation changed.');
      if (
        !result ||
        result.datasetId !== options.datasetId ||
        typeof result.revision !== 'string' ||
        !result.revision ||
        (revision !== null && revision !== result.revision) ||
        !Number.isSafeInteger(result.total) ||
        result.total < 0 ||
        (authoritativeTotal !== null && authoritativeTotal !== result.total) ||
        !Array.isArray(result.rows) ||
        result.rows.length !== Math.max(0, Math.min(request.limit, result.total - request.offset))
      )
        throw new TypeError('Invalid or stale remote page.');
      const rows = result.rows.map((row) => {
        if (
          !row ||
          !row.values ||
          typeof row.values !== 'object' ||
          Array.isArray(row.values) ||
          keys.some((key) => !Object.hasOwn(row.values, key)) ||
          (typeof row.id === 'string' && row.id.startsWith(unloadedPrefix))
        )
          throw new TypeError('Invalid remote page row.');
        return Object.freeze({ ...Object.fromEntries(keys.map((key) => [key, row.values[key]])), [identity]: row.id });
      });
      new LocalDataSource(rows, (row) => row[identity]);
      for (const offset of identities.keys()) if (cache.getPageState(offset) === null) identities.delete(offset);
      const existing = new Set(
        [...identities].filter(([offset]) => offset !== request.offset).flatMap(([, ids]) => ids),
      );
      if (result.rows.some((row) => existing.has(row.id))) throw new TypeError('Duplicate cached row ID.');
      for (const [index, draft] of drafts) {
        if (
          index >= request.offset &&
          index < request.offset + rows.length &&
          rows[index - request.offset]![identity] !== draft.id
        )
          throw new Error('Draft row identity changed.');
      }
      revision = result.revision;
      authoritativeTotal = result.total;
      identities.set(
        request.offset,
        result.rows.map((row) => row.id),
      );
      return { rows, total: result.total };
    },
  });
  function alive(): void {
    if (destroyed) throw new Error('Paged remote source is destroyed.');
  }
  function idle(): void {
    alive();
    if (preparing || (writer && writer.status !== 'ready'))
      throw new Error('Resolve the pending remote operation first.');
  }
  function pendingCount(staged = drafts): number {
    return [...staged.values()].reduce((sum, row) => sum + row.edits.size, 0);
  }
  function invalidate(total: number): void {
    generation++;
    identities.clear();
    cache.reset(total);
  }
  function setValues(updates: readonly CellUpdate[]): void {
    idle();
    const staged = new Map(drafts);
    const draftIndices = new Map([...staged].map(([index, row]) => [row.id, index]));
    for (const update of jsonSnapshot(updates)) {
      const cachedId = cache.getRowId(update.rowIndex),
        prior = staged.get(update.rowIndex);
      if (!keys.includes(update.columnKey) || !Object.hasOwn(update, 'value'))
        throw new TypeError('Invalid paged update.');
      if (!prior && typeof cachedId === 'string' && cachedId.startsWith(unloadedPrefix))
        throw new Error('Load the row before editing.');
      const id = prior?.id ?? cachedId;
      if (draftIndices.has(id) && draftIndices.get(id) !== update.rowIndex) throw new Error('Duplicate draft row ID.');
      const values =
        prior?.values ??
        Object.freeze(Object.fromEntries(keys.map((key) => [key, cache.getValue(update.rowIndex, key)])));
      const edits = new Map(prior?.edits);
      if (Object.is(values[update.columnKey], update.value)) edits.delete(update.columnKey);
      else edits.set(update.columnKey, update.value);
      if (edits.size) {
        staged.set(update.rowIndex, { id, values, edits });
        draftIndices.set(id, update.rowIndex);
      } else {
        staged.delete(update.rowIndex);
        draftIndices.delete(id);
      }
    }
    if (pendingCount(staged) > maxPendingCells) throw new RangeError('Remote pending cell limit reached.');
    writer?.destroy();
    writer = undefined;
    drafts = staged;
  }
  async function commit(): Promise<void> {
    alive();
    if (preparing) throw new Error('Remote operation is already running.');
    if (!drafts.size) return;
    preparing = true;
    cache.cancel();
    generation++;
    const token = generation;
    try {
      if (!writer) {
        if (revision === null) throw new Error('Load a page before committing.');
        const rows: DataRow[] = [...drafts.values()].map((row) => ({ id: row.id, values: row.values }));
        const snapshot = { datasetId: options.datasetId, revision, rows };
        writer = createRemoteDataSource({
          datasetId: options.datasetId,
          columnKeys: keys,
          maxRows: maxPendingCells,
          maxPendingCells,
          createAbortController: options.createAbortController,
          createMutationId: options.createMutationId,
          load: async () => snapshot,
          write: async (mutation, signal) => {
            const result = jsonSnapshot(await options.write(mutation, signal, cache.query));
            if (!result || !Number.isSafeInteger(result.total) || result.total < 0)
              throw new TypeError('Invalid remote total.');
            receiptTotal = result.total;
            return result;
          },
        });
        await writer.resync();
        if (token !== generation || destroyed) return;
        writer.setValues(
          [...drafts.values()].flatMap((row, rowIndex) =>
            [...row.edits].map(([columnKey, value]) => ({ rowIndex, columnKey, value })),
          ),
        );
      }
      await writer.commit();
      if (token !== generation || destroyed) return;
      if (!writer.pendingCellCount) {
        revision = writer.revision;
        authoritativeTotal = receiptTotal!;
        drafts.clear();
        invalidate(receiptTotal!);
        writer.destroy();
        writer = undefined;
      }
    } finally {
      preparing = false;
    }
  }
  function resetQuery(next?: LocalViewOptions, total = 0): void {
    idle();
    if (drafts.size) throw new Error('Resolve or discard drafts before changing the query.');
    if (next) cache.setQuery(next, total);
    else cache.reset(total);
    generation++;
    identities.clear();
    revision = null;
    authoritativeTotal = null;
  }
  return Object.freeze({
    ...cache,
    get query() {
      return cache.query;
    },
    get revision() {
      return revision;
    },
    get status() {
      return destroyed ? 'destroyed' : preparing ? 'committing' : (writer?.status ?? 'ready');
    },
    get lastError() {
      return writer?.lastError;
    },
    get conflict() {
      return writer?.conflict ?? null;
    },
    get pendingCellCount() {
      return pendingCount();
    },
    getRowId: (index: number) => {
      cache.getRowId(index);
      return drafts.get(index)?.id ?? cache.getRowId(index);
    },
    getValue: (index: number, key: string) => {
      const cached = cache.getValue(index, key),
        draft = drafts.get(index);
      return draft ? (draft.edits.has(key) ? draft.edits.get(key) : draft.values[key]) : cached;
    },
    setValues,
    setValue: (rowIndex: number, columnKey: string, value: unknown) => setValues([{ rowIndex, columnKey, value }]),
    commit,
    getPendingChanges: () =>
      Object.freeze(
        [...drafts.values()].flatMap((row) =>
          [...row.edits].map(([columnKey, value]) =>
            Object.freeze({ rowId: row.id, columnKey, previous: row.values[columnKey], value }),
          ),
        ),
      ),
    setQuery: (next: LocalViewOptions, total = 0) => resetQuery(next, total),
    reset: (total = 0) => resetQuery(undefined, total),
    cancel: () => {
      alive();
      if (!preparing) generation++;
      cache.cancel();
    },
    discardPending: () => {
      idle();
      drafts.clear();
      writer?.destroy();
      writer = undefined;
      invalidate(cache.getRowCount());
    },
    acceptServer: () => {
      alive();
      if (!writer || writer.status !== 'conflict' || preparing) throw new Error('No remote conflict to resolve.');
      writer.acceptServer();
      revision = writer.revision;
      authoritativeTotal = receiptTotal!;
      drafts.clear();
      invalidate(receiptTotal!);
      writer.destroy();
      writer = undefined;
    },
    destroy: () => {
      if (destroyed) return;
      destroyed = true;
      generation++;
      writer?.destroy();
      cache.destroy();
      drafts.clear();
      identities.clear();
    },
  });
}
