import { test, expect } from '@playwright/test';

async function mount(page) {
  await page.goto('/');
  await page.evaluate(async () => {
    const { createGrid } = await import('/canvas/index.js');
    window.total = 1000000;
    window.epoch = 'a';
    window.ids = 0;
    window.writes = 0;
    window.values = new Map();
    window.grid = createGrid({
      container: document.querySelector('#grid'),
      accessibility: 'viewport',
      dataSource: {
        getRowCount: () => window.total,
        getRowId: (row) => {
          window.ids++;
          return `${window.epoch}:${row}`;
        },
        getValue: (row) => {
          if (row >= window.total) throw Error('Stale row read');
          return window.values.get(row) ?? `${window.epoch}:${row}`;
        },
        setValues: (updates) => {
          window.writes++;
          for (const cell of updates) window.values.set(cell.rowIndex, cell.value);
        },
      },
      columns: [{ key: 'value', title: 'Value', editable: true }],
    });
    window.originalGrid = document.querySelector('[role=grid]');
  });
}

test('Canvas resets same-count and empty/million-row epochs with one mount, new ARIA geometry and no global ID scan', async ({
  page,
}) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await mount(page);
  const grid = page.getByRole('grid');
  await grid.press('Control+Home');
  await page.evaluate(() => {
    window.grid.updateCells([{ rowIndex: 0, columnKey: 'value', value: 'draft' }]);
    window.grid.cutSelectionBlocks();
  });
  const first = await page.evaluate(() => {
    window.epoch = 'b';
    window.values.clear();
    window.ids = 0;
    const result = window.grid.resetData();
    return {
      result,
      ids: window.ids,
      writes: window.writes,
      same: window.originalGrid === document.querySelector('[role=grid]'),
    };
  });
  expect(first.result).toMatchObject({
    previousRowCount: 1000000,
    rowCount: 1000000,
    droppedHistoryEntries: 1,
    selectionCleared: true,
    cutCancelled: true,
  });
  expect(first.ids).toBeLessThan(2000);
  expect(first.writes).toBe(1);
  expect(first.same).toBe(true);
  await expect(grid.getByRole('gridcell', { name: 'Value: b:0', exact: true })).toBeAttached();
  await page.evaluate(() => {
    window.total = 0;
    window.grid.resetData();
  });
  await expect(grid).toHaveAttribute('aria-rowcount', '1');
  await expect(grid.getByRole('gridcell')).toHaveCount(0);
  await page.evaluate(() => {
    window.total = 100000;
    window.epoch = 'c';
    window.grid.resetData();
  });
  await expect(grid).toHaveAttribute('aria-rowcount', '100001');
  await expect(grid.getByRole('gridcell', { name: 'Value: c:0', exact: true })).toBeAttached();
  expect(await page.evaluate(() => window.originalGrid === document.querySelector('[role=grid]'))).toBe(true);
  expect(await page.evaluate(() => window.grid.undo())).toBe(false);
  expect(await page.evaluate(() => window.grid.takeObserverErrors().map((error) => error.message))).toEqual([]);
  expect(errors).toEqual([]);
});

test('reset rejection preserves an unsent editor and local Find without reading IDs or dropping history', async ({
  page,
}) => {
  await mount(page);
  const grid = page.getByRole('grid');
  await grid.press('Control+Home');
  await grid.press('F2');
  const editor = page.getByRole('textbox');
  await editor.fill('Unsent reset draft');
  const error = await page.evaluate(() => {
    try {
      window.grid.resetData();
    } catch (error) {
      return error.message;
    }
  });
  expect(error).toMatch(/Finish editing/);
  await expect(editor).toHaveValue('Unsent reset draft');
  expect(await page.evaluate(() => window.writes)).toBe(0);
  await editor.press('Escape');
  await page.evaluate(() => window.grid.openSearch());
  const search = await page.evaluate(() => {
    window.ids = 0;
    try {
      window.grid.resetData();
    } catch (error) {
      return { error: error.message, ids: window.ids };
    }
  });
  expect(search).toEqual({ error: 'Finish editing and close local search before resetting data.', ids: 0 });
  await expect(page.locator('[data-grid-search]')).toBeVisible();
});
