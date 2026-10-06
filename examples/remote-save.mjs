import { createGridEngine, LocalDataSource } from '@acheron-grid/core';

/** Host-owned example for a fixed local dataset, not an asynchronous DataSource setter. */
export function createRemoteSaveExample({ datasetId, revision, rows, save, createRequestId }) {
  if (typeof datasetId !== 'string' || !datasetId || !Number.isSafeInteger(revision) || revision < 0 || !Array.isArray(rows) || rows.length > 10_000 || typeof save !== 'function' || typeof createRequestId !== 'function') throw new TypeError('Invalid remote save configuration.');
  const validName = value => typeof value === 'string' && value.length <= 100;
  if (rows.some(row => !row || !validName(row.name))) throw new TypeError('Invalid name.');
  const source = new LocalDataSource(rows, row => row.id);
  const baseline = new Map(rows.map(row => [row.id, row.name]));
  const dirty = new Map();
  let pending = null, running = false, destroyed = false;
  const engine = createGridEngine({
    dataSource: source,
    columns: [{ key: 'name', title: 'Name', editable: true, validate: value => validName(value) ? null : 'Name must be a string of at most 100 characters.' }],
    canChangeStructure: () => false,
    onEvent(event) {
      if (event.type !== 'cell:change') return;
      for (const change of event.changes) {
        if (Object.is(change.value, baseline.get(change.rowId))) dirty.delete(change.rowId);
        else dirty.set(change.rowId, Object.freeze({ rowId: change.rowId, columnKey: 'name', previous: baseline.get(change.rowId), value: change.value }));
      }
    },
  });
  function alive() { if (destroyed) throw new Error('Save session is destroyed.'); }
  function reconcile() {
    dirty.clear();
    for (let row = 0; row < source.getRowCount(); row++) {
      const rowId = source.getRowId(row), value = source.getValue(row, 'name');
      if (!Object.is(value, baseline.get(rowId))) dirty.set(rowId, Object.freeze({ rowId, columnKey: 'name', previous: baseline.get(rowId), value }));
    }
  }
  return Object.freeze({
    engine,
    get revision() { return revision; },
    get status() { return destroyed ? 'destroyed' : running ? 'saving' : pending ? 'uncertain' : dirty.size ? 'dirty' : 'clean'; },
    getDrafts() { alive(); return Object.freeze([...dirty.values()]); },
    async save() {
      alive();
      if (running) throw new Error('A save is already running.');
      if (!pending && !dirty.size) return Object.freeze({ status: 'unchanged', revision });
      if (!pending) {
        if (revision === Number.MAX_SAFE_INTEGER) throw new RangeError('Revision exhausted.');
        const requestId = createRequestId();
        if (typeof requestId !== 'string' || !requestId) throw new TypeError('Invalid request ID.');
        pending = Object.freeze({ requestId, datasetId, expectedRevision: revision, changes: Object.freeze([...dirty.values()]) });
      }
      const request = pending;
      running = true;
      try {
        const receipt = await save(request);
        if (destroyed) throw new Error('Save session closed; reconcile the server before reopening.');
        if (!receipt || receipt.requestId !== request.requestId || receipt.datasetId !== datasetId || !['saved', 'validation', 'conflict'].includes(receipt.status) || receipt.status === 'saved' && receipt.revision !== request.expectedRevision + 1) throw new Error('Invalid save receipt; server outcome is uncertain.');
        if (receipt.status === 'saved') {
          for (const change of request.changes) baseline.set(change.rowId, change.value);
          revision = receipt.revision;
          reconcile();
        }
        pending = null;
        return Object.freeze({ ...receipt });
      } finally { running = false; }
    },
    discardDrafts() {
      alive();
      if (running || pending) throw new Error('Resolve the pending server outcome before discarding drafts.');
      const visible = new Map(Array.from({ length: engine.rowCount }, (_, row) => [engine.getRowId(row), row]));
      const updates = [...dirty.values()].map(change => {
        const rowIndex = visible.get(change.rowId);
        if (rowIndex === undefined) throw new Error('Clear filters before discarding hidden drafts.');
        return { rowIndex, columnKey: 'name', value: change.previous };
      });
      engine.updateCells(updates);
    },
    destroy() { if (destroyed) return; destroyed = true; engine.destroy(); dirty.clear(); pending = null; },
  });
}
