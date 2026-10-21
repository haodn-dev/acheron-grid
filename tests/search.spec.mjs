import { test, expect } from '@playwright/test';

test('search skips hidden source values and merged interiors, flushes pending navigation and follows undo', async ({
  page,
}) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const { createGrid } = await import('/canvas/index.js');
    const rows = Array.from({ length: 5 }, (_, id) => ({ id, a: 'Needle', b: 'Needle' }));
    window.hiddenReads = 0;
    window.rejectHidden = false;
    window.grid = createGrid({
      container: document.querySelector('#grid'),
      dataSource: {
        getRowCount: () => rows.length,
        getRowId: (row) => rows[row].id,
        getValue: (row, key) => {
          if (window.rejectHidden && (row === 2 || key === 'b')) {
            window.hiddenReads++;
            throw new Error('Hidden value was read');
          }
          return rows[row][key];
        },
      },
      resolveCellPermission: (cell) => (cell.rowIndex === 4 ? { selectable: false } : undefined),
      columns: ['a', 'b'].map((key) => ({ key, title: key })),
    });
    window.grid.mergeCells({ startRow: 0, endRow: 1, startColumn: 0, endColumn: 1 });
    window.grid.setRowsHidden([2], true);
    window.grid.setColumnsHidden([1], true);
    window.rejectHidden = true;
  });
  await page.getByRole('grid').press('Control+Home');
  await page.evaluate(() => window.grid.openSearch());
  const search = page.getByRole('search');
  const query = search.getByRole('searchbox');
  await query.fill('Needle');
  await query.press('Enter');
  await expect(search.getByRole('status')).toHaveText('1 of 2');
  await query.press('Enter');
  await expect(search.getByRole('status')).toHaveText('2 of 2');
  expect(await page.evaluate(() => window.grid.getSelection().rowIndex)).toBe(3);
  await query.fill('Need');
  await query.press('Shift+Enter');
  await expect(search.getByRole('status')).toHaveText('2 of 2');
  expect(await page.evaluate(() => window.hiddenReads)).toBe(0);
  await page.evaluate(() => window.grid.unmergeCells({ startRow: 0, endRow: 1, startColumn: 0, endColumn: 1 }));
  await expect(search.getByRole('status')).toHaveText(/of 3$/);
  await page.evaluate(() => window.grid.undo());
  await expect(search.getByRole('status')).toHaveText(/of 2$/);
  await query.press('Escape');
  await expect(search).toBeHidden();
  await expect(page.getByRole('grid')).toBeFocused();
});

test('search reports source errors, recovers and cannot reopen after pending-query destruction', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const { createGrid } = await import('/canvas/index.js');
    window.failSearch = false;
    window.grid = createGrid({
      container: document.querySelector('#grid'),
      columns: [{ key: 'value', title: 'Value' }],
      dataSource: {
        getRowCount: () => 100,
        getRowId: (row) => row,
        getValue: (row) => {
          if (window.failSearch && row === 90) throw new Error('Host search failure');
          return row === 0 ? 'Needle' : null;
        },
      },
    });
    window.failSearch = true;
    window.grid.openSearch();
  });
  const search = page.getByRole('search');
  const query = search.getByRole('searchbox');
  await query.fill('Needle');
  await expect(search.getByRole('status')).toHaveText('Host search failure');
  await expect(search.getByRole('button', { name: 'Next match' })).toBeDisabled();
  await page.evaluate(() => (window.failSearch = false));
  await query.fill('needle');
  await expect(search.getByRole('status')).toHaveText('1 of 1');
  await query.fill('pending');
  await page.evaluate(() => window.grid.destroy());
  await page.waitForTimeout(200);
  await expect(page.getByRole('search')).toHaveCount(0);
  await expect(page.getByRole('grid')).toHaveCount(0);
});
