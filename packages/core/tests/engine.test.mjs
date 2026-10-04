import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createGridEngine, LocalDataSource, LocalDataView } from '@acheron-grid/core';

function fixture(options = {}) {
  const source = new LocalDataSource([{ id: 1, name: 'Ada', score: 1 }, { id: 2, name: 'Grace', score: 2 }], row => row.id);
  const changes = [];
  const engine = createGridEngine({ dataSource: source, columns: [
    { key: 'name', title: 'Name', editable: true },
    { key: 'score', title: 'Score', editable: true, parse(text) {
      const value = Number(text);
      if (!Number.isFinite(value)) throw new Error('Invalid score.');
      return value;
    } },
  ], onInvalidate: change => changes.push(change), ...options });
  return { source, engine, changes };
}

test('headless entry compiles without DOM libraries or browser modules', () => {
  assert.equal(typeof globalThis.document, 'undefined');
  assert.equal(typeof globalThis.window, 'undefined');
  const root = fileURLToPath(new URL('../../../', import.meta.url));
  const result = spawnSync(process.execPath, ['node_modules/typescript/bin/tsc', '-p', 'packages/core/tsconfig.headless.json', '--listFiles'], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.doesNotMatch(result.stdout, /lib\.dom|[\\/]grid\.ts|@types[\\/]node/);
  assert.match(result.stdout, /[\\/]engine\.ts/);
});

test('batch validation, duplicate/no-op writes and history share one domain path', () => {
  const { engine, source, changes } = fixture();
  assert.throws(() => engine.updateCells([
    { rowIndex: 0, columnKey: 'name', value: 'Changed' },
    { rowIndex: 99, columnKey: 'name', value: 'Invalid' },
  ]), /Invalid row/);
  assert.equal(source.getValue(0, 'name'), 'Ada');
  assert.equal(engine.canUndo(), false);
  engine.updateCells([{ rowIndex: 0, columnKey: 'name', value: 'Ada' }]);
  assert.equal(changes.length, 0);
  engine.updateCells([
    { rowIndex: 0, columnKey: 'name', value: 'First' },
    { rowIndex: 0, columnKey: 'name', value: 'Last' },
    { rowIndex: 1, columnKey: 'score', value: 3 },
  ]);
  assert.equal(changes.length, 1);
  assert.equal(changes[0].cells.length, 2);
  assert.equal(source.getValue(0, 'name'), 'Last');
  assert.equal(engine.undo(), true);
  assert.equal(source.getValue(0, 'name'), 'Ada');
  assert.equal(source.getValue(1, 'score'), 2);
  assert.equal(engine.redo(), true);
  source.setValue(0, 'name', 'External');
  assert.throws(() => engine.undo(), /conflicts/);
  assert.equal(engine.canUndo(), true);
});

test('failed atomic writes and changed row identity leave history intact', () => {
  const { source } = fixture();
  let fail = false;
  let id = 1;
  const engine = createGridEngine({ columns: [{ key: 'name', title: 'Name' }], dataSource: {
    getRowCount: () => 2, getRowId: row => row === 0 ? id : 2,
    getValue: (row, key) => source.getValue(row, key),
    setValues(updates) { if (fail) throw new Error('Write failed.'); source.setValues(updates); },
  } });
  engine.updateCells([{ rowIndex: 0, columnKey: 'name', value: 'Changed' }]);
  fail = true;
  assert.throws(() => engine.undo(), /Write failed/);
  assert.equal(source.getValue(0, 'name'), 'Changed');
  assert.equal(engine.canUndo(), true);
  fail = false;
  id = 9;
  assert.throws(() => engine.undo(), /conflicts/);
  id = 1;
  assert.equal(engine.undo(), true);
  assert.equal(source.getValue(0, 'name'), 'Ada');
});

test('selection endpoint and anchor are independent and returned state is isolated', () => {
  const { engine, changes } = fixture();
  engine.select(1, 1);
  engine.select(0, 0, true);
  assert.deepEqual(engine.getSelectionRange(), { startRow: 0, endRow: 1, startColumn: 0, endColumn: 1 });
  engine.getSelection().rowIndex = 99;
  assert.equal(engine.getSelection().rowIndex, 0);
  engine.select(0, 0, true);
  assert.equal(changes.length, 2);
  engine.select(0, 0);
  assert.deepEqual(changes.at(-1), { type: 'selection', changed: false, rangeChanged: true });
  assert.throws(() => engine.select(-1, 0), /Invalid cell/);
  assert.throws(() => engine.select(0, 0.5), /Invalid cell/);
  engine.clearSelection();
  engine.clearSelection();
  assert.equal(engine.getSelection(), null);
  assert.equal(changes.length, 4);
});

test('edit and paste parse in domain, rollback on error and undo as one command', () => {
  const { engine, source } = fixture();
  engine.select(0, 0);
  assert.throws(() => engine.paste('Changed\tinvalid\r\nOther\t4'), /Invalid score/);
  assert.equal(source.getValue(0, 'name'), 'Ada');
  assert.equal(engine.canUndo(), false);
  assert.throws(() => engine.paste('a\t1\tx'), /beyond/);
  engine.paste('Changed\t3\r\nOther\t4');
  assert.equal(source.getValue(1, 'score'), 4);
  assert.deepEqual(engine.getSelectionRange(), {startRow:0,endRow:1,startColumn:0,endColumn:1});
  assert.equal(engine.copySelection(), 'Changed\t3\r\nOther\t4');
  engine.undo();
  assert.equal(source.getValue(1, 'name'), 'Grace');
  engine.editCell(0, 1, '5');
  assert.equal(source.getValue(0, 'score'), 5);
  engine.undo();
  assert.equal(source.getValue(0, 'score'), 1);
});

test('read-only still permits selection/copy and programmatic update semantics stay intact', () => {
  const { engine, source } = fixture({ columns: [{ key: 'name', title: 'Name' }, { key: 'score', title: 'Score', editable: true }] });
  engine.select(0, 0);
  assert.equal(engine.copySelection(), 'Ada');
  assert.equal(engine.canEdit(0, 0), false);
  assert.equal(engine.canPaste(), false);
  assert.equal(engine.canEdit(0, 1), false);
  assert.throws(() => engine.editCell(0, 0, 'Changed'), /cannot be edited/);
  assert.throws(() => engine.paste('Changed'), /read-only/);
  engine.updateCells([{ rowIndex: 0, columnKey: 'name', value: 'Programmatic' }]);
  assert.equal(source.getValue(0, 'name'), 'Programmatic');
});

test('million-row layout remains sparse and read-only with no data reads for resize', () => {
  let reads = 0;
  const changes = [];
  const engine = createGridEngine({ columns: [{ key: 'value', title: 'Value' }], dataSource: {
    getRowCount: () => 1_000_000, getRowId: row => row, getValue: () => { reads++; return ''; },
  }, onInvalidate: change => changes.push(change) });
  engine.setRowHeight(500_000, 64);
  assert.equal(engine.rows.position(500_001), 500_001 * 32 + 32);
  assert.equal(engine.rows.indexAt(engine.rows.position(500_001)), 500_001);
  assert.equal(engine.rows.range(0, 64).end, 2);
  assert.equal(engine.rows.setSize, undefined);
  assert.throws(() => engine.setRowHeight(1_000_000, 32), /Invalid/);
  assert.equal(reads, 0);
  assert.deepEqual(changes, [{ type: 'layout' }]);
  assert.throws(() => { engine.columns[0].key = 'Other'; }, TypeError);
});

test('notification observes committed history, teardown drops callback and history caps at 100', () => {
  let notified = 0;
  let engine;
  ({ engine } = fixture({ onInvalidate() { notified++; assert.equal(engine.canUndo(), true); } }));
  for (let value = 0; value < 101; value++) engine.updateCells([{ rowIndex: 0, columnKey: 'name', value: String(value) }]);
  assert.equal(notified, 101);
  // Use another engine so undo notifications do not assert canUndo after the last undo.
  const { engine: capped } = fixture();
  for (let value = 0; value < 101; value++) capped.updateCells([{ rowIndex: 0, columnKey: 'name', value: String(value) }]);
  for (let count = 0; count < 100; count++) assert.equal(capped.undo(), true);
  assert.equal(capped.undo(), false);
  assert.equal(capped.getValue(0, 'name'), '0');
  engine.destroy();
  engine.destroy();
  assert.equal(engine.undo(), false);
  assert.equal(engine.getSelection(), null);
  assert.throws(() => engine.updateCells([]), /destroyed/);
  assert.throws(() => engine.select(0, 0), /destroyed/);
  assert.equal(notified, 101);
  const { engine: throwing } = fixture({ onInvalidate() { throw new Error('Renderer failed.'); } });
  assert.doesNotThrow(() => throwing.updateCells([{ rowIndex: 0, columnKey: 'name', value: 'Committed' }]));
  assert.equal(throwing.takeObserverErrors()[0].message,'Renderer failed.');
  assert.equal(throwing.getValue(0, 'name'), 'Committed');
  assert.equal(throwing.canUndo(), true);
});

test('capabilities preserve defaults, deny veto and immutable scope snapshots', () => {
  const policy = { writable: false };
  const { engine } = fixture({ permissions: policy, resolveCellPermission: () => ({ writable: true, editable: true }) });
  policy.writable = true;
  assert.deepEqual(engine.getCellPermission(0, 0), { editable: false, pasteable: false, selectable: true, copyable: true, writable: false, formatting: true });
  assert.equal(engine.select(0, 0), true);
  assert.equal(engine.copySelection(), 'Ada');
  assert.throws(() => engine.updateCells([{ rowIndex: 0, columnKey: 'name', value: 'Denied' }]), /writable/);
  assert.throws(() => engine.getCellPermission(0, -1), /Invalid cell/);
  assert.throws(() => { engine.getCellPermission(0, 0).copyable = false; }, TypeError);
  const { engine: enabled } = fixture({ columns: [{ key: 'name', title: 'Name', permissions: { editable: true, pasteable: true } }] });
  assert.equal(enabled.canEdit(0, 0), true);
  enabled.editCell(0, 0, 'Enabled');
  const { engine: veto } = fixture({ columns: [{ key: 'name', title: 'Name', editable: true, permissions: { editable: false } }], resolveCellPermission: () => ({ editable: true }) });
  assert.equal(veto.canEdit(0, 0), false);
  assert.throws(() => fixture({ permissions: { copyable: 'yes' } }).engine.getCellPermission(0, 0), /boolean/);
});

test('dynamic row/cell denies are atomic before parsers and preserve history for retry', () => {
  let blocked = false;
  let parses = 0;
  const events = [];
  const { engine, source, changes } = fixture({
    columns: [{ key: 'name', title: 'Name', editable: true, parse: text => { parses++; return text; } }],
    resolveCellPermission: cell => blocked && cell.rowId === 2 ? { writable: false } : undefined,
    onEvent: event => events.push(event),
  });
  engine.select(0, 0);
  blocked = true;
  assert.throws(() => engine.paste('First\nSecond'), /pasteable/);
  assert.equal(parses, 0);
  assert.throws(() => engine.updateCells([{ rowIndex: 0, columnKey: 'name', value: 'First' }, { rowIndex: 1, columnKey: 'name', value: 'Second' }]), /writable/);
  assert.equal(source.getValue(0, 'name'), 'Ada');
  assert.equal(engine.canUndo(), false);
  assert.equal(changes.length, 1);
  assert.equal(events.length, 1);
  blocked = false;
  engine.paste('First\nSecond');
  blocked = true;
  assert.throws(() => engine.undo(), /writable/);
  assert.equal(engine.canUndo(), true);
  assert.equal(source.getValue(0, 'name'), 'First');
  blocked = false;
  engine.undo();
  blocked = true;
  assert.throws(() => engine.redo(), /writable/);
  assert.equal(engine.canRedo(), true);
  blocked = false;
  engine.redo();
  assert.deepEqual(events.filter(event => event.type === 'cell:change').map(event => event.source), ['paste', 'undo', 'redo']);
  assert.equal(events.at(-2).changes[0].previous, 'First');
  assert.equal(events.at(-2).changes[0].value, 'Ada');
});

test('selection checks endpoint only and copy rejects a denied interior cell', () => {
  const { engine, changes } = fixture({ resolveCellPermission: cell => cell.rowIndex === 0 && cell.columnIndex === 1 ? { selectable: false, copyable: false } : undefined });
  engine.select(0, 0);
  assert.equal(engine.select(0, 1), false);
  assert.equal(engine.getSelection().columnIndex, 0);
  assert.equal(changes.length, 1);
  engine.select(1, 1, true);
  assert.deepEqual(engine.getSelectionRange(), { startRow: 0, endRow: 1, startColumn: 0, endColumn: 1 });
  assert.throws(() => engine.copySelection(), /copyable/);
});

test('events follow committed invalidation, omit no-ops and call both throwing hooks', () => {
  const sequence = [];
  let engine;
  ({ engine } = fixture({ onInvalidate: () => sequence.push('invalidate'), onEvent(event) {
    sequence.push(event);
    assert.throws(() => engine.clearSelection(), /Nested/);
    if (event.type === 'cell:change') {
      assert.equal(engine.canUndo(), true);
      assert.equal(engine.copySelection(), 'New');
    }
  } }));
  engine.updateCells([{ rowIndex: 0, columnKey: 'name', value: 'Ada' }]);
  engine.select(0, 0);
  engine.select(0, 0);
  engine.editCell(0, 0, 'New');
  engine.setColumnWidth(0, 160);
  engine.setColumnWidth(0, 200);
  engine.setRowHeight(1, 48);
  engine.clearSelection();
  engine.clearSelection();
  assert.deepEqual(sequence.filter(item => typeof item !== 'string').map(event => event.type), ['selection:change', 'cell:change', 'column:resize', 'row:resize', 'selection:change']);
  assert.equal(sequence[3].source, 'edit');
  assert.deepEqual(sequence[5], { type: 'column:resize', index: 0, previous: 160, size: 200 });
  assert.equal(sequence[9].selection, null);
  for (let i = 0; i < sequence.length; i += 2) assert.equal(sequence[i], 'invalidate');
  engine.destroy();
  assert.equal(sequence.length, 10);
  const error = new Error('First failure');
  let called = 0;
  const { engine: failing } = fixture({ onInvalidate: () => { throw error; }, onEvent: () => { called++; throw new Error('Second failure'); } });
  assert.doesNotThrow(() => failing.updateCells([{ rowIndex: 0, columnKey: 'name', value: 'Committed' }]));
  assert.equal(failing.takeObserverErrors().length,2);
  assert.equal(called, 1);
  assert.equal(failing.getValue(0, 'name'), 'Committed');
  assert.equal(failing.canUndo(), true);
});

test('parser, permission query and source setter cannot issue nested commands', () => {
  let engine;
  const source = new LocalDataSource([{ id: 1, name: 'Ada' }], row => row.id);
  engine = createGridEngine({ columns: [{ key: 'name', title: 'Name', editable: true, parse() { engine.clearSelection(); return 'Bad'; } }], dataSource: source });
  assert.throws(() => engine.editCell(0, 0, 'New'), /Nested/);
  assert.equal(source.getValue(0, 'name'), 'Ada');
  engine = createGridEngine({ columns: [{ key: 'name', title: 'Name' }], dataSource: source, resolveCellPermission() { engine.updateCells([]); return {}; } });
  assert.throws(() => engine.getCellPermission(0, 0), /Nested/);
  assert.throws(() => engine.updateCells([{ rowIndex: 0, columnKey: 'name', value: 'New' }]), /Nested/);
  engine = createGridEngine({ columns: [{ key: 'name', title: 'Name' }], dataSource: {
    getRowCount: () => 1, getRowId: () => 1, getValue: () => 'Ada', setValue() { engine.destroy(); },
  } });
  assert.throws(() => engine.updateCells([{ rowIndex: 0, columnKey: 'name', value: 'New' }]), /Nested/);
  assert.equal(engine.canUndo(), false);
});

test('frozen viewport mapping, seams, resize and validation stay headless', () => {
  const { engine } = fixture({ frozenRows: 1, frozenColumns: 1 });
  const view = engine.getViewport({ width: 240, height: 48, scrollLeft: 80, scrollTop: 16 });
  assert.equal(view.regions.length, 4);
  assert.deepEqual(view.hitTest(159, 31), { row: 0, col: 0 });
  assert.deepEqual(view.hitTest(160, 32), { row: 1, col: 1 });
  assert.equal(view.hitTest(240, 0), null);
  assert.equal(view.hitTest(NaN, 0), null);
  assert.deepEqual(view.cellRect(1, 1), { x: 80, y: 16, width: 160, height: 32, clip: { x: 160, y: 32, width: 80, height: 16 } });
  engine.setRowHeight(0, 40);
  engine.setColumnWidth(0, 180);
  const resized = engine.getViewport({ width: 240, height: 48, scrollLeft: 999, scrollTop: 999 });
  assert.equal(resized.frozenWidth, 180);
  assert.equal(resized.frozenHeight, 40);
  assert.equal(resized.scrollLeft, 100);
  assert.equal(resized.scrollTop, 24);
  assert.deepEqual(resized.hitTest(180, 40), { row: 1, col: 1 });
  assert.throws(() => resized.cellRect(-1, 0), /Invalid cell/);
  assert.throws(() => { resized.regions[0].clip.x = 99; }, TypeError);
  for (const value of [-1, .5, Infinity, NaN, 3]) assert.throws(() => fixture({ frozenRows: value }), /frozen/);
  assert.throws(() => fixture({ frozenColumns: 3 }), /frozen/);
  assert.throws(() => engine.getViewport({ width: -1, height: 0, scrollLeft: 0, scrollTop: 0 }), /Invalid viewport/);
  engine.destroy();
  assert.throws(() => engine.getViewport({ width: 0, height: 0, scrollLeft: 0, scrollTop: 0 }), /destroyed/);
});

test('frozen counts do not increase visible work, including all-frozen and tiny viewports', () => {
  let reads = 0;
  const engine = createGridEngine({ columns: Array.from({ length: 1000 }, (_, i) => ({ key: `c${i}`, title: String(i) })),
    frozenRows: 1_000_000, frozenColumns: 1000, dataSource: { getRowCount: () => 1_000_000, getRowId: row => row, getValue: () => { reads++; return ''; } } });
  const view = engine.getViewport({ width: 640, height: 320, scrollLeft: 10000, scrollTop: 10000000 });
  assert.equal(view.regions.length, 1);
  assert.deepEqual(view.regions[0].rows, { start: 0, end: 10 });
  assert.deepEqual(view.regions[0].columns, { start: 0, end: 4 });
  assert.deepEqual(view.hitTest(639, 319), { row: 9, col: 3 });
  assert.equal(reads, 0);
  assert.equal(engine.getViewport({ width: 0, height: 0, scrollLeft: 0, scrollTop: 0 }).regions.length, 0);
  assert.equal(engine.getViewport({ width: 10, height: 10, scrollLeft: 0, scrollTop: 0 }).regions.length, 1);
  const mixed = createGridEngine({ columns: engine.columns, frozenRows: 1, frozenColumns: 1, dataSource: { getRowCount: () => 1_000_000, getRowId: row => row, getValue: () => '' } });
  const scrolled = mixed.getViewport({ width: 640, height: 320, scrollLeft: 200, scrollTop: 50000 });
  assert.equal(scrolled.cellRect(0, 2).x, 120);
  assert.deepEqual(scrolled.hitTest(170, 10), { row: 0, col: 2 });
  assert.deepEqual(scrolled.hitTest(150, 10), { row: 0, col: 0 });
  const cells = new Set();
  for (const region of scrolled.regions) for (let row = region.rows.start; row < region.rows.end; row++) for (let col = region.columns.start; col < region.columns.end; col++) {
    assert.equal(cells.has(`${row}:${col}`), false);
    cells.add(`${row}:${col}`);
    const rect = scrolled.cellRect(row, col);
    const x = (Math.max(rect.x, rect.clip.x) + Math.min(rect.x + rect.width, rect.clip.x + rect.clip.width)) / 2;
    const y = (Math.max(rect.y, rect.clip.y) + Math.min(rect.y + rect.height, rect.clip.y + rect.clip.height)) / 2;
    assert.deepEqual(scrolled.hitTest(x, y), { row, col });
  }
  assert.ok(cells.size < 100);
});

test('zero-frozen, empty and fractional-size viewport queries preserve coordinates', () => {
  const { engine } = fixture();
  engine.setRowHeight(0, 32.5);
  engine.setColumnWidth(0, 160.5);
  const view = engine.getViewport({ width: 200, height: 40, scrollLeft: 20.5, scrollTop: 10.5 });
  assert.equal(view.regions.length, 1);
  assert.deepEqual(view.hitTest(140, 22), { row: 1, col: 1 });
  assert.equal(view.cellRect(0, 0).x, -20.5);
  assert.equal(view.cellRect(0, 0).y, -10.5);
  const empty = createGridEngine({ columns: [], dataSource: new LocalDataSource([], row => row.id) });
  const blank = empty.getViewport({ width: 200, height: 100, scrollLeft: 1000, scrollTop: 1000 });
  assert.equal(blank.regions.length, 0);
  assert.equal(blank.hitTest(0, 0), null);
  assert.equal(blank.scrollTop, 0);
});

test('multi-range state stays sparse and immutable while clipboard broadcasts atomically', () => {
  const events = [];
  const { engine, source } = fixture({ onEvent: event => events.push(event), resolveCellPermission: cell => cell.rowIndex === 1 && cell.columnIndex === 1 ? { selectable: false } : undefined });
  engine.select(0, 0); engine.select(1, 0, true);
  assert.equal(engine.addSelection(0, 1), true);
  assert.deepEqual(engine.getSelectionRanges(), [
    { startRow: 0, endRow: 1, startColumn: 0, endColumn: 0 },
    { startRow: 0, endRow: 0, startColumn: 1, endColumn: 1 },
  ]);
  assert.deepEqual(engine.getSelectionRange(), engine.getSelectionRanges()[1]);
  const copied = engine.getSelectionRanges(); copied[0].endRow = 999; copied.pop();
  assert.equal(engine.getSelectionRanges().length, 2); assert.equal(engine.getSelectionRanges()[0].endRow, 1);
  const event = events.at(-1); assert.ok(Object.isFrozen(event.ranges)); assert.ok(event.ranges.every(Object.isFrozen));
  assert.equal(engine.copySelection(), 'Ada\r\nGrace\r\n1');
  assert.equal(engine.canPaste(), true);
  engine.paste('10'); assert.equal(source.getValue(0, 'score'), 10); assert.equal(source.getValue(0, 'name'), '10');
  engine.undo(); assert.equal(source.getValue(0, 'score'), 1);
  assert.equal(engine.addSelection(1, 1), false); assert.equal(events.at(-1).type, 'cell:change');
  assert.throws(() => engine.addSelection(9, 0), RangeError); assert.deepEqual(engine.getSelectionRanges(), event.ranges);
  engine.editCell(0, 1, '3'); engine.undo(); engine.redo(); assert.equal(engine.getSelectionRanges().length, 2);
  engine.select(0, 1); assert.equal(engine.getSelectionRanges().length, 1); assert.equal(engine.copySelection(), '3');
  for (let i = 1; i < 128; i++) engine.addSelection(0, 0);
  const atLimit = engine.getSelectionRanges(); assert.throws(() => engine.addSelection(0, 0), /128 ranges/); assert.deepEqual(engine.getSelectionRanges(), atLimit);
  engine.clearSelection(); assert.deepEqual(engine.getSelectionRanges(), []); assert.deepEqual(events.at(-1).ranges, []);
  engine.addSelection(0, 0); engine.destroy(); assert.deepEqual(engine.getSelectionRanges(), []);
});


test('dynamic frozen prefixes validate atomically, preserve data history and update numeric geometry', () => {
  const events = []; const { engine, source, changes } = fixture({ onEvent: event => events.push(event) });
  engine.select(0, 0); engine.addSelection(1, 1); engine.editCell(1, 1, '4');
  const ranges = engine.getSelectionRanges(); engine.setFrozen(1, 1);
  assert.equal(engine.frozenRows, 1); assert.equal(engine.frozenColumns, 1);
  assert.deepEqual(engine.getSelectionRanges(), ranges); assert.equal(source.getValue(1, 'score'), 4);
  assert.deepEqual(events.at(-1), { type: 'freeze:change', previousRows: 0, previousColumns: 0, rows: 1, columns: 1 });
  assert.ok(Object.isFrozen(events.at(-1))); assert.deepEqual(changes.at(-1), { type: 'layout' });
  const view = engine.getViewport({ width: 200, height: 40, scrollLeft: 100, scrollTop: 20 });
  assert.deepEqual(view.hitTest(20, 16), { row: 0, col: 0 });
  assert.deepEqual(view.hitTest(180, 36), { row: 1, col: 1 });
  const eventCount = events.length; engine.setFrozen(1, 1); assert.equal(events.length, eventCount);
  for (const args of [[-1, 0], [0, 3], [3, 0], [0.5, 1], [1, NaN]]) assert.throws(() => engine.setFrozen(...args), RangeError);
  assert.equal(engine.frozenRows, 1); assert.equal(engine.frozenColumns, 1); assert.equal(events.length, eventCount);
  assert.equal(engine.undo(), true); assert.equal(source.getValue(1, 'score'), 4); assert.equal(engine.frozenRows, 0);
  assert.equal(engine.undo(),true); assert.equal(source.getValue(1,'score'),2);
  engine.setFrozen(0, 0); assert.equal(engine.getViewport({ width: 200, height: 40, scrollLeft: 100, scrollTop: 20 }).regions.length, 1);
  engine.destroy(); assert.throws(() => engine.setFrozen(1, 1), /destroyed/);
});


test('sparse scope locks veto every write path, preserve copy/history and cannot override admin policy', () => {
  const events = []; const { engine, source } = fixture({ onEvent: e => events.push(e), resolveCellPermission: c => c.rowIndex === 1 ? { writable: false } : undefined });
  const cell = { scope: 'cell', rowIndex: 0, columnIndex: 0 }; const row = { scope: 'row', rowIndex: 0 }; const column = { scope: 'column', columnIndex: 0 }; const table = { scope: 'table' };
  engine.select(0, 0); engine.editCell(0, 0, 'Changed');
  for (const target of [cell, row, column, table]) {
    engine.setLocked(target, true); assert.equal(engine.isLocked(target), true); assert.equal(engine.getCellPermission(0, 0).writable, false);
    assert.equal(engine.copySelection(), 'Changed'); assert.throws(() => engine.editCell(0, 0, 'Denied'), /cannot be edited/);
    assert.throws(() => engine.updateCells([{ rowIndex: 0, columnKey: 'name', value: 'Denied' }]), /writable/);
    assert.throws(() => engine.paste('Denied'), /pasteable/); assert.throws(() => engine.undo(), /writable/);
    assert.equal(source.getValue(0, 'name'), 'Changed'); assert.equal(engine.canUndo(), true);
    engine.setLocked(target, false); assert.equal(engine.getCellPermission(0, 0).writable, true);
  }
  engine.setLocked(row, true); engine.setLocked(cell, true); engine.setLocked(cell, false);
  assert.equal(engine.isLocked(cell), false); assert.equal(engine.getCellPermission(0, 0).writable, false); engine.setLocked(row, false);
  assert.equal(engine.undo(), true); assert.equal(source.getValue(0, 'name'), 'Ada');
  engine.setLocked({ scope: 'row', rowIndex: 1 }, true); engine.setLocked({ scope: 'row', rowIndex: 1 }, false);
  assert.equal(engine.getCellPermission(1, 0).writable, false);
  const count = events.length; engine.setLocked(table, false); assert.equal(events.length, count);
  for (const target of [{ scope: 'row', rowIndex: -1 }, { scope: 'column', columnIndex: 2 }, { scope: 'cell', rowIndex: 0, columnIndex: 0.5 }, { scope: 'unknown' }]) assert.throws(() => engine.setLocked(target, true));
  assert.throws(() => engine.setLocked(table, 'true'), TypeError);
  const lockEvent = events.filter(e => e.type === 'lock:change').at(-1); assert.ok(Object.isFrozen(lockEvent)); assert.ok(Object.isFrozen(lockEvent.target));
  const disabled = fixture({ allowLockChanges: false }).engine; assert.equal(disabled.canManageLocks(), false); assert.throws(() => disabled.setLocked(table, true), /disabled/);
  engine.destroy(); assert.equal(engine.canManageLocks(), false); assert.throws(() => engine.isLocked(cell), /destroyed/);
});


test('sparse formatting applies per-property precedence, shares data history and honors atomic admin veto', () => {
  let blocked = false; const events = [];
  const { engine, source } = fixture({ onEvent: e => events.push(e), resolveCellPermission: c => ({ ...(c.rowIndex === 1 ? { writable: false } : {}), ...(blocked && c.rowIndex === 0 && c.columnIndex === 1 ? { formatting: false } : {}) }) });
  const cell = { scope: 'cell', rowIndex: 0, columnIndex: 0 }; const column = { scope: 'column', columnIndex: 0 }; const range = { scope: 'range', range: { startRow: 0, endRow: 0, startColumn: 0, endColumn: 1 } };
  engine.format([column], { background: '#ff0000' }); engine.format([cell], { textColor: '#112233' });
  engine.format([{ scope: 'row', rowIndex: 0 }], { background: '#00ff00' }); engine.format([cell], { background: '#0000ff' });
  assert.deepEqual(engine.getFormat(0, 0), { background: '#0000ff', textColor: '#112233' });
  engine.format([column], { background: '#ff0000', textColor: '#abcdef' }); engine.format([cell], { textColor: '#123456' });
  engine.format([column], { background: '#00ffff' }); assert.deepEqual(engine.getFormat(0, 0), { background: '#00ffff', textColor: '#123456' });
  engine.format([range], { background: null, textColor: null }); assert.deepEqual(engine.getFormat(0, 0), {}); assert.deepEqual(engine.getFormat(0, 1), {});
  assert.deepEqual(engine.getFormat(1, 0), { background: '#00ffff', textColor: '#abcdef' });
  engine.select(0, 0); engine.editCell(0, 0, 'Changed'); engine.undo(); assert.equal(source.getValue(0, 'name'), 'Ada'); assert.deepEqual(engine.getFormat(0, 0), {});
  engine.undo(); assert.deepEqual(engine.getFormat(0, 0), { background: '#00ffff', textColor: '#123456' });
  const before = engine.getFormat(1, 0); blocked = true;
  assert.equal(engine.canFormat([range]), false); assert.throws(() => engine.format([{ scope: 'cell', rowIndex: 1, columnIndex: 0 }, { scope: 'cell', rowIndex: 0, columnIndex: 1 }], { background: '#000000' }), /formatting/);
  assert.deepEqual(engine.getFormat(1, 0), before); assert.equal(engine.canRedo(), true); assert.throws(() => engine.redo(), /formatting/); assert.equal(engine.canRedo(), true);
  blocked = false; engine.redo(); assert.deepEqual(engine.getFormat(0, 0), {});
  engine.setLocked({ scope: 'table' }, true); engine.format([cell], { background: '#f00' }); assert.equal(engine.getCellPermission(0, 0).writable, false); assert.equal(engine.getCellPermission(0, 0).formatting, true);
  assert.deepEqual(engine.getFormat(0, 0), { background: '#f00' }); engine.undo(); assert.deepEqual(engine.getFormat(0, 0), {});
  const count = events.length;
  for (const patch of [{ background: 'red' }, { background: '#xx0000' }, { unknown: '#000000' }]) assert.throws(() => engine.format([cell], patch), TypeError);
  assert.throws(() => engine.format([{ scope: 'range', range: {} }], { background: '#000000' }), RangeError); assert.equal(events.length, count);
  const event = events.filter(e => e.type === 'format:change').at(-1); assert.equal(event.source, 'undo'); assert.ok(Object.isFrozen(event)); assert.ok(Object.isFrozen(event.changes)); assert.ok(Object.isFrozen(event.changes[0].target));
  assert.throws(() => { engine.getFormat(1, 0).background = '#000000'; }, TypeError);
  const veto = fixture({ permissions: { formatting: false }, resolveCellPermission: () => ({ formatting: true }) }).engine;
  assert.throws(() => veto.format([cell], { background: '#000000' }), /formatting/); veto.updateCells([{ rowIndex: 0, columnKey: 'name', value: 'Allowed value write' }]);
});

test('million-row column formatting retains one sparse target and reads no source values or identities', () => {
  let reads = 0; let identities = 0; const events = [];
  const engine = createGridEngine({ columns: [{ key: 'name', title: 'Name' }], dataSource: { getRowCount: () => 1_000_000, getRowId: row => { identities++; return row; }, getValue: () => { reads++; return 'Ada'; } }, onEvent: event => events.push(event) });
  engine.format([{ scope: 'column', columnIndex: 0 }], { background: '#123456' }); assert.deepEqual(engine.getFormat(999_999, 0), { background: '#123456' });
  assert.equal(events.at(-1).changes.length, 1); assert.equal(reads, 0); assert.equal(identities, 0);
  engine.undo(); assert.deepEqual(engine.getFormat(999_999, 0), {}); engine.redo(); assert.equal(engine.getFormat(0, 0).background, '#123456');
});


test('scope ranges are atomic, sparse and respect endpoint selection permissions', () => {
  const events = []; let reads = 0;
  const engine = createGridEngine({ columns: [{ key: 'a', title: 'A' }, { key: 'b', title: 'B' }],
    dataSource: { getRowCount: () => 1_000_000, getRowId: row => row, getValue: () => { reads++; return ''; } },
    resolveCellPermission: cell => cell.rowIndex === 4 ? { selectable: false } : undefined, onEvent: event => events.push(event) });
  const range = { startRow: 0, endRow: 999999, startColumn: 1, endColumn: 1 };
  assert.equal(engine.selectRange(range), true); range.endRow = 5;
  assert.deepEqual(engine.getSelectionRange(), { ...range, endRow: 999999 });
  assert.equal(events.length, 1); assert.equal(reads, 0);
  assert.equal(engine.selectRange({ startRow: 0, endRow: 4, startColumn: 0, endColumn: 1 }), false);
  assert.equal(engine.getSelectionRange().endRow, 999999);
  assert.throws(() => engine.selectRange({ startRow: 2, endRow: 1, startColumn: 0, endColumn: 1 }), RangeError);
  assert.equal(events.length, 1); engine.destroy();
});

test('local views combine filters, stable numeric sorting and mapped atomic writes', () => {
  const source = new LocalDataSource([{ id: 'a', score: 10, team: 'Design' }, { id: 'b', score: 2, team: 'design' }, { id: 'c', score: null, team: '' }, { id: 'd', score: 2, team: 'Ops' }], row => row.id);
  const view = new LocalDataView(source, { sort: { columnKey: 'score', direction: 'asc' }, filters: [{ columnKey: 'team', query: 'DES', operator: 'contains' }] });
  assert.equal(view.getRowCount(), 2); assert.equal(view.getRowId(0), 'b'); assert.equal(view.getRowId(1), 'a');
  view.setValues([{ rowIndex: 0, columnKey: 'score', value: 9 }, { rowIndex: 1, columnKey: 'score', value: 3 }]);
  assert.equal(source.getValue(1, 'score'), 9); assert.equal(source.getValue(0, 'score'), 3);
  assert.equal(view.getRowId(0), 'b'); // reapply is explicit, so a mounted view keeps row identity
  const sorted = new LocalDataView(source, { sort: { columnKey: 'score', direction: 'desc' } });
  assert.deepEqual(Array.from({ length: 4 }, (_, index) => sorted.getRowId(index)), ['b', 'a', 'd', 'c']);
  assert.equal(new LocalDataView(source, { filters: [{ columnKey: 'team', query: '', operator: 'empty' }] }).getRowId(0), 'c');
  assert.equal(new LocalDataView(source, { filters: [{ columnKey: 'team', query: '', operator: 'not-empty' }, { columnKey: 'score', query: '2', operator: 'equals' }] }).getRowId(0), 'd');
  assert.throws(() => view.setValues([{ rowIndex: 0, columnKey: 'score', value: 12 }, { rowIndex: 99, columnKey: 'score', value: 5 }]), RangeError);
  assert.equal(source.getValue(1, 'score'), 9);
  assert.throws(() => new LocalDataView(source, { sort: { columnKey: 'score', direction: 'bad' } }), TypeError);
  assert.throws(() => new LocalDataView(source, { filters: [{ columnKey: 'team', query: '', operator: 'bad' }] }), TypeError);
  const readonly = new LocalDataView({ getRowCount: () => 1, getRowId: () => 0, getValue: () => 'x' });
  assert.equal(readonly.setValue, undefined); assert.equal(readonly.setValues, undefined);
});


test('axis ranges add and extend atomically without source reads or losing retained ranges', () => {
  const { engine, source } = fixture(); let reads = 0; source.getValue = () => { reads++; return ''; };
  const first = { startRow: 0, endRow: 0, startColumn: 0, endColumn: 1 };
  const second = { startRow: 1, endRow: 1, startColumn: 0, endColumn: 1 };
  engine.selectRange(first); engine.selectRange(second, 'add');
  assert.deepEqual(engine.getSelectionRanges(), [first, second]);
  engine.selectRange({ ...second, startRow: 0 }, 'extend');
  assert.deepEqual(engine.getSelectionRanges(), [first, { ...second, startRow: 0 }]);
  assert.throws(() => engine.selectRange(first, 'invalid'), TypeError);
  for (let i = 2; i < 128; i++) engine.selectRange(first, 'add');
  const before = engine.getSelectionRanges();
  assert.throws(() => engine.selectRange(second, 'add'), RangeError);
  assert.deepEqual(engine.getSelectionRanges(), before); assert.equal(reads, 0);
  engine.selectRange(second); assert.deepEqual(engine.getSelectionRanges(), [second]);
  engine.destroy();
});


test('structural commands retain IDs, sparse state, hidden fields and mixed history', () => {
  const source=new LocalDataSource(Array.from({length:5},(_,id)=>({id,name:'Row '+id,score:id,hidden:{id}})),row=>row.id);
  const events=[];
  const engine=createGridEngine({dataSource:source,columns:[{key:'name',title:'Name',editable:true},{key:'score',title:'Score',editable:true,parse:Number}],onEvent:e=>events.push(e)});
  engine.editCell(3,0,'Changed');
  engine.selectRange({startRow:1,endRow:3,startColumn:0,endColumn:1});
  engine.setRowHeight(3,60); engine.setColumnWidth(0,180);
  engine.format([{scope:'range',range:{startRow:1,endRow:3,startColumn:0,endColumn:0}}],{background:'#abc'});
  engine.setLocked({scope:'cell',rowIndex:3,columnIndex:1},true);
  engine.insertRows(2,[{id:9,values:{id:9,name:'New',score:9,hidden:'extra'}}]);
  assert.equal(engine.rowCount,6); assert.equal(engine.rows.size(4),60);
  assert.equal(engine.isLocked({scope:'cell',rowIndex:4,columnIndex:1}),true);
  assert.equal(engine.getFormat(2,0).background,undefined);assert.equal(engine.getFormat(4,0).background,'#abc');
  assert.deepEqual(engine.getSelectionRanges().map(r=>[r.startRow,r.endRow]).sort((a,b)=>a[0]-b[0]),[[1,1],[3,4]]);
  engine.moveRows([1,4],6);
  assert.deepEqual(Array.from({length:6},(_,i)=>source.getRowId(i)),[0,9,2,4,1,3]);
  assert.equal(engine.rows.size(5),60);assert.equal(engine.getValue(5,'name'),'Changed');
  engine.moveColumns([0],2);assert.deepEqual(engine.columns.map(c=>c.key),['score','name']);
  assert.equal(engine.columnsLayout.size(1),180);assert.equal(engine.isLocked({scope:'cell',rowIndex:5,columnIndex:0}),true);
  assert.equal(engine.getFormat(5,1).background,'#abc');
  engine.setLocked({scope:'row',rowIndex:0},true);
  assert.equal(engine.undo(),true);assert.equal(engine.isLocked({scope:'row',rowIndex:0}),true);
  assert.equal(engine.undo(),true);assert.equal(engine.undo(),true);
  assert.equal(engine.rowCount,5);assert.equal(engine.getValue(3,'name'),'Changed');
  assert.equal(engine.rows.size(3),60);assert.equal(engine.isLocked({scope:'cell',rowIndex:3,columnIndex:1}),true);
  engine.setLocked({scope:'cell',rowIndex:3,columnIndex:1},false);
  engine.deleteRows([1,3]);assert.equal(engine.rowCount,3);assert.equal(source.getRowId(1),2);
  assert.equal(engine.undo(),true);assert.equal(source.getRowId(3),3);assert.deepEqual(source.getRow(3).values.hidden,{id:3});
  assert.equal(engine.redo(),true);assert.equal(engine.undo(),true);
  assert.ok(events.some(e=>e.type==='structure:change'&&e.source==='undo'));
});

test('structural denial, invalid IDs and source failures leave state and history intact', () => {
  let allowed=true;
  const source=new LocalDataSource([{id:1,name:'One'},{id:2,name:'Two'}],r=>r.id);
  const engine=createGridEngine({dataSource:source,columns:[{key:'name',title:'Name',editable:true}],canChangeStructure:()=>allowed});
  engine.select(1,0);
  assert.throws(()=>engine.insertRows(0,[{id:1,values:{name:'Duplicate'}}]),/Duplicate/);
  assert.equal(engine.rowCount,2);assert.equal(engine.canUndo(),false);assert.equal(engine.getSelection().rowId,2);
  allowed=false;assert.throws(()=>engine.deleteRows([0]),/disabled/);assert.equal(source.getRowCount(),2);
  allowed=true;engine.deleteRows([0]);allowed=false;
  assert.throws(()=>engine.undo(),/disabled/);assert.equal(engine.rowCount,1);assert.equal(engine.canUndo(),true);
  allowed=true;engine.undo();engine.moveRows([0],2);
  source.setValue(1,'name','External');
  assert.throws(()=>engine.undo(),/conflicts/);assert.equal(engine.getValue(1,'name'),'External');
});

test('resize and freeze undo in order; automatic measurement stays outside history', () => {
  const {engine}=fixture();
  engine.measureRowHeight(0,40);assert.equal(engine.canUndo(),false);
  engine.setRowHeight(0,60);engine.setColumnWidth(1,200);engine.setFrozen(1,1);
  engine.undo();assert.equal(engine.frozenRows,0);assert.equal(engine.rows.size(0),60);
  engine.undo();assert.equal(engine.columnsLayout.size(1),160);
  engine.undo();assert.equal(engine.rows.size(0),40);
  engine.redo();engine.redo();engine.redo();assert.equal(engine.frozenColumns,1);
});


test('column insertion/deletion keeps source fields, formats, selection and edit history', () => {
  const {engine,source}=fixture();
  engine.select(1,1);engine.setColumnWidth(1,210);engine.format([{scope:'column',columnIndex:1}],{textColor:'#123'});
  engine.insertColumns(1,[{key:'extra',title:'Extra',editable:true}]);
  assert.deepEqual(engine.columns.map(c=>c.key),['name','extra','score']);
  assert.equal(engine.getSelection().columnKey,'score');assert.equal(engine.getSelection().columnIndex,2);
  assert.equal(engine.columnsLayout.size(2),210);assert.equal(engine.getFormat(1,2).textColor,'#123');
  engine.editCell(0,1,'Added');engine.deleteColumns([1,2]);
  assert.deepEqual(engine.columns.map(c=>c.key),['name']);assert.equal(source.getValue(0,'extra'),'Added');
  engine.undo();assert.equal(engine.getValue(0,'extra'),'Added');engine.undo();assert.equal(engine.getValue(0,'extra'),undefined);
  engine.undo();assert.deepEqual(engine.columns.map(c=>c.key),['name','score']);
  engine.redo();assert.equal(engine.getSelection().columnIndex,2);
  engine.deleteColumns([0,1,2]);assert.equal(engine.columns.length,0);assert.equal(engine.getSelection(),null);
  engine.undo();assert.equal(engine.columns.length,3);
});

test('empty tables and full row deletion restore dimensions and table formatting', () => {
  const source=new LocalDataSource([],r=>r.id),engine=createGridEngine({dataSource:source,columns:[{key:'name',title:'Name',editable:true}]});
  engine.insertRows(0,[{id:1,values:{name:'One'}},{id:2,values:{name:'Two'}}]);engine.setFrozen(2,1);
  engine.format([{scope:'table'}],{background:'#abc'});engine.select(1,0);engine.setRowHeight(1,77);
  engine.deleteRows([0,1]);assert.equal(engine.rowCount,0);assert.equal(engine.frozenRows,0);
  engine.undo();assert.equal(engine.rowCount,2);assert.equal(engine.frozenRows,2);assert.equal(engine.rows.size(1),77);assert.equal(engine.getFormat(1,0).background,'#abc');
});


test('structural source failures are atomic and a mixed operation sequence fully replays', () => {
  const rows=Array.from({length:8},(_,id)=>({id,name:'Row '+id,score:id})),source=new LocalDataSource(rows,r=>r.id);
  const options={columns:[{key:'name',title:'Name',editable:true},{key:'score',title:'Score',editable:true,parse:Number}]};
  const broken=createGridEngine({...options,dataSource:{getRowCount:()=>source.getRowCount(),getRowId:i=>source.getRowId(i),getValue:(i,k)=>source.getValue(i,k),getRow:i=>source.getRow(i),spliceRows:()=>{throw new Error('Source failed');}}});
  broken.select(2,0);
  assert.throws(()=>broken.moveRows([2],8),/Source failed/);
  assert.equal(broken.canUndo(),false);assert.equal(broken.getSelection().rowIndex,2);assert.equal(source.getRowId(2),2);
  const engine=createGridEngine({...options,dataSource:source});
  engine.select(4,0);engine.setRowHeight(4,70);engine.format([{scope:'row',rowIndex:4}],{background:'#abc'});
  engine.moveRows([1,4,6],8);engine.insertColumns(1,[{key:'extra',title:'Extra',editable:true}]);
  engine.editCell(0,1,'Extra');engine.insertRows(2,[{id:99,values:{id:99,name:'New',score:99}}]);
  engine.moveColumns([0,2],3);engine.deleteRows([1,4]);engine.deleteColumns([1]);engine.setFrozen(2,1);
  let count=0;while(engine.undo())count++;
  assert.equal(count,10);assert.equal(engine.rowCount,8);assert.deepEqual(engine.columns.map(c=>c.key),['name','score']);
  assert.deepEqual(Array.from({length:8},(_,i)=>[source.getRowId(i),source.getValue(i,'name')]),rows.map(r=>[r.id,r.name]));
  assert.equal(engine.rows.size(4),32);assert.equal(engine.getFormat(4,0).background,undefined);
  let replayed=0;while(engine.redo())replayed++;
  assert.equal(replayed,count);assert.equal(engine.rowCount,7);assert.equal(engine.frozenRows,2);
});


test('managed views preserve record state and history, refresh edits and never select hidden rows', () => {
  const source=new LocalDataSource([{id:'a',name:'C',score:1},{id:'b',name:'A',score:2},{id:'c',name:'B',score:3},{id:'d',name:'D',score:4}],row=>row.id);
  const events=[], invalidations=[];
  const engine=createGridEngine({dataSource:source,columns:[{key:'name',title:'Name',editable:true},{key:'score',title:'Score',editable:true,parse:Number}],onEvent:e=>events.push(e),onInvalidate:e=>invalidations.push(e)});
  engine.select(0,0); engine.setRowHeight(0,70); engine.format([{scope:'row',rowIndex:0}],{background:'#abcdef'}); engine.setLocked({scope:'cell',rowIndex:0,columnIndex:1},true);
  engine.setView({sort:{columnKey:'name',direction:'asc'}});
  assert.equal(engine.getSelection().rowId,'a'); assert.equal(engine.getSelection().rowIndex,2);
  engine.selectRange({startRow:0,endRow:2,startColumn:0,endColumn:0}); assert.equal(engine.getSelection().rowId,'b'); assert.equal(engine.getSelection().rowIndex,0); assert.deepEqual(engine.getSelectionRange(),{startRow:0,endRow:2,startColumn:0,endColumn:0}); engine.select(2,0);
  assert.equal(engine.rows.size(2),70); assert.equal(engine.getFormat(2,0).background,'#abcdef'); assert.equal(engine.isLocked({scope:'cell',rowIndex:2,columnIndex:1}),true);
  engine.editCell(2,0,'0'); assert.equal(source.getValue(0,'name'),'0'); assert.equal(engine.getSelection().rowIndex,0);
  assert.equal(engine.undo(),true); assert.equal(engine.getSelection().rowIndex,2); assert.equal(source.getValue(0,'name'),'C');
  assert.equal(engine.redo(),true); assert.equal(engine.getSelection().rowIndex,0);
  engine.setView({filters:[{columnKey:'score',query:'2',operator:'equals'}]}); assert.equal(engine.rowCount,1); assert.equal(engine.sourceRowCount,4); assert.equal(engine.getSelection(),null);
  engine.select(0,0); engine.editCell(0,0,'Only B'); assert.equal(source.getValue(1,'name'),'Only B');
  engine.updateCells([{rowIndex:0,columnKey:'score',value:5}]); assert.equal(engine.rowCount,0); engine.undo(); assert.equal(engine.rowCount,1); assert.equal(engine.getRowId(0),'b');
  assert.throws(()=>engine.setView({sort:{columnKey:'missing',direction:'asc'}}),/Unknown view column/); assert.equal(engine.rowCount,1);
  assert.throws(()=>engine.deleteRows([0]),/permission|denied|structur/i); assert.equal(source.getRowCount(),4);
  engine.setView({filters:[{columnKey:'name',query:'B'}]}); assert.equal(engine.rowCount,2);
  engine.selectRange({startRow:0,endRow:1,startColumn:0,endColumn:0}); engine.format([{scope:'range',range:engine.getSelectionRange()}],{textColor:'#123456'});
  assert.equal(engine.copySelection(),'Only B\r\nB'); engine.paste('Selected\r\nSelected');
  assert.equal(source.getValue(1,'name'),'Selected'); assert.equal(source.getValue(2,'name'),'Selected'); assert.equal(source.getValue(0,'name'),'0');
  engine.undo(); engine.setView({}); assert.equal(engine.rowCount,4); assert.equal(engine.rows.size(0),70); assert.equal(engine.getFormat(1,0).textColor,'#123456'); assert.deepEqual(engine.getFormat(3,0),{});
  assert.ok(events.some(event=>event.type==='view:change')); assert.ok(invalidations.some(change=>change.type==='structure'));
});

test('structured clipboard preserves holes, supports paired ranges and validates before writes', () => {
  const source=new LocalDataSource(Array.from({length:6},(_,id)=>({id,a:String(id),b:'keep',c:String(id+10)})),row=>row.id);
  const engine=createGridEngine({dataSource:source,columns:['a','b','c'].map(key=>({key,title:key,editable:true}))});
  engine.select(0,0); engine.addSelection(0,2); const blocks=engine.copySelectionBlocks(); assert.equal(engine.copySelection(),'0\t10');
  engine.select(2,0); engine.pasteSelectionBlocks(blocks); assert.equal(source.getValue(2,'a'),'0'); assert.equal(source.getValue(2,'b'),'keep'); assert.equal(source.getValue(2,'c'),'10');
  engine.undo(); assert.equal(source.getValue(2,'a'),'2'); assert.equal(source.getValue(2,'c'),'12'); engine.redo();
  engine.select(3,0); engine.addSelection(4,2); engine.pasteSelectionBlocks(blocks); assert.equal(source.getValue(3,'a'),'0'); assert.equal(source.getValue(4,'c'),'10');
  engine.addSelection(5,0); assert.throws(()=>engine.pasteSelectionBlocks(blocks),/counts must match/);
  engine.select(5,2); assert.throws(()=>engine.pasteSelectionBlocks(blocks),/bounds/); assert.equal(source.getValue(5,'c'),'15');
  assert.throws(()=>engine.pasteSelectionBlocks('{"version":1,"blocks":[{"row":0,"column":0,"values":[[7]]}]}'),/clipboard/i);
  engine.select(0,0); engine.addSelection(1,0); engine.setLocked({scope:'row',rowIndex:1},true);
  assert.throws(()=>engine.paste('denied'),/pasteable/); assert.equal(source.getValue(0,'a'),'0');
});

test('inserted column defaults and hidden values survive structural replay and new rows', () => {
  const {engine,source}=fixture();
  engine.insertColumns(1,[{key:'extra',title:'Extra',editable:true,defaultValue:'initial'}]);
  assert.equal(source.getValue(0,'extra'),'initial'); engine.undo(); engine.redo(); assert.equal(source.getValue(1,'extra'),'initial');
  engine.updateCells([{rowIndex:0,columnKey:'extra',value:'edited'}]); engine.deleteColumns([1]); engine.undo(); assert.equal(source.getValue(0,'extra'),'edited');
  engine.insertRows(2,[{id:3,values:{id:3,name:'New',score:3}}]); assert.equal(source.getValue(2,'extra'),'initial'); engine.undo(); engine.redo(); assert.equal(source.getValue(2,'extra'),'initial');
});

test('column validation rejects a batch atomically and can allow invalid values',()=>{
 const source=new LocalDataSource([{id:1,a:'ok',b:'ok'}],r=>r.id);
 const engine=createGridEngine({dataSource:source,columns:[{key:'a',title:'Reject',editable:true,validate:v=>v==='bad'?'Invalid':undefined},{key:'b',title:'Allow',editable:true,invalidInput:'allow',validate:v=>v==='bad'?'Invalid':undefined}]});
 assert.throws(()=>engine.updateCells([{rowIndex:0,columnKey:'b',value:'changed'},{rowIndex:0,columnKey:'a',value:'bad'}]),/Invalid/);
 assert.equal(source.getValue(0,'b'),'ok');
 engine.updateCells([{rowIndex:0,columnKey:'b',value:'bad'}]);assert.equal(source.getValue(0,'b'),'bad');engine.undo();assert.equal(source.getValue(0,'b'),'ok');
});
