import test from 'node:test';
import assert from 'node:assert/strict';
import { createGridEngine, LocalDataSource } from '@acheron-grid/core';
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
