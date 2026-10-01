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

test('single cell selection, navigation, scrolling and cleanup', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const { createGrid } = await import('/index.js');
    window.changes = [];
    window.grid = createGrid({
      container: document.querySelector('#grid'),
      columns: Array.from({ length: 20 }, (_, i) => ({ key: `c${i}`, title: `Column ${i}` })),
      dataSource: { getRowCount: () => 100, getRowId: i => `row-${i}`, getValue: (i, key) => `${i}:${key}` },
      onSelectionChange: selection => { window.changes.push(selection); if (selection) selection.rowIndex = -1; },
    });
  });
  const viewport = page.getByLabel(/^Read-only data grid viewport/);
  const selection = () => page.evaluate(() => window.grid.getSelection());
  await viewport.click({ position: { x: 180, y: 48 } });
  expect(await selection()).toEqual({ rowIndex: 1, rowId: 'row-1', columnIndex: 1, columnKey: 'c1' });
  await viewport.click({ position: { x: 180, y: 48 } });
  expect(await page.evaluate(() => window.changes.length)).toBe(1);
  await expect(viewport).toBeFocused();
  await expect.poll(() => page.locator('canvas').evaluate(canvas => {
    const ratio = devicePixelRatio;
    return [...canvas.getContext('2d').getImageData(161 * ratio, 80 * ratio, 1, 1).data];
  })).toEqual([37, 99, 235, 255]);
  await page.keyboard.press('ArrowRight');
  expect((await selection()).columnIndex).toBe(2);
  await page.keyboard.press('Control+End');
  expect(await selection()).toEqual({ rowIndex: 99, rowId: 'row-99', columnIndex: 19, columnKey: 'c19' });
  expect(await viewport.evaluate(el => el.scrollTop > 0 && el.scrollLeft > 0)).toBe(true);
  await page.keyboard.press('ArrowDown');
  expect((await selection()).rowIndex).toBe(99);
  await viewport.evaluate(el => { el.scrollTop = 640; el.scrollLeft = 800; });
  await viewport.click({ position: { x: 20, y: 16 } });
  expect(await selection()).toEqual({ rowIndex: 20, rowId: 'row-20', columnIndex: 5, columnKey: 'c5' });
  await page.keyboard.press('Home');
  expect((await selection()).columnIndex).toBe(0);
  await page.keyboard.press('End');
  expect((await selection()).columnIndex).toBe(19);
  await page.keyboard.press('Control+Home');
  expect((await selection()).rowIndex).toBe(0);
  await page.keyboard.press('ArrowUp');
  expect((await selection()).rowIndex).toBe(0);
  await page.keyboard.press('Escape');
  expect(await selection()).toBeNull();
  await page.keyboard.press('ArrowDown');
  expect((await selection()).rowIndex).toBe(0);
  await page.evaluate(() => { const copy = window.grid.getSelection(); copy.columnIndex = 99; });
  expect((await selection()).columnIndex).toBe(0);
  await page.evaluate(() => {
    window.oldViewport = document.querySelector('[tabindex]');
    window.grid.destroy();
    window.oldViewport.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight' }));
  });
  expect(await selection()).toBeNull();
});

test('ignores header, blank space, modified keys and empty data', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const { createGrid, LocalDataSource } = await import('/index.js');
    window.grid = createGrid({ container: document.querySelector('#grid'), columns: [{ key: 'name', title: 'Name' }], dataSource: new LocalDataSource([{ id: 1, name: 'Ada' }], row => row.id) });
    const button = document.createElement('button'); button.textContent = 'After grid'; document.body.append(button);
  });
  const viewport = page.getByLabel(/^Read-only data grid viewport/);
  const bounds = await viewport.boundingBox();
  await page.mouse.click(bounds.x + 20, bounds.y - 15);
  await viewport.click({ position: { x: 300, y: 100 } });
  expect(await page.evaluate(() => window.grid.getSelection())).toBeNull();
  await viewport.focus();
  await page.keyboard.press('Shift+ArrowDown');
  expect(await page.evaluate(() => window.grid.getSelection())).toBeNull();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'After grid' })).toBeFocused();
  await page.evaluate(async () => {
    window.grid.destroy();
    const { createGrid, LocalDataSource } = await import('/index.js');
    window.grid = createGrid({ container: document.querySelector('#grid'), columns: [], dataSource: new LocalDataSource([], () => 0) });
  });
  await viewport.click({ position: { x: 20, y: 20 } });
  await viewport.focus();
  await page.keyboard.press('ArrowDown');
  expect(await page.evaluate(() => window.grid.getSelection())).toBeNull();
});
