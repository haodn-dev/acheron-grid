import test from 'node:test';
import assert from 'node:assert/strict';
import { createGridEngine, LocalDataSource, encodeBlocks } from '@acheron-grid/core';
import { exportSelectionXlsx } from '../dist/index.js';
import { unzipSync, strFromU8 } from 'fflate';
function fixture(rows, permissions) {
  const engine = createGridEngine({
    columns: [
      { key: 'text', title: 'Text' },
      { key: 'value', title: 'Value' },
    ],
    dataSource: new LocalDataSource(rows, (_, i) => i),
    ...(permissions ? { permissions } : {}),
  });
  engine.selectRange({ startRow: 0, endRow: rows.length - 1, startColumn: 0, endColumn: 1 });
  return engine;
}

test('XLSX rejects invalid names and boolean flags before reading values; preserves XML escaping', () => {
  const engine = fixture([{ text: '<&>"\'\r\n_x0041_', value: true }]);
  try {
    for (const sheetName of ['', 'x'.repeat(32), "'start", "end'", 'a[b', 'a:b', 'a*b', 'a?b', 'a/b', 'a\\b', 123])
      assert.throws(() => exportSelectionXlsx(engine, { sheetName }), TypeError);
    for (const includeHeaders of [null, 'true', 1])
      assert.throws(() => exportSelectionXlsx(engine, { includeHeaders }), TypeError);
    const files = unzipSync(exportSelectionXlsx(engine, { includeHeaders: true, sheetName: 'A&B' }));
    const sheet = strFromU8(files['xl/worksheets/sheet1.xml']);
    assert.match(sheet, /&lt;&amp;&gt;&quot;&apos;&#13;/);
    assert.match(sheet, /_x005F_x0041_/);
    assert.match(strFromU8(files['xl/workbook.xml']), /A&amp;B/);
    engine.clearSelection();
    assert.throws(() => exportSelectionXlsx(engine), /rectangular/);
  } finally {
    engine.destroy();
  }
});
test('XLSX preserves scalar types, Unicode and literal formula strings in a valid package', () => {
  const engine = fixture([
    { text: '=1+1 Việt 😃 & <', value: -3 },
    { text: '_x000A_', value: true },
  ]);
  const files = unzipSync(exportSelectionXlsx(engine, { includeHeaders: true, sheetName: 'Data' }));
  const xml = strFromU8(files['xl/worksheets/sheet1.xml']);
  assert.match(xml, /<c r="B2"><v>-3<\/v><\/c>/);
  assert.match(xml, /<c r="B3" t="b"><v>1<\/v><\/c>/);
  assert.match(xml, /=1\+1 Việt 😃 &amp; &lt;/);
  assert.match(xml, /_x005F_x000A_/);
  assert.doesNotMatch(xml, /<f[ >]/);
  assert.equal(Object.keys(files).length, 5);
  assert.match(strFromU8(files['xl/workbook.xml']), /name="Data"/);
  engine.destroy();
  const names = fixture([{ text: 'first\r\nnext', value: 1 }]);
  const parts = unzipSync(exportSelectionXlsx(names, { sheetName: '_x000A_' }));
  assert.match(strFromU8(parts['xl/workbook.xml']), /name="_x000A_"/);
  assert.match(strFromU8(parts['xl/worksheets/sheet1.xml']), /first&#13;\nnext/);
  names.destroy();
});
test('XLSX enforces permissions, XML/name/text limits and merge placeholders', () => {
  const denied = fixture([{ text: 'secret', value: 1 }], { copyable: false });
  assert.throws(() => exportSelectionXlsx(denied), /copyable/);
  denied.destroy();
  const engine = fixture([{ text: 'x', value: 99 }]);
  engine.mergeCells({ startRow: 0, endRow: 0, startColumn: 0, endColumn: 1 });
  assert.doesNotMatch(strFromU8(unzipSync(exportSelectionXlsx(engine))['xl/worksheets/sheet1.xml']), />99</);
  assert.throws(() => exportSelectionXlsx(engine, { sheetName: 'bad/name' }), TypeError);
  engine.destroy();
  for (const text of ['\u0000', '\ud800', 'a'.repeat(32768)]) {
    const invalid = fixture([{ text, value: 0 }]);
    assert.throws(() => exportSelectionXlsx(invalid));
    invalid.destroy();
  }
});

test('XLSX enforces column and escaped XML budgets and names the last supported column', () => {
  let reads = 0;
  const columns = Array.from({ length: 16385 }, (_, index) => ({ key: `c${index}`, title: `C${index}` }));
  const source = {
    columns,
    getSelectionRanges: () => [{ startRow: 0, endRow: 0, startColumn: 0, endColumn: columns.length - 1 }],
    copySelectionBlocks: () => encodeBlocks([{ row: 0, column: 0, values: [columns.map(() => 'x')] }]),
    getValue: () => {
      reads++;
      return 'x';
    },
  };
  assert.throws(() => exportSelectionXlsx(source), /Excel sheet dimensions exceeded/);
  assert.equal(reads, 0);
  columns.pop();
  const files = unzipSync(exportSelectionXlsx(source));
  assert.match(strFromU8(files['xl/worksheets/sheet1.xml']), /r="XFD1"/);
  assert.equal(reads, 16384);
  columns.length = 1400;
  for (const column of columns) column.title = 'あ'.repeat(10000);
  assert.throws(() => exportSelectionXlsx(source, { includeHeaders: true }), /XLSX byte budget exceeded/);
  const engine = fixture(Array.from({ length: 125 }, () => ({ text: '&'.repeat(32760), value: 1 })));
  try {
    assert.throws(() => exportSelectionXlsx(engine), /XLSX XML budget exceeded/);
    assert.equal(engine.canUndo(), false);
  } finally {
    engine.destroy();
  }
});
