import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { cpus, totalmem } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createGridEngine, LocalDataSource, LocalDataView } from '@acheron-grid/core';

const root = resolve(fileURLToPath(new URL('../', import.meta.url)));
const revision = spawnSync('git', ['-c', `safe.directory=${root.replaceAll('\\', '/')}`, 'rev-parse', 'HEAD'], {
  cwd: root,
  encoding: 'utf8',
});
assert.equal(revision.status, 0, 'Cannot identify benchmark source revision.');
const runs = [];
for (const rowCount of [10_000, 100_000])
  for (let repeat = 0; repeat < 3; repeat++) {
    const rows = Array.from({ length: rowCount }, (_, id) => ({
      id,
      score: (id * 48271) % 997,
      team: `team-${id % 10}`,
    }));
    const timings = {};
    const measure = (name, callback) => {
      const start = performance.now();
      const result = callback();
      timings[name] = performance.now() - start;
      return result;
    };
    globalThis.gc?.();
    const heapBefore = process.memoryUsage().heapUsed;
    const source = measure('constructSource', () => new LocalDataSource(rows, (row) => row.id));
    const sorted = measure('sort', () => new LocalDataView(source, { sort: { columnKey: 'score', direction: 'asc' } }));
    const expected = rows.slice().sort((a, b) => a.score - b.score);
    assert.deepEqual(
      Array.from({ length: rowCount }, (_, i) => sorted.getRowId(i)),
      expected.map((row) => row.id),
    );
    const multi = measure(
      'multiSort',
      () =>
        new LocalDataView(source, {
          sorts: [
            { columnKey: 'team', direction: 'asc' },
            { columnKey: 'score', direction: 'desc' },
          ],
        }),
    );
    const expectedMulti = rows.slice().sort((a, b) => a.team.localeCompare(b.team) || b.score - a.score);
    assert.deepEqual(
      Array.from({ length: rowCount }, (_, i) => multi.getRowId(i)),
      expectedMulti.map((row) => row.id),
    );
    const filtered = measure(
      'filter',
      () => new LocalDataView(source, { filters: [{ columnKey: 'team', query: 'team-3', operator: 'equals' }] }),
    );
    assert.deepEqual(
      Array.from({ length: filtered.getRowCount() }, (_, i) => filtered.getRowId(i)),
      rows.filter((row) => row.team === 'team-3').map((row) => row.id),
    );
    let writable = true;
    const events = [];
    const engine = measure('constructEngine', () =>
      createGridEngine({
        dataSource: source,
        columns: [
          { key: 'score', title: 'Score', editable: true, parse: Number },
          { key: 'team', title: 'Team', editable: true },
        ],
        resolveCellPermission: () => ({ writable }),
        onEvent: (event) => events.push(event.type),
      }),
    );
    const ids = measure('captureRowIdentity', () => engine.captureRowIdentity());
    assert.deepEqual(
      ids,
      rows.map((row) => row.id),
    );
    for (const batchSize of [1_000, 10_000]) {
      const updates = Array.from({ length: batchSize }, (_, rowIndex) => ({
        rowIndex,
        columnKey: 'score',
        value: -rowIndex - 1,
      }));
      measure(`batch${batchSize}`, () => engine.updateCells(updates));
      for (let i = 0; i < batchSize; i++) assert.equal(source.getValue(i, 'score'), -i - 1);
      measure(`undo${batchSize}`, () => assert.equal(engine.undo(), true));
      for (let i = 0; i < batchSize; i++) assert.equal(source.getValue(i, 'score'), rows[i].score);
      measure(`redo${batchSize}`, () => assert.equal(engine.redo(), true));
      engine.undo();
    }
    engine.select(0, 0);
    for (const pasteCount of rowCount >= 100_000 ? [10_000, 100_000] : [10_000]) {
      const text = Array.from({ length: pasteCount }, (_, i) => String(i + 1000)).join('\r\n');
      measure(`paste${pasteCount}`, () => engine.paste(text));
      for (let i = 0; i < pasteCount; i++) assert.equal(source.getValue(i, 'score'), i + 1000);
      measure(`undoPaste${pasteCount}`, () => assert.equal(engine.undo(), true));
      for (let i = 0; i < pasteCount; i++) assert.equal(source.getValue(i, 'score'), rows[i].score);
    }
    writable = false;
    const eventsBefore = events.length;
    const canUndo = engine.canUndo();
    measure('veto10000', () =>
      assert.throws(
        () =>
          engine.updateCells(
            Array.from({ length: 10_000 }, (_, rowIndex) => ({ rowIndex, columnKey: 'score', value: -1 })),
          ),
        /writable/,
      ),
    );
    for (let i = 0; i < 10_000; i++) assert.equal(source.getValue(i, 'score'), rows[i].score);
    assert.equal(events.length, eventsBefore);
    assert.equal(engine.canUndo(), canUndo);
    writable = true;
    measure('refreshValues', () => engine.refreshData('values'));
    assert.equal(engine.canUndo(), false);
    assert.equal(engine.getRowId(0), 0);
    const state = measure('exportState', () => engine.exportState());
    measure('restoreState', () => engine.restoreState(state));
    assert.deepEqual(engine.exportState(), state);
    engine.destroy();
    globalThis.gc?.();
    runs.push({ rowCount, repeat, timings, retainedHeapDeltaBytes: process.memoryUsage().heapUsed - heapBefore });
  }
console.log(
  JSON.stringify(
    {
      schemaVersion: 1,
      workload: 'allocated local data and controlled commands',
      revision: revision.status === 0 ? revision.stdout.trim() : null,
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      cpu: cpus()[0]?.model ?? null,
      logicalProcessors: cpus().length,
      totalMemoryBytes: totalmem(),
      gcEnabled: typeof globalThis.gc === 'function',
      memoryNote:
        'Retained heap delta includes live fixture, source, views and oracle after optional GC; not peak memory or a leak measurement.',
      runs,
    },
    null,
    2,
  ),
);
