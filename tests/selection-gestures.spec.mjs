import { test, expect } from './browser-fixtures.mjs';
async function setup(page, extra = {}) {
  await page.goto('/');
  await page.evaluate(async (extra) => {
    const { createGrid } = await import('/canvas/index.js');
    const { LocalDataSource } = await import('/core/index.js');
    window.grid = createGrid({
      container: document.querySelector('#grid'),
      columns: ['a', 'b', 'c', 'd', 'e'].map((key) => ({ key, title: key })),
      dataSource: new LocalDataSource(
        Array.from({ length: 20 }, (_, id) => ({ id, a: 20 - id, b: id % 2 ? 'odd' : 'even', c: '', d: '', e: '' })),
        (row) => row.id,
      ),
      indexColumn: false,
      rowHeight: 40,
      headerHeight: 30,
      columnWidth: 90,
      theme: { background: '#ffffff', selectionColor: '#ff6600' },
      renderCell: () => true,
      motion: { selectionDuration: 120 },
      ...extra,
    });
  }, extra);
  await expect(page.locator('canvas').first()).toBeVisible();
}
async function point(page, row, col) {
  const box = await page.getByRole('grid').boundingBox();
  return { x: box.x + col * 90 + 45, y: box.y + row * 40 + 20 };
}
async function drag(page, from, to, modifier) {
  const a = await point(page, ...from),
    b = await point(page, ...to);
  if (modifier) await page.keyboard.down(modifier);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 12 });
  await page.mouse.up();
  if (modifier) await page.keyboard.up(modifier);
}
async function click(page, row, col, modifier) {
  const p = await point(page, row, col);
  if (modifier) await page.keyboard.down(modifier);
  await page.mouse.click(p.x, p.y);
  if (modifier) await page.keyboard.up(modifier);
}
async function selected(page, row, col) {
  return page.evaluate(
    ([row, col]) =>
      window.grid
        .getSelectionRanges()
        .some((r) => r.startRow <= row && r.endRow >= row && r.startColumn <= col && r.endColumn >= col),
    [row, col],
  );
}
async function pixels(page, cells) {
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await expect(page.locator('[data-grid-selection-exit]')).toHaveCount(0);
  return page.evaluate((cells) => {
    const canvas = document.querySelector('canvas:not([data-grid-motion])');
    const ratio = canvas.width / canvas.clientWidth;
    return cells.map(([row, col]) =>
      Array.from(
        canvas
          .getContext('2d')
          .getImageData(Math.round((col * 90 + 45) * ratio), Math.round((30 + row * 40 + 20) * ratio), 1, 1).data,
      ),
    );
  }, cells);
}
for (const scale of [1, 1.5, 2])
  test.describe('selection raster DPR ' + scale, () => {
    test.use({ deviceScaleFactor: scale });
    test('drag then Ctrl/Cmd-click makes real holes; repeated toggles are bounded', async ({ page }, testInfo) => {
      await setup(page);
      await drag(page, [0, 0], [5, 3]);
      for (const [row, col] of [
        [1, 1],
        [2, 2],
        [4, 1],
      ]) {
        await click(page, row, col, 'Control');
        expect(await selected(page, row, col)).toBe(false);
      }
      const colors = await pixels(page, [
        [1, 1],
        [2, 2],
        [4, 1],
        [0, 0],
        [1, 2],
        [5, 3],
      ]);
      for (const color of colors.slice(0, 3)) expect(color).toEqual([255, 255, 255, 255]);
      const seams = await page.evaluate(() => {
        const canvas = document.querySelector('canvas:not([data-grid-selection-exit])');
        const ratio = canvas.width / canvas.clientWidth,
          ctx = canvas.getContext('2d');
        return [45, 405].map((x) =>
          Array.from(ctx.getImageData(Math.floor(x * ratio), Math.floor(69.5 * ratio), 1, 1).data),
        );
      });
      // An internal split must retain the ordinary grid line, not acquire a selection border.
      expect(Math.max(...seams[0].map((v, i) => Math.abs(v - seams[1][i])))).toBeLessThanOrEqual(20);

      expect(colors[3]).not.toEqual(colors[0]);
      expect(colors[4]).toEqual(colors[3]);
      expect(colors[5]).toEqual(colors[3]);
      for (let i = 0; i < 20; i++) {
        await click(page, 2, 2, i % 2 ? 'Meta' : 'Control');
        expect(await selected(page, 2, 2)).toBe(i % 2 === 0);
        expect(await page.evaluate(() => window.grid.getSelectionRanges().length)).toBeLessThanOrEqual(14);
      }
      await page.screenshot({ path: testInfo.outputPath('selection-holes-dpr-' + scale + '.png') });
    });
    test('overlapping dragged ranges have one tint and ordinary clicks replace all ranges', async ({ page }) => {
      await setup(page);
      await drag(page, [0, 0], [4, 2]);
      await drag(page, [6, 4], [2, 1], 'Control');
      const colors = await pixels(page, [
        [3, 0],
        [3, 1],
        [3, 3],
      ]);
      expect(colors[1]).toEqual(colors[0]);
      expect(colors[2]).toEqual(colors[0]);
      for (let i = 0; i < 20; i++) {
        await click(page, 1, 1);
        expect(await page.evaluate(() => window.grid.getSelectionRanges().length)).toBe(1);
      }
      for (let i = 0; i < 20; i++) {
        await click(page, 1, 1, 'Control');
        expect(await page.evaluate(() => window.grid.getSelectionRanges().length)).toBe(i % 2 ? 1 : 0);
      }
    });
  });
