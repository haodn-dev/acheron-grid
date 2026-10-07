import { LocalDataSource } from './data-source.js';
import type { CellUpdate, DataRow, RowId } from './data-source.js';
import { clipboardCellLimit, clipboardTextLimit } from './tsv.js';

export interface RemoteSnapshot {
  readonly datasetId: string;
  readonly revision: string;
  readonly rows: readonly DataRow[];
}
export interface RemoteChange {
  readonly rowId: RowId;
  readonly columnKey: string;
  readonly previous: unknown;
  readonly value: unknown;
}
export interface RemoteMutation {
  readonly datasetId: string;
  readonly mutationId: string;
  readonly expectedRevision: string;
  readonly changes: readonly RemoteChange[];
}
export interface RemoteDelta {
  readonly datasetId: string;
  readonly baseRevision: string;
  readonly revision: string;
  /** Canonical values for every submitted cell and any server-side effects; row order is unchanged. */
  readonly cells: readonly { readonly rowId: RowId; readonly columnKey: string; readonly value: unknown }[];
}
export type RemoteWriteResult =
  | { readonly mutationId: string; readonly status: 'accepted' | 'conflict'; readonly snapshot: RemoteSnapshot }
  | { readonly mutationId: string; readonly status: 'accepted'; readonly delta: RemoteDelta }
  | { readonly datasetId: string; readonly mutationId: string; readonly status: 'rejected'; readonly message: string };
export type RemoteStatus = 'disconnected' | 'loading' | 'ready' | 'committing' | 'conflict' | 'destroyed';
export interface RemoteDataSourceOptions<S> {
  readonly datasetId: string;
  readonly columnKeys: readonly string[];
  readonly maxRows?: number;
  readonly maxPendingCells?: number;
  readonly createAbortController: () => { readonly signal: S; abort(): void };
  /** Unique for the lifetime of the server's idempotency records. */
  readonly createMutationId: () => string;
  readonly load: (signal: S) => Promise<RemoteSnapshot>;
  /** Server must check the revision and apply the complete batch atomically, deduplicated by mutationId. */
  readonly write: (mutation: RemoteMutation, signal: S) => Promise<RemoteWriteResult>;
}

