import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createGridEngine, LocalDataSource } from '@acheron-grid/core/headless';

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
