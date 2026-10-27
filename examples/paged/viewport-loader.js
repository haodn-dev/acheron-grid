// Flat, fixed-query example: the host owns transport and grid lifetime.
export function createViewportLoader({ source, grid, maxPages, onState = () => {} }) {
  if (!Number.isSafeInteger(maxPages) || maxPages < 1) throw new RangeError('Invalid cache budget.');
  const pageSize = source.pageSize;
  const total = source.getRowCount();
  let desired = new Set(),
    lastViewport,
    loading = false,
    disposed = false,
    paused = false,
    blocked = false,
    error = null;
  const known = new Set(),
    changed = new Set(),
    failed = new Set();
  const state = () =>
    Object.freeze({ loading, paused, blocked, error, cachedPages: known.size, queuedWindows: changed.size });
  const notify = () => {
    if (!disposed) onState(state());
  };
  function flush() {
    blocked = false;
    for (const offset of changed) {
      try {
        grid.refreshRows(offset, Math.min(total - 1, offset + pageSize - 1));
        changed.delete(offset);
      } catch (failure) {
        blocked = true;
        error = failure.message;
        break;
      }
    }
    return !blocked;
  }
  const unsubscribe = source.subscribe(({ offset, status }) => {
    if (disposed || status !== 'ready') return;
    for (const cached of known) {
      if (source.getPageState(cached)?.status !== 'ready') {
        known.delete(cached);
        changed.add(cached);
      }
    }
    known.add(offset);
    changed.add(offset);
    if (!paused) flush();
    notify();
  });
  async function pump() {
    if (loading || disposed || blocked || paused) return;
    loading = true;
    notify();
    try {
      while (!disposed && !blocked && !paused) {
        const offset = [...desired].find(
          (offset) => !failed.has(offset) && source.getPageState(offset)?.status !== 'ready',
        );
        if (offset === undefined) break;
        try {
          await source.loadRange(offset, Math.min(total - 1, offset + pageSize - 1));
        } catch (failure) {
          if (disposed) return;
          failed.add(offset);
          error = failure.message;
        }
      }
    } finally {
      loading = false;
      notify();
    }
  }
  function setViewport(viewport) {
    if (disposed) return;
    lastViewport = viewport;
    const next = new Set();
    let overflow = false;
    const add = (offset) => {
      if (offset >= 0 && offset < total && next.size < maxPages) next.add(offset);
    };
    // Visit visible pages first; overscan must never displace a visible page.
    for (const { rows } of viewport.regions) {
      for (let offset = Math.floor(rows.start / pageSize) * pageSize; offset < rows.end; offset += pageSize) {
        if (next.size === maxPages && !next.has(offset)) {
          overflow = true;
          break;
        }
        add(offset);
      }
    }
    if (overflow) {
      desired.clear();
      error = 'Visible pages exceed the cache budget. Reduce the viewport or increase maxPages.';
      notify();
      return;
    }
    for (const { rows } of viewport.regions) {
      if (rows.start >= rows.end) continue;
      add((Math.floor(rows.start / pageSize) - 1) * pageSize);
      add((Math.floor((rows.end - 1) / pageSize) + 1) * pageSize);
    }
    desired = next;
    for (const offset of desired) if (source.getPageState(offset)?.status === 'ready') known.add(offset);
    for (const offset of failed) if (!desired.has(offset)) failed.delete(offset);
    if (!failed.size && !blocked) error = null;
    void pump();
  }
  return Object.freeze({
    setViewport,
    getState: state,
    pause() {
      if (disposed) return;
      paused = true;
      notify();
    },
    resume() {
      if (disposed) return;
      paused = false;
      const wasBlocked = blocked;
      if (flush()) {
        if (wasBlocked && !failed.size) error = null;
        void pump();
      }
      notify();
    },
    retry() {
      if (disposed) return;
      failed.clear();
      error = null;
      if (!paused && flush() && lastViewport) setViewport(lastViewport);
      notify();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      unsubscribe();
      desired.clear();
      known.clear();
      changed.clear();
      failed.clear();
      lastViewport = undefined;
    },
  });
}
