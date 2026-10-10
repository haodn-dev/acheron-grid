import { snapshotLocalView } from './data-source.js';
import type { DataSource, RowId, LocalViewOptions } from './data-source.js';

export interface PageState {
  readonly offset: number;
  readonly status: 'loading' | 'ready' | 'error';
  readonly error?: unknown;
}
export interface AsyncDataSourceOptions<S> {
  readonly rowCount?: number;
  readonly pageSize?: number;
  readonly maxPages?: number;
  readonly maxConcurrentLoads?: number;
  readonly maxPendingLoads?: number;
  readonly query?: LocalViewOptions;
  readonly createAbortController: () => { readonly signal: S; abort(): void };
  readonly load: (request: {
    readonly offset: number;
    readonly limit: number;
    readonly signal: S;
    readonly query: Readonly<LocalViewOptions>;
  }) => Promise<{ readonly rows: readonly Readonly<Record<string, unknown>>[]; readonly total: number }>;
  /** Stable positional identity within one server query; query changes invalidate identity. */
  readonly getRowId?: (index: number, loadedRow?: Readonly<Record<string, unknown>>) => RowId;
}

/** Explicit asynchronous loading around a synchronous, read-only cache. No browser globals. */
export function createAsyncDataSource<S>(options: AsyncDataSourceOptions<S>) {
  const pageSize = options.pageSize ?? 100,
    maxPages = options.maxPages ?? 10;
  const maxConcurrentLoads = options.maxConcurrentLoads ?? 4,
    maxPendingLoads = options.maxPendingLoads ?? 100;
  let activeLoads = 0;
  let count = options.rowCount ?? 0,
    destroyed = false,
    generation = 0;
  let query = snapshotLocalView(options.query === undefined ? {} : options.query);
  if (
    ![pageSize, maxPages, maxConcurrentLoads, maxPendingLoads].every(
      (value) => Number.isSafeInteger(value) && value > 0,
    ) ||
    !Number.isSafeInteger(count) ||
    count < 0
  )
    throw new RangeError('Invalid async source dimensions.');
  const pages = new Map<number, readonly Readonly<Record<string, unknown>>[]>();
  const states = new Map<number, PageState>();
  const pending = new Map<
    number,
    {
      controller: ReturnType<typeof options.createAbortController>;
      promise: Promise<void>;
      started: boolean;
      start(): void;
      cancelQueued(): void;
    }
  >();
  const listeners = new Set<(state: PageState) => void>();
  const observerErrors: unknown[] = [];
  function emit(state: PageState): void {
    states.delete(state.offset);
    states.set(state.offset, Object.freeze(state));
    const errors = [...states.values()].filter((item) => item.status === 'error');
    for (const item of errors.slice(0, Math.max(0, errors.length - maxPages))) states.delete(item.offset);
    for (const listener of [...listeners])
      try {
        listener(state);
      } catch (error) {
        observerErrors.push(error);
        if (observerErrors.length > 10) observerErrors.shift();
      }
  }
  function alive(): void {
    if (destroyed) throw new Error('Async data source is destroyed.');
  }
  function index(row: number): void {
    alive();
    if (!Number.isSafeInteger(row) || row < 0 || row >= count) throw new RangeError('Invalid async row index.');
  }
  function pump(): void {
    for (const item of pending.values()) {
      if (activeLoads >= maxConcurrentLoads) break;
      if (!item.started) item.start();
    }
  }
  function loadPage(offset: number): Promise<void> {
    alive();
    if (!Number.isSafeInteger(offset) || offset < 0 || offset % pageSize)
      throw new RangeError('Page offset must align with pageSize.');
    const existing = pending.get(offset);
    if (existing) return existing.promise;
    if (pages.has(offset) && offset < count) {
      const cached = pages.get(offset)!;
      pages.delete(offset);
      pages.set(offset, cached);
      return Promise.resolve();
    }
    if (pending.size >= maxPendingLoads) throw new RangeError('Async pending load limit reached.');
    const controller = options.createAbortController(),
      revision = generation,
      requestQuery = query;
    let wake!: () => void,
      started = false;
    const slot = new Promise<void>((resolve) => {
      wake = resolve;
    });
    const promise = slot
      .then(() => {
        if (destroyed || revision !== generation || pending.get(offset)?.controller !== controller)
          throw new Error('Page load canceled.');
        return options.load({ offset, limit: pageSize, signal: controller.signal, query: requestQuery });
      })
      .then((result) => {
        if (destroyed || revision !== generation || pending.get(offset)?.controller !== controller) return;
        if (
          !Number.isSafeInteger(result.total) ||
          result.total < 0 ||
          !Array.isArray(result.rows) ||
          result.rows.length > pageSize ||
          result.rows.length !== Math.max(0, Math.min(pageSize, result.total - offset))
        )
          throw new TypeError('Invalid page result.');
        const rows = Array.from(result.rows, (row) => {
          if (!row || typeof row !== 'object' || Array.isArray(row)) throw new TypeError('Invalid page row.');
          return Object.freeze({ ...row });
        });
        if (count !== result.total) {
          for (const cached of pages.keys()) {
            pages.delete(cached);
            if (states.get(cached)?.status === 'ready') states.delete(cached);
          }
        }
        count = result.total;
        pages.set(offset, rows);
        while (pages.size > maxPages) {
          const evicted = pages.keys().next().value!;
          pages.delete(evicted);
          states.delete(evicted);
        }
        emit({ offset, status: 'ready' });
      })
      .catch((error) => {
        if (destroyed || revision !== generation || pending.get(offset)?.controller !== controller) return;
        emit({ offset, status: 'error', error });
        throw error;
      })
      .finally(() => {
        if (started) activeLoads--;
        if (pending.get(offset)?.controller === controller) pending.delete(offset);
        pump();
      });
    const item = {
      controller,
      promise,
      started: false,
      start() {
        item.started = started = true;
        activeLoads++;
        wake();
      },
      cancelQueued: wake,
    };
    pending.set(offset, item);
    emit({ offset, status: 'loading' });
    pump();
    return promise;
  }
  function cancel(): void {
    generation++;
    const canceled = [...pending.values()];
    pending.clear();
    for (const [offset, state] of states) if (state.status === 'loading') states.delete(offset);
    for (const item of canceled) {
      item.cancelQueued();
      item.controller.abort();
    }
  }
  function loadRange(start: number, end: number): Promise<void> {
    alive();
    if (
      !Number.isSafeInteger(start) ||
      !Number.isSafeInteger(end) ||
      start < 0 ||
      end < start ||
      Math.floor(end / pageSize) - Math.floor(start / pageSize) + 1 > maxPages
    )
      throw new RangeError('Load range must fit the page cache.');
    const offsets = Array.from(
      { length: Math.floor(end / pageSize) - Math.floor(start / pageSize) + 1 },
      (_, i) => (Math.floor(start / pageSize) + i) * pageSize,
    );
    if (
      pending.size +
        offsets.filter((offset) => (!pages.has(offset) || offset >= count) && !pending.has(offset)).length >
      maxPendingLoads
    )
      throw new RangeError('Async pending load limit reached.');
    return Promise.all(offsets.map(loadPage)).then(() => {});
  }
  const source: DataSource = {
    getRowCount: () => {
      alive();
      return count;
    },
    getRowId: (row) => {
      index(row);
      return options.getRowId?.(row, pages.get(Math.floor(row / pageSize) * pageSize)?.[row % pageSize]) ?? row;
    },
    getValue: (row, key) => {
      index(row);
      const value = pages.get(Math.floor(row / pageSize) * pageSize)?.[row % pageSize];
      return value && Object.hasOwn(value, key) ? value[key] : undefined;
    },
  };
  return Object.freeze({
    ...source,
    pageSize,
    maxConcurrentLoads,
    maxPendingLoads,
    get query() {
      alive();
      return query;
    },
    setQuery: (next: LocalViewOptions, rowCount = 0) => {
      alive();
      const snapshot = snapshotLocalView(next);
      if (!Number.isSafeInteger(rowCount) || rowCount < 0) throw new RangeError('Invalid row count.');
      pages.clear();
      states.clear();
      count = rowCount;
      query = snapshot;
      cancel();
    },
    loadPage,
    loadRange,
    getPageState: (offset: number) => states.get(offset) ?? null,
    subscribe: (listener: (state: PageState) => void) => {
      alive();
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    takeObserverErrors: () => observerErrors.splice(0),
    cancel,
    reset: (rowCount = 0) => {
      alive();
      if (!Number.isSafeInteger(rowCount) || rowCount < 0) throw new RangeError('Invalid row count.');
      pages.clear();
      states.clear();
      count = rowCount;
      cancel();
    },
    destroy: () => {
      if (destroyed) return;
      destroyed = true;
      pages.clear();
      states.clear();
      listeners.clear();
      observerErrors.length = 0;
      cancel();
    },
  });
}
