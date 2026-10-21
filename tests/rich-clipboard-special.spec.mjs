import { test, expect } from './browser-fixtures.mjs';

test('rich values-only pastes visible text and restores the destination on undo', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { createGrid } = await import('/canvas/index.js');
    const { LocalDataSource, encodeBlocks } = await import('/core/index.js');
    const grid = createGrid({
      container: document.querySelector('#grid'),
      dataSource: new LocalDataSource([{ id: 1, text: 'before' }], (row) => row.id),
      columns: [{ key: 'text', title: 'Text', editable: true }],
    });
    grid.selectRow(0);
    grid.pasteSelectionBlocks(
      encodeBlocks([{ row: 0, column: 0, values: [['<strong>42</strong>']], formats: [[{ contentFormat: 'html' }]] }]),
      { mode: 'values' },
    );
    const pasted = { value: grid.getValue(0, 'text'), format: grid.getFormat(0, 0) };
    grid.undo();
    const restored = grid.getValue(0, 'text');
    grid.destroy();
    return { pasted, restored };
  });
  expect(result).toEqual({ pasted: { value: '42', format: {} }, restored: 'before' });
});

test('transposed rich blocks normalize against destination types and retain offsets and atomic history', async ({
  page,
}) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { createGrid } = await import('/canvas/index.js');
    const { LocalDataSource, encodeBlocks } = await import('/core/index.js');
    const grid = createGrid({
      container: document.querySelector('#grid'),
      dataSource: new LocalDataSource(
        [
          { id: 1, number: 1, text: 'first', extra: 'old' },
          { id: 2, number: 2, text: 'second', extra: 'untouched' },
        ],
        (row) => row.id,
      ),
      columns: [
        {
          key: 'number',
          title: 'Number',
          editable: true,
          parse: Number,
          validate: (value) => (Number.isFinite(value) ? undefined : 'Invalid number'),
        },
        { key: 'text', title: 'Text', editable: true },
        { key: 'extra', title: 'Extra', editable: true },
      ],
    });
    const payload = encodeBlocks([
      {
        row: 0,
        column: 0,
        values: [
          ['<strong>7</strong>', '<em>8</em>'],
          ['<strong>A</strong>', '<em>B</em>'],
        ],
        formats: Array.from({ length: 2 }, () => Array.from({ length: 2 }, () => ({ contentFormat: 'html' }))),
      },
      { row: 2, column: 0, values: [['<strong>Tail</strong>']], formats: [[{ contentFormat: 'html' }]] },
    ]);
    grid.selectRow(0);
    grid.pasteSelectionBlocks(payload, { transpose: true });
    const pasted = {
      numbers: [grid.getValue(0, 'number'), grid.getValue(1, 'number')],
      text: grid.getValue(0, 'text'),
      extra: grid.getValue(0, 'extra'),
      numericFormat: grid.getFormat(0, 0),
      richFormat: grid.getFormat(0, 1),
      untouched: grid.getValue(1, 'extra'),
    };
    grid.undo();
    const restored = [
      grid.getValue(0, 'number'),
      grid.getValue(1, 'number'),
      grid.getValue(0, 'text'),
      grid.getValue(0, 'extra'),
    ];
    grid.selectRow(0);
    grid.pasteSelectionBlocks(
      encodeBlocks([{ row: 0, column: 0, values: [['<strong>9</strong>']], formats: [[{ contentFormat: 'html' }]] }]),
      { transpose: true },
    );
    const scalar = [
      grid.getValue(0, 'number'),
      grid.getValue(0, 'text'),
      grid.getValue(0, 'extra'),
      grid.getValue(1, 'number'),
    ];
    grid.undo();
    grid.selectRow(0);
    grid.pasteSelectionBlocks(payload, { transpose: true, mode: 'formats' });
    const formatsOnly = { number: grid.getValue(0, 'number'), format: grid.getFormat(0, 0) };
    grid.destroy();
    return { pasted, restored, scalar, formatsOnly };
  });
  expect(result.pasted).toMatchObject({
    numbers: [7, 8],
    numericFormat: {},
    richFormat: { contentFormat: 'html' },
    untouched: 'untouched',
  });
  expect(result.pasted.text).toContain('A');
  expect(result.pasted.extra).toContain('Tail');
  expect(result.restored).toEqual([1, 2, 'first', 'old']);
  expect(result.scalar[0]).toBe(9);
  expect(result.scalar[1]).toContain('9');
  expect(result.scalar[2]).toContain('9');
  expect(result.scalar[3]).toBe(2);
  expect(result.formatsOnly).toEqual({ number: 1, format: { contentFormat: 'html' } });
});
