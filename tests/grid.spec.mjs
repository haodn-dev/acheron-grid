import { test, expect } from '@playwright/test';

test('renders only the viewport, scrolls both axes, resizes and cleans up', async ({ page }) => {
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await page.evaluate(async () => {
    const { createGrid } = await import('/index.js');
    window.reads = [];
    window.grid = createGrid({
      container: document.querySelector('#grid'),
      columns: Array.from({ length: 100 }, (_, i) => ({ key: `col${i}`, title: `Column ${i}` })),
      dataSource: {
        getRowCount: () => 100_000,
        getRowId: i => i,
        getValue: (i, key) => { window.reads.push([i, key]); return `${i} / ${key}`; },
      },
    });
  });
  await expect.poll(() => page.evaluate(() => window.reads.length)).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.reads.every(([row, key]) => row < 11 && Number(key.slice(3)) < 4))).toBe(true);
  const scroller = page.getByLabel('Read-only data grid viewport');
  await scroller.evaluate(element => { window.reads = []; element.scrollTop = 1_600_000; element.scrollLeft = 8000; });
  await expect.poll(() => page.evaluate(() => window.reads.some(([row, key]) => row === 50_000 && key === 'col50'))).toBe(true);
  expect(await page.evaluate(() => window.reads.length)).toBeLessThan(100);
  expect(await page.locator('canvas').evaluate(canvas => [...canvas.getContext('2d').getImageData(20, 10, 1, 1).data])).not.toEqual([0, 0, 0, 0]);
  await page.locator('#grid').evaluate(element => { element.style.width = '320px'; });
  await expect.poll(() => page.locator('canvas').evaluate(element => parseFloat(element.style.width))).toBeLessThanOrEqual(320);
  await page.evaluate(() => { window.grid.render(); window.grid.destroy(); window.grid.destroy(); window.grid.render(); });
  await expect(page.locator('canvas')).toHaveCount(0);
  await expect(page.locator('#existing')).toHaveText('Existing content');
  expect(errors).toEqual([]);
});

test('empty and invalid grids are safe', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { createGrid, LocalDataSource } = await import('/index.js');
    const container = document.querySelector('#grid');
    const dataSource = new LocalDataSource([], () => 0);
    const empty = createGrid({ container, columns: [], dataSource });
    empty.destroy();
    try { createGrid({ container, columns: [], dataSource, rowHeight: 0 }); }
    catch (error) { return error instanceof RangeError && container.children.length === 1; }
    return false;
  });
  expect(result).toBe(true);
});
