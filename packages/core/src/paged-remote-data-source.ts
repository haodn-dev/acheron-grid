import { createAsyncDataSource } from './async-data-source.js';
import type { AsyncDataSourceOptions } from './async-data-source.js';
import type { CellUpdate, DataRow, LocalViewOptions, RowId } from './data-source.js';
import { LocalDataSource } from './data-source.js';
import { createRemoteDataSource } from './remote-data-source.js';
import type {
  RemoteMutation,
  RemoteSnapshot,
  RemoteWriteResult,
  RemoteMutationCheckpoint,
} from './remote-data-source.js';
import { jsonSnapshot } from './internal/remote-json.js';
import { clipboardCellLimit } from './tsv.js';

export type PagedRemoteWriteResult = RemoteWriteResult & { readonly total: number };
export interface PagedRemoteMutationCheckpoint {
  readonly version: 1;
  readonly query: Readonly<LocalViewOptions>;
  readonly total: number;
  readonly positions: readonly { readonly rowIndex: number; readonly rowId: RowId }[];
  readonly writer: RemoteMutationCheckpoint;
}
export interface PagedRemoteDraftSnapshot {
  readonly version: 1;
  readonly datasetId: string;
  readonly revision: string;
  readonly query: Readonly<LocalViewOptions>;
  readonly columnKeys: readonly string[];
  readonly total: number;
  readonly changes: readonly {
    readonly rowIndex: number;
    readonly rowId: RowId;
    readonly columnKey: string;
    readonly previous: unknown;
    readonly value: unknown;
  }[];
}
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
  readonly persistMutation?: (checkpoint: PagedRemoteMutationCheckpoint) => void | Promise<void>;
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
    maxPendingCells < 1 ||
    (options.persistMutation !== undefined && typeof options.persistMutation !== 'function')
  )
    throw new TypeError('Invalid paged remote options.');
  const identity = Symbol('row identity'),
    unloadedPrefix = '\0acheron-unloaded:';
  let revision: string | null = null,
    generation = 0,
    destroyed = false,
    preparing = false,
    restoring = false;
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
      const draftPositions = new Map([...drafts].map(([index, row]) => [row.id, index]));
      if (
        result.rows.some(
          (row, index) => draftPositions.has(row.id) && draftPositions.get(row.id) !== request.offset + index,
        )
      )
        throw new Error('Draft row identity changed.');
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
    if (preparing || restoring || (writer && writer.status !== 'ready'))
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
    if (!Array.isArray(updates) || updates.length > clipboardCellLimit)
      throw new RangeError('Invalid remote update batch.');
    const captured = updates.map((update) => ({ ...update }));
    jsonSnapshot(captured);
    const staged = new Map(drafts);
    const draftIndices = new Map([...staged].map(([index, row]) => [row.id, index]));
    for (const update of captured) {
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
  function mutationCheckpoint(checkpoint: RemoteMutationCheckpoint): PagedRemoteMutationCheckpoint {
    return jsonSnapshot({
      version: 1,
      query: cache.query,
      total: cache.getRowCount(),
      positions: [...drafts].map(([rowIndex, row]) => ({ rowIndex, rowId: row.id })),
      writer: checkpoint,
    });
  }
  function createWriter(snapshot: RemoteSnapshot) {
    return createRemoteDataSource({
      datasetId: options.datasetId,
      columnKeys: keys,
      maxRows: maxPendingCells,
      maxPendingCells,
      createAbortController: options.createAbortController,
      createMutationId: options.createMutationId,
      load: async () => snapshot,
      ...(options.persistMutation
        ? {
            persistMutation: (checkpoint: RemoteMutationCheckpoint) =>
              options.persistMutation!(mutationCheckpoint(checkpoint)),
          }
        : {}),
      write: async (mutation, signal) => {
        const result = jsonSnapshot(await options.write(mutation, signal, cache.query));
        if (!result || !Number.isSafeInteger(result.total) || result.total < 0)
          throw new TypeError('Invalid remote total.');
        receiptTotal = result.total;
        return result;
      },
    });
  }
  function exportMutation(): PagedRemoteMutationCheckpoint {
    alive();
    if (!writer) throw new Error('No uncertain paged mutation to export.');
    return mutationCheckpoint(writer.exportMutation());
  }
  function restoreMutation(input: unknown): void {
    idle();
    if (revision !== null || writer || drafts.size) throw new Error('Restore a mutation into a new paged source.');
    const checkpoint = jsonSnapshot(input) as Partial<PagedRemoteMutationCheckpoint> | null;
    if (
      !checkpoint ||
      typeof checkpoint !== 'object' ||
      Array.isArray(checkpoint) ||
      checkpoint.version !== 1 ||
      JSON.stringify(checkpoint.query) !== JSON.stringify(cache.query) ||
      !Number.isSafeInteger(checkpoint.total) ||
      checkpoint.total! < 0 ||
      !Array.isArray(checkpoint.positions) ||
      !checkpoint.positions.length ||
      checkpoint.positions.length > maxPendingCells ||
      !checkpoint.writer
    )
      throw new TypeError('Invalid paged mutation checkpoint.');
    const positions = new Map<RowId, number>(),
      indices = new Set<number>();
    for (const position of checkpoint.positions) {
      if (
        !position ||
        !Number.isSafeInteger(position.rowIndex) ||
        position.rowIndex < 0 ||
        position.rowIndex >= checkpoint.total! ||
        !(
          (typeof position.rowId === 'string' && !position.rowId.startsWith(unloadedPrefix)) ||
          (typeof position.rowId === 'number' && Number.isFinite(position.rowId))
        ) ||
        positions.has(position.rowId) ||
        indices.has(position.rowIndex)
      )
        throw new TypeError('Invalid checkpoint positions.');
      positions.set(position.rowId, position.rowIndex);
      indices.add(position.rowIndex);
    }
    const restored = createWriter(checkpoint.writer.snapshot);
    try {
      restored.restoreMutation(checkpoint.writer);
      const edits = new Map<RowId, Map<string, unknown>>();
      for (const change of restored.getPendingChanges()) {
        if (!edits.has(change.rowId)) edits.set(change.rowId, new Map());
        edits.get(change.rowId)!.set(change.columnKey, change.value);
      }
      if (restored.getRowCount() !== positions.size || edits.size !== positions.size)
        throw new TypeError('Incomplete checkpoint cohort.');
      const staged = new Map<number, Draft>();
      for (const row of checkpoint.writer.snapshot.rows) {
        if (!positions.has(row.id) || !edits.has(row.id)) throw new TypeError('Checkpoint row identity mismatch.');
        staged.set(positions.get(row.id)!, {
          id: row.id,
          values: Object.freeze(Object.fromEntries(keys.map((key) => [key, row.values[key]]))),
          edits: edits.get(row.id)!,
        });
      }
      preparing = true;
      try {
        invalidate(checkpoint.total!);
        alive();
        revision = restored.revision;
        authoritativeTotal = checkpoint.total!;
        drafts = staged;
        writer = restored;
      } finally {
        preparing = false;
      }
    } catch (error) {
      restored.destroy();
      throw error;
    }
  }
  async function commit(): Promise<void> {
    alive();
    if (preparing || restoring) throw new Error('Remote operation is already running.');
    if (!drafts.size) return;
    preparing = true;
    cache.cancel();
    generation++;
    const token = generation;
    try {
      if (!writer) {
        if (revision === null) throw new Error('Load a page before committing.');
        const captured = jsonSnapshot(
          [...drafts.values()].map((row) => ({ id: row.id, values: row.values, edits: [...row.edits] })),
        );
        const rows: DataRow[] = captured.map((row) => ({ id: row.id, values: row.values }));
        const snapshot = { datasetId: options.datasetId, revision, rows };
        writer = createWriter(snapshot);
        await writer.resync();
        if (token !== generation || destroyed) return;
        writer.setValues(
          captured.flatMap((row, rowIndex) => row.edits.map(([columnKey, value]) => ({ rowIndex, columnKey, value }))),
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
  function exportDrafts(): PagedRemoteDraftSnapshot {
    idle();
    if (revision === null) throw new Error('Load a page before exporting drafts.');
    return jsonSnapshot({
      version: 1,
      datasetId: options.datasetId,
      revision,
      query: cache.query,
      columnKeys: keys,
      total: cache.getRowCount(),
      changes: [...drafts].flatMap(([rowIndex, row]) =>
        [...row.edits].map(([columnKey, value]) => ({
          rowIndex,
          rowId: row.id,
          columnKey,
          previous: row.values[columnKey],
          value,
        })),
      ),
    });
  }
  async function restoreDrafts(input: unknown): Promise<void> {
    idle();
    if (drafts.size || writer) throw new Error('Restore drafts into an empty source.');
    const snapshot = jsonSnapshot(input) as Partial<PagedRemoteDraftSnapshot> | null;
    if (
      !snapshot ||
      typeof snapshot !== 'object' ||
      Array.isArray(snapshot) ||
      snapshot.version !== 1 ||
      snapshot.datasetId !== options.datasetId ||
      typeof snapshot.revision !== 'string' ||
      !snapshot.revision ||
      JSON.stringify(snapshot.columnKeys) !== JSON.stringify(keys) ||
      JSON.stringify(snapshot.query) !== JSON.stringify(cache.query) ||
      !Number.isSafeInteger(snapshot.total) ||
      snapshot.total! < 0 ||
      !Array.isArray(snapshot.changes) ||
      snapshot.changes.length > maxPendingCells
    )
      throw new TypeError('Invalid or incompatible draft checkpoint.');
    const seen = new Set<string>();
    for (const change of snapshot.changes) {
      if (
        !change ||
        typeof change !== 'object' ||
        !Number.isSafeInteger(change.rowIndex) ||
        change.rowIndex < 0 ||
        change.rowIndex >= snapshot.total! ||
        !keys.includes(change.columnKey) ||
        !Object.hasOwn(change, 'previous') ||
        !Object.hasOwn(change, 'value') ||
        !(
          (typeof change.rowId === 'string' && !change.rowId.startsWith(unloadedPrefix)) ||
          (typeof change.rowId === 'number' && Number.isFinite(change.rowId))
        )
      )
        throw new TypeError('Invalid draft checkpoint change.');
      const key = JSON.stringify([change.rowIndex, change.columnKey]);
      if (seen.has(key)) throw new TypeError('Duplicate draft checkpoint cell.');
      seen.add(key);
    }
    const staged = new Map<number, Draft>();
    const indices = new Map<RowId, number>();
    const token = generation;
    restoring = true;
    try {
      const changes = [...snapshot.changes].sort((a, b) => a.rowIndex - b.rowIndex);
      let page = -1;
      for (const change of changes) {
        const offset = Math.floor(change.rowIndex / cache.pageSize) * cache.pageSize;
        if (offset !== page) {
          await cache.loadPage(offset);
          page = offset;
        }
        if (destroyed || token !== generation) throw new Error('Draft restoration canceled.');
        if (
          revision !== snapshot.revision ||
          cache.getRowCount() !== snapshot.total ||
          cache.getRowId(change.rowIndex) !== change.rowId ||
          JSON.stringify(cache.getValue(change.rowIndex, change.columnKey)) !== JSON.stringify(change.previous)
        )
          throw new Error('Draft checkpoint no longer matches the server.');
        if (indices.has(change.rowId) && indices.get(change.rowId) !== change.rowIndex)
          throw new TypeError('Duplicate draft row ID.');
        const prior = staged.get(change.rowIndex);
        const values =
          prior?.values ??
          Object.freeze(Object.fromEntries(keys.map((key) => [key, cache.getValue(change.rowIndex, key)])));
        const edits = new Map(prior?.edits);
        edits.set(change.columnKey, change.value);
        staged.set(change.rowIndex, { id: change.rowId, values, edits });
        indices.set(change.rowId, change.rowIndex);
      }
      drafts = staged;
    } finally {
      restoring = false;
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
      return destroyed ? 'destroyed' : restoring ? 'loading' : preparing ? 'committing' : (writer?.status ?? 'ready');
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
    exportDrafts,
    restoreDrafts,
    exportMutation,
    restoreMutation,
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
