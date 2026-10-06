import test from 'node:test';
import assert from 'node:assert/strict';
import { createGridEngine, LocalDataSource } from '@acheron-grid/core';
import { exportSelectionCsv } from '../dist/index.js';

function fixture(rows, columns = [{ key: 'a', title: 'A' }, { key: 'b', title: 'B' }]) {
  const engine = createGridEngine({ dataSource: new LocalDataSource(rows, (_, i) => i), columns });
  engine.selectRange({ startRow: 0, endRow: rows.length - 1, startColumn: 0, endColumn: columns.length - 1 });
  return engine;
}

test('CSV preserves Unicode, separators, multiline fields and quotes with optional headers/BOM', () => {
  const engine = fixture([{ a: 'Việt, Nam', b: '"quoted"\r\nnext' }, { a: 'plain', b: null }]);
  assert.equal(exportSelectionCsv(engine, { includeHeaders: true, bom: true }), '\uFEFFA,B\r\n"Việt, Nam","""quoted""\r\nnext"\r\nplain,');
  engine.destroy();
});

test('CSV escapes leading control characters and full-width formula operators',()=>{
  for(const value of ['\tplain','\rplain','\nplain','\u0000=1+1','＝1+1','＋1','－1','＠SUM(A1)']){
    const engine=fixture([{a:value,b:'safe'}]);assert.equal(exportSelectionCsv(engine).startsWith(value.includes('\r')||value.includes('\n')?'"\'':'\''),true);engine.destroy();
  }
});

test('formula-like text is escaped by default and preserve is explicit', () => {
  const engine = fixture([{ a: '=1+1', b: -3 }, { a: ' \t@SUM(A1)', b: '+123' }]);
  assert.equal(exportSelectionCsv(engine), "'=1+1,'-3\r\n' \t@SUM(A1),'+123");
  assert.equal(exportSelectionCsv(engine, { formulaProtection: 'preserve' }), '=1+1,-3\r\n \t@SUM(A1),+123');
  assert.throws(() => exportSelectionCsv(engine, { formulaProtection: 'invalid' }), TypeError);
  engine.destroy();
});

test('CSV follows visible order/merge placeholders and rejects non-copyable cells and disjoint selection', () => {
  const engine = fixture([{ a: 'B', b: 1 }, { a: 'A', b: 2 }]);
  engine.setView({ sorts: [{ columnKey: 'a', direction: 'asc' }] });
  assert.equal(exportSelectionCsv(engine), 'A,2\r\nB,1');
  engine.setView({});
  engine.mergeCells({ startRow: 0, endRow: 0, startColumn: 0, endColumn: 1 });
  assert.equal(exportSelectionCsv(engine), 'B,\r\nA,2');
  engine.clearSelection(); assert.throws(() => exportSelectionCsv(engine), /one rectangular/);
  engine.selectRange({ startRow: 0, endRow: 0, startColumn: 0, endColumn: 1 });
  engine.selectRange({ startRow: 1, endRow: 1, startColumn: 0, endColumn: 1 }, 'add');
  assert.throws(() => exportSelectionCsv(engine), /one rectangular/);
  engine.destroy();
  const denied = fixture([{ a: 'private' }], [{ key: 'a', title: 'A', permissions: { copyable: false } }]);
  assert.throws(() => exportSelectionCsv(denied), /copyable/); denied.destroy();
});

test('headers and escaping count toward the output budget', () => {
  const engine = fixture([{ a: 'x' }], [{ key: 'a', title: 'h'.repeat(10_000_000) }]);
  assert.throws(() => exportSelectionCsv(engine, { includeHeaders: true }), /CSV output is too large/);
  assert.equal(exportSelectionCsv(engine), 'x'); engine.destroy();
});