test('frozen panes, sorted filtered identities, hidden columns and keyboard toggle remain consistent', async ({
  page,
}) => {
  await setup(page, { frozenRows: 1, frozenColumns: 1 });
  await page.evaluate(() =>
    window.grid.setView({ sort: { columnKey: 'a', direction: 'asc' }, filters: [{ columnKey: 'b', query: 'odd' }] }),
  );
  await drag(page, [0, 0], [4, 3]);
  await click(page, 2, 2, 'Control');
  expect(await selected(page, 2, 2)).toBe(false);
  const colors = await pixels(page, [
    [2, 2],
    [2, 1],
    [1, 1],
  ]);
  expect(colors[0]).toEqual([255, 255, 255, 255]);
  expect(colors[1]).toEqual(colors[2]);
  await page.evaluate(() => window.grid.setColumnsHidden([4], true));
  expect(await selected(page, 2, 2)).toBe(false);
  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => window.grid.getSelectionRanges())).toEqual([]);
  await page.getByRole('grid').press('Control+Home');
  await page.keyboard.press('Shift+F8');
  await click(page, 0, 0);
  expect(await page.evaluate(() => window.grid.getSelectionRanges())).toEqual([]);
  await page.getByRole('grid').press('Control+Home');
  await page.keyboard.press('Shift+ArrowDown');
  expect(await page.evaluate(() => window.grid.getSelectionRange().endRow)).toBe(1);
});

test('merged cells toggle as one span after a real drag and a new drag remains usable', async ({ page }) => {
  await setup(page);
  await page.evaluate(() => window.grid.mergeCells({ startRow: 1, endRow: 2, startColumn: 1, endColumn: 2 }));
  await drag(page, [0, 0], [4, 3]);
  await click(page, 2, 2, 'Control');
  for (const row of [1, 2]) for (const col of [1, 2]) expect(await selected(page, row, col)).toBe(false);
  expect((await pixels(page, [[1, 1]]))[0]).toEqual([255, 255, 255, 255]);
  await click(page, 2, 2, 'Meta');
  for (const row of [1, 2]) for (const col of [1, 2]) expect(await selected(page, row, col)).toBe(true);
  await page.keyboard.press('Escape');
  await drag(page, [4, 3], [6, 4]);
  expect(await selected(page, 6, 4)).toBe(true);
  expect(await selected(page, 0, 0)).toBe(false);
});

test('modifier click with pointer jitter keeps the hole; modifier drag starts from the pressed cell', async ({
  page,
}) => {
  await setup(page);
  await drag(page, [0, 0], [5, 3]);
  const p = await point(page, 2, 1);
  await page.keyboard.down('Control');
  await page.mouse.move(p.x, p.y);
  await page.mouse.down();
  await page.mouse.move(p.x + 2, p.y + 1);
  await page.mouse.up();
  await page.keyboard.up('Control');
  expect(await selected(page, 2, 1)).toBe(false);
  await click(page, 2, 1, 'Control');
  await drag(page, [2, 1], [4, 2], 'Control');
  expect(await page.evaluate(() => window.grid.getSelectionRange())).toEqual({
    startRow: 2,
    endRow: 4,
    startColumn: 1,
    endColumn: 2,
  });
  for (const [row, col] of [
    [0, 0],
    [5, 3],
    [2, 1],
    [4, 2],
  ])
    expect(await selected(page, row, col)).toBe(true);
});

test('clipboard paste follows the clicked record after its sort position changes', async ({ page }) => {
  await setup(page, { columns: ['a', 'b', 'c', 'd', 'e'].map((key) => ({ key, title: key, editable: key === 'b' })) });
  await page.evaluate(() => window.grid.setView({ sort: { columnKey: 'b', direction: 'asc' } }));
  await click(page, 0, 1);
  expect(await page.evaluate(() => window.grid.getSelection().rowId)).toBe(0);
  await page.getByRole('grid').evaluate((node) => {
    const data = new DataTransfer();
    data.setData('text/plain', 'zzz');
    node.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  });
  expect(await page.evaluate(() => window.grid.getSelection())).toMatchObject({
    rowId: 0,
    rowIndex: 19,
    columnKey: 'b',
  });
  expect(await page.evaluate(() => window.grid.getValue(19, 'b'))).toBe('zzz');
  await page.keyboard.press('Control+z');
  expect(await page.evaluate(() => window.grid.getSelection().rowId)).toBe(0);
  expect(await page.evaluate(() => window.grid.getValue(0, 'b'))).toBe('even');
});