/** Bounded optimistic snapshot cache. Engine validation/history stay synchronous; transport stays host-owned. */
export function createRemoteDataSource<S>(options: RemoteDataSourceOptions<S>) {
  const maxRows = options.maxRows ?? 10_000,
    maxPendingCells = options.maxPendingCells ?? 10_000;
  const keys = new Set(options.columnKeys);
  if (
    typeof options.datasetId !== 'string' ||
    !options.datasetId ||
    !Array.isArray(options.columnKeys) ||
    !keys.size ||
    keys.size !== options.columnKeys.length ||
    [...keys].some((key) => typeof key !== 'string' || !key) ||
    ![maxRows, maxPendingCells].every((n) => Number.isSafeInteger(n) && n > 0)
  )
    throw new TypeError('Invalid remote source options.');
  let source = new LocalDataSource<Record<string, unknown>>([], (_, i) => i);
  let rowIndices = new Map<RowId, number>();
  let status: RemoteStatus = 'disconnected',
    revision: string | null = null,
    generation = 0;
  let controller: ReturnType<typeof options.createAbortController> | undefined;
  let active: Promise<void> | undefined, request: RemoteMutation | undefined, conflict: RemoteSnapshot | undefined;
  let pending = new Map<string, RemoteChange>();
  let lastError: unknown;
  const listeners = new Set<(status: RemoteStatus) => void>(),
    errors: unknown[] = [];
  function jsonSnapshot<T>(value: T): T {
    const text = JSON.stringify(value, (_, item: unknown) => {
      if (
        item === undefined ||
        typeof item === 'function' ||
        typeof item === 'symbol' ||
        typeof item === 'bigint' ||
        (typeof item === 'number' && !Number.isFinite(item))
      )
        throw new TypeError('Remote values must be JSON-serializable and finite.');
      return item;
    });
    if (text.length > clipboardTextLimit) throw new RangeError('Remote payload is too large.');
    const copy: unknown = JSON.parse(text);
    function freeze(item: unknown, depth: number): void {
      if (depth > 64) throw new RangeError('Remote payload is too deeply nested.');
      if (item && typeof item === 'object') {
        for (const child of Object.values(item)) freeze(child, depth + 1);
        Object.freeze(item);
      }
    }
    freeze(copy, 0);
    return copy as T;
  }
  function alive(): void {
    if (status === 'destroyed') throw new Error('Remote source is destroyed.');
  }
  function emit(next: RemoteStatus): void {
    status = next;
    for (const listener of [...listeners])
      try {
        listener(next);
      } catch (error) {
        errors.push(error);
        if (errors.length > 10) errors.shift();
      }
  }
  function readSnapshot(snapshot: RemoteSnapshot): {
    snapshot: RemoteSnapshot;
    source: LocalDataSource<Record<string, unknown>>;
  } {
    snapshot = jsonSnapshot(snapshot);
    if (
      !snapshot ||
      snapshot.datasetId !== options.datasetId ||
      typeof snapshot.revision !== 'string' ||
      !snapshot.revision ||
      !Array.isArray(snapshot.rows) ||
      snapshot.rows.length > maxRows
    )
      throw new TypeError('Invalid remote snapshot.');
    const rows = Array.from(snapshot.rows, (row) => {
      if (
        !row ||
        !row.values ||
        typeof row.values !== 'object' ||
        Array.isArray(row.values) ||
        [...keys].some((key) => !Object.hasOwn(row.values, key))
      )
        throw new TypeError('Invalid remote row.');
      return Object.freeze({
        id: row.id,
        values: Object.freeze(Object.fromEntries([...keys].map((key) => [key, row.values[key]]))),
      });
    });
    const next = new LocalDataSource(
      rows.map((row) => row.values),
      (_, i) => rows[i]!.id,
    );
    return {
      snapshot: Object.freeze({ datasetId: options.datasetId, revision: snapshot.revision, rows: Object.freeze(rows) }),
      source: next,
    };
  }
  function install(snapshot: RemoteSnapshot): void {
    const valid = readSnapshot(snapshot);
    source = valid.source;
    rowIndices = new Map(valid.snapshot.rows.map((row, index) => [row.id, index]));
    revision = valid.snapshot.revision;
    pending.clear();
    request = conflict = undefined;
    lastError = undefined;
    emit('ready');
  }
  function installDelta(input: RemoteDelta, mutation: RemoteMutation): void {
    const delta = jsonSnapshot(input);
    if (
      !delta ||
      delta.datasetId !== options.datasetId ||
      delta.baseRevision !== mutation.expectedRevision ||
      delta.baseRevision !== revision ||
      typeof delta.revision !== 'string' ||
      !delta.revision ||
      delta.revision === delta.baseRevision ||
      !Array.isArray(delta.cells) ||
      delta.cells.length > clipboardCellLimit
    )
      throw new TypeError('Invalid remote delta.');
    const seen = new Set<string>();
    const updates: CellUpdate[] = [];
    for (const cell of delta.cells) {
      if (!cell || !rowIndices.has(cell.rowId) || !keys.has(cell.columnKey) || !Object.hasOwn(cell, 'value'))
        throw new TypeError('Invalid remote delta cell.');
      const key = JSON.stringify([cell.rowId, cell.columnKey]);
      if (seen.has(key)) throw new TypeError('Duplicate remote delta cell.');
      seen.add(key);
      updates.push({ rowIndex: rowIndices.get(cell.rowId)!, columnKey: cell.columnKey, value: cell.value });
    }
    if (mutation.changes.some((cell) => !seen.has(JSON.stringify([cell.rowId, cell.columnKey]))))
      throw new TypeError('Remote delta must acknowledge every submitted cell.');
    source.setValues(updates);
    revision = delta.revision;
    pending.clear();
    request = conflict = undefined;
    lastError = undefined;
    emit('ready');
  }
  function setValues(updates: readonly CellUpdate[]): void {
    alive();
    if (status !== 'ready' || active || request) throw new Error('Remote source is not ready for editing.');
    if (!Array.isArray(updates) || updates.length > clipboardCellLimit)
      throw new RangeError('Remote batch limit reached.');
    const staged = new Map(pending);
    const writes = new Map<string, CellUpdate>();
    for (const update of Array.from(updates)) {
      if (
        !update ||
        !Number.isSafeInteger(update.rowIndex) ||
        update.rowIndex < 0 ||
        update.rowIndex >= source.getRowCount() ||
        !keys.has(update.columnKey)
      )
        throw new TypeError('Invalid remote cell update.');
      jsonSnapshot(update.value);
      const rowId = source.getRowId(update.rowIndex),
        key = JSON.stringify([rowId, update.columnKey]);
      const original = pending.has(key)
        ? pending.get(key)!.previous
        : source.getValue(update.rowIndex, update.columnKey);
      if (Object.is(original, update.value)) staged.delete(key);
      else
        staged.set(key, Object.freeze({ rowId, columnKey: update.columnKey, previous: original, value: update.value }));
      writes.set(key, { ...update });
    }
    if (staged.size > maxPendingCells) throw new RangeError('Remote pending cell limit reached.');
    source.setValues([...writes.values()]);
    pending = staged;
  }
  function disconnect(): void {
    alive();
    generation++;
    const current = controller;
    controller = undefined;
    active = undefined;
    emit('disconnected');
    current?.abort();
  }
  function resync(discardPending = false): Promise<void> {
    alive();
    if (typeof discardPending !== 'boolean') throw new TypeError('Invalid resync option.');
    if (active || status === 'loading' || status === 'committing')
      throw new Error('Remote operation is already running.');
    if (request) throw new Error('Resolve the uncertain mutation or conflict before resync.');
    if ((pending.size || request) && !discardPending)
      throw new Error('Resolve or explicitly discard pending edits before resync.');
    const token = ++generation,
      abort = options.createAbortController();
    controller = abort;
    emit('loading');
    const operation = Promise.resolve()
      .then(() => options.load(abort.signal))
      .then((snapshot) => {
        if (token === generation && status !== 'destroyed') install(snapshot);
      })
      .catch((error) => {
        if (token !== generation || status === 'destroyed') return;
        lastError = error;
        emit('disconnected');
        throw error;
      })
      .finally(() => {
        if (token === generation) {
          controller = undefined;
          active = undefined;
        }
      });
    active = operation;
    return operation;
  }
  function commit(): Promise<void> {
    alive();
    if (active) {
      if (status === 'committing') return active;
      throw new Error('Remote operation is already running.');
    }
    if (status !== 'ready' && !(status === 'disconnected' && revision !== null && pending.size))
      throw new Error('Remote source cannot commit in this state.');
    if (!pending.size) return Promise.resolve();
    if (!request) {
      const mutationId = options.createMutationId();
      if (typeof mutationId !== 'string' || !mutationId) throw new TypeError('Invalid mutation ID.');
      request = jsonSnapshot({
        datasetId: options.datasetId,
        mutationId,
        expectedRevision: revision!,
        changes: [...pending.values()],
      });
    }
    const mutation = request,
      token = ++generation,
      abort = options.createAbortController();
    controller = abort;
    emit('committing');
    const operation = Promise.resolve()
      .then(() => options.write(mutation, abort.signal))
      .then((result) => {
        if (token !== generation || status === 'destroyed') return;
        if (
          !result ||
          result.mutationId !== mutation.mutationId ||
          !['accepted', 'conflict', 'rejected'].includes(result.status)
        )
          throw new TypeError('Invalid remote write result.');
        if (result.status === 'rejected') {
          if (result.datasetId !== options.datasetId || typeof result.message !== 'string')
            throw new TypeError('Invalid remote rejection.');
          lastError = result.message;
          request = undefined;
          emit('ready');
          return;
        }
        if (result.status === 'accepted' && 'delta' in result) {
          if ('snapshot' in result) throw new TypeError('Ambiguous remote write result.');
          installDelta(result.delta, mutation);
          return;
        }
        const valid = readSnapshot(result.snapshot);
        if (result.status === 'accepted') {
          if (valid.snapshot.revision === mutation.expectedRevision)
            throw new TypeError('Accepted remote write must advance revision.');
          install(valid.snapshot);
          return;
        }
        conflict = valid.snapshot;
        emit('conflict');
      })
      .catch((error) => {
        if (token !== generation || status === 'destroyed') return;
        lastError = error;
        emit('disconnected');
        throw error;
      })
      .finally(() => {
        if (token === generation) {
          controller = undefined;
          active = undefined;
        }
      });
    active = operation;
    return operation;
  }
  return Object.freeze({
    getRowCount: () => {
      alive();
      return source.getRowCount();
    },
    getRowId: (row: number) => {
      alive();
      return source.getRowId(row);
    },
    getValue: (row: number, key: string) => {
      alive();
      return source.getValue(row, key);
    },
    setValues,
    setValue: (rowIndex: number, columnKey: string, value: unknown) => setValues([{ rowIndex, columnKey, value }]),
    get status() {
      return status;
    },
    get revision() {
      return revision;
    },
    get pendingCellCount() {
      return pending.size;
    },
    get lastError() {
      return lastError;
    },
    getPendingChanges: () => {
      alive();
      return Object.freeze([...pending.values()]);
    },
    get conflict() {
      return conflict ?? null;
    },
    commit,
    resync,
    reconnect: () => resync(),
    disconnect,
    /** Adopt the validated server snapshot. Reapply selected edits through the engine after refresh. */
    acceptServer: () => {
      alive();
      if (status !== 'conflict' || !conflict) throw new Error('No remote conflict to resolve.');
      install(conflict);
    },
    subscribe: (listener: (status: RemoteStatus) => void) => {
      alive();
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    takeObserverErrors: () => errors.splice(0),
    destroy: () => {
      if (status === 'destroyed') return;
      generation++;
      const current = controller;
      controller = undefined;
      active = undefined;
      pending.clear();
      request = conflict = undefined;
      source = new LocalDataSource([], (_, i) => i);
      rowIndices.clear();
      listeners.clear();
      errors.length = 0;
      status = 'destroyed';
      current?.abort();
    },
  });
}
