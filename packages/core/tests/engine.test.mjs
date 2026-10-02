import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createGridEngine, LocalDataSource } from '@acheron-grid/core';

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
  engine.select(1, 1, true);
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
  assert.throws(() => throwing.updateCells([{ rowIndex: 0, columnKey: 'name', value: 'Committed' }]), /Renderer failed/);
  assert.equal(throwing.getValue(0, 'name'), 'Committed');
  assert.equal(throwing.canUndo(), true);
});

test('capabilities preserve defaults, deny veto and immutable scope snapshots', () => {
  const policy = { writable: false };
  const { engine } = fixture({ permissions: policy, resolveCellPermission: () => ({ writable: true, editable: true }) });
  policy.writable = true;
  assert.deepEqual(engine.getCellPermission(0, 0), { editable: false, pasteable: false, selectable: true, copyable: true, writable: false });
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
  assert.throws(() => failing.updateCells([{ rowIndex: 0, columnKey: 'name', value: 'Committed' }]), thrown => thrown === error);
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

test('multi-range state stays sparse, immutable and rejects ambiguous clipboard operations', () => {
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
  assert.throws(() => engine.copySelection(), /single selection range/);
  assert.throws(() => engine.paste('10'), /single selection range/);
  assert.equal(engine.canPaste(), false); assert.equal(source.getValue(0, 'score'), 1);
  assert.equal(engine.addSelection(1, 1), false); assert.equal(events.at(-1), event);
  assert.throws(() => engine.addSelection(9, 0), RangeError); assert.deepEqual(engine.getSelectionRanges(), event.ranges);
  engine.editCell(0, 1, '3'); engine.undo(); engine.redo(); assert.equal(engine.getSelectionRanges().length, 2);
  engine.select(0, 1); assert.equal(engine.getSelectionRanges().length, 1); assert.equal(engine.copySelection(), '3');
  for (let i = 1; i < 128; i++) engine.addSelection(0, 0);
  const atLimit = engine.getSelectionRanges(); assert.throws(() => engine.addSelection(0, 0), /128 ranges/); assert.deepEqual(engine.getSelectionRanges(), atLimit);
  engine.clearSelection(); assert.deepEqual(engine.getSelectionRanges(), []); assert.deepEqual(events.at(-1).ranges, []);
  engine.addSelection(0, 0); engine.destroy(); assert.deepEqual(engine.getSelectionRanges(), []);
});
