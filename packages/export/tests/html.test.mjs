import test from 'node:test';
import assert from 'node:assert/strict';
import { createGridEngine, LocalDataSource } from '@acheron-grid/core';
import { renderHtmlTable } from '@acheron-grid/export/html';

const columns = [
  { key: 'name', title: 'Name' },
  { key: 'score', title: 'Score' },
];
const source = (rows) => ({ columns, rowCount: rows.length, getValue: (row, key) => rows[row][key] });
const allowed = { authorize: () => true };

test('HTML rejects null page bounds, sparse column selections and ambiguous source keys before reading', () => {
  let reads = 0;
  const data = {
    ...source([{ name: 'private' }]),
    getValue: () => {
      reads++;
      return 'private';
    },
  };
  for (const options of [
    { ...allowed, offset: null },
    { ...allowed, limit: null },
    { ...allowed, columns: new Array(1) },
  ])
    assert.throws(() => renderHtmlTable(data, options));
  assert.throws(
    () => renderHtmlTable({ ...data, columns: [columns[0], columns[0]] }, { ...allowed, columns: ['name'] }),
    /Duplicate/,
  );
  assert.equal(reads, 0);
});

test('HTML is headless, semantic and escapes text, headers, captions, attributes and callbacks', () => {
  const html = renderHtmlTable(
    { ...source([{ name: '<script>"&\'</script>', score: 42 }]), columns: [{ key: 'name', title: '<Name>' }] },
    {
      ...allowed,
      caption: '<Data>',
      lang: '" onmouseover="evil',
      getCellLabel: (_row, _column, value) => String(value),
    },
  );
  assert.equal(
    html,
    '<table lang="&quot; onmouseover=&quot;evil"><caption>&lt;Data&gt;</caption><thead><tr><th scope="col">&lt;Name&gt;</th></tr></thead><tbody><tr><td>&lt;script&gt;&quot;&amp;&#39;&lt;/script&gt;</td></tr></tbody></table>',
  );
  assert.equal(typeof globalThis.document, 'undefined');
});

test('HTML follows engine sort/filter, chosen columns and page bounds without changing state', () => {
  const engine = createGridEngine({
    columns,
    dataSource: new LocalDataSource(
      [
        { name: 'B', score: 1 },
        { name: 'A', score: 2 },
        { name: 'C', score: 3 },
      ],
      (_, i) => i,
    ),
  });
  engine.setView({
    sorts: [{ columnKey: 'name', direction: 'desc' }],
    filters: [{ columnKey: 'name', query: 'A', operator: 'equals' }],
  });
  engine.select(0, 0);
  const before = engine.exportState();
  assert.match(renderHtmlTable(engine, { ...allowed, columns: ['score', 'name'] }), /<td>2<\/td><td>A<\/td>/);
  assert.deepEqual(engine.exportState(), before);
  engine.setView({ sorts: [{ columnKey: 'name', direction: 'desc' }] });
  assert.match(renderHtmlTable(engine, { ...allowed, offset: 1, limit: 1 }), /<td>B<\/td><td>1<\/td>/);
  assert.equal((renderHtmlTable(engine, { ...allowed, offset: 50 }).match(/<td>/g) ?? []).length, 0);
  engine.destroy();
});

test('HTML omits hidden rows/columns and emits empty merged placeholders', () => {
  const engine = createGridEngine({
    columns,
    dataSource: new LocalDataSource(
      [
        { name: 'B', score: 1 },
        { name: 'A', score: 2 },
      ],
      (_, i) => i,
    ),
  });
  engine.setRowsHidden([1], true);
  engine.setColumnsHidden([1], true);
  assert.equal(
    renderHtmlTable(engine, allowed),
    '<table><thead><tr><th scope="col">Name</th></tr></thead><tbody><tr><td>B</td></tr></tbody></table>',
  );
  engine.setColumnsHidden([1], false);
  engine.mergeCells({ startRow: 0, endRow: 0, startColumn: 0, endColumn: 1 });
  assert.match(renderHtmlTable(engine, allowed), /<td>B<\/td><td><\/td>/);
  engine.destroy();
});

test('authorization preflight never reads values or formats when a cell is denied', () => {
  let reads = 0;
  const data = {
    ...source([{ name: 'secret', score: 1 }]),
    getValue: () => {
      reads++;
      return 'secret';
    },
  };
  assert.throws(
    () =>
      renderHtmlTable(data, {
        authorize: (_row, key) => key === 'name',
        getCellLabel: () => {
          throw Error('must not format');
        },
      }),
    /not authorized/,
  );
  assert.equal(reads, 0);
  for (const result of [undefined, 1, 'true', Promise.resolve(true)])
    assert.throws(() => renderHtmlTable(data, { authorize: () => result }), /not authorized/);
  const engine = createGridEngine({
    columns: [{ key: 'name', title: 'Name', permissions: { copyable: false } }],
    dataSource: new LocalDataSource([{ name: 'secret' }], (_, i) => i),
  });
  assert.throws(() => renderHtmlTable(engine, allowed), /copyable/);
  engine.destroy();
});

test('options and cell/output budgets fail before unbounded reads', () => {
  let reads = 0;
  const data = {
    ...source([]),
    rowCount: 100_000,
    getValue: () => {
      reads++;
      return 'x';
    },
  };
  for (const options of [
    undefined,
    {},
    { authorize: true },
    { ...allowed, offset: -1 },
    { ...allowed, offset: 0.5 },
    { ...allowed, limit: Infinity },
    { ...allowed, limit: 100_001 },
    { ...allowed, columns: ['missing'] },
    { ...allowed, columns: ['name', 'name'] },
    { ...allowed, columns: 'name' },
    { ...allowed, caption: 42 },
    { ...allowed, getCellLabel: 42 },
  ])
    assert.throws(() => renderHtmlTable(data, options));
  assert.throws(() => renderHtmlTable(data, { ...allowed, limit: 100_000 }), /page is too large/);
  assert.equal(reads, 0);
  renderHtmlTable(data, allowed);
  assert.equal(reads, 200);
  assert.throws(() => renderHtmlTable(source([{ name: '&'.repeat(2_000_001) }]), allowed), /output is too large/);
  assert.throws(
    () => renderHtmlTable(source([]), { ...allowed, caption: 'x'.repeat(10_000_001) }),
    /output is too large/,
  );
  assert.throws(
    () => renderHtmlTable(source([{ name: 'x' }]), { ...allowed, getCellLabel: () => ({ html: '<b>' }) }),
    /labels must be strings/,
  );
});

test('default text does not expose objects or manufacture rich HTML and custom labels retain Unicode', () => {
  assert.match(renderHtmlTable(source([{ name: { token: 'secret' }, score: NaN }]), allowed), /<td><\/td><td><\/td>/);
  assert.match(
    renderHtmlTable(source([{ name: 'Việt Nam\n日本', score: false }]), allowed),
    /<td>Việt Nam\n日本<\/td><td>false<\/td>/,
  );
  assert.match(
    renderHtmlTable(source([{ score: 0.125 }]), {
      ...allowed,
      columns: ['score'],
      getCellLabel: (_row, _column, value) => new Intl.NumberFormat('vi', { style: 'percent' }).format(value),
    }),
    /<td>13%<\/td>/,
  );
  assert.match(renderHtmlTable(source([{ name: 'x' }]), { ...allowed, limit: 0 }), /<tbody><\/tbody>/);
});
