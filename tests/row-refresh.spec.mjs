import { test, expect } from '@playwright/test';

async function mount(page) {
  await page.goto('/');
  await page.evaluate(async () => {
    const { createGrid } = await import('/canvas/index.js');
    const { createPagedRemoteDataSource } = await import('/core/index.js');
    window.requests = [];
    window.identityReads = 0;
    window.source = createPagedRemoteDataSource({
      datasetId: 'browser-window',
      columnKeys: ['value'],
      rowCount: 1000000,
      pageSize: 20,
      maxPages: 1,
      createAbortController: () => new AbortController(),
      createMutationId: () => 'unused',
      load: async ({ offset, limit }) => {
        window.requests.push(offset);
        return {
          datasetId: 'browser-window',
          revision: 'r1',
          total: 1000000,
          rows: Array.from({ length: limit }, (_, i) => ({
            id: offset + i,
            values: { value: `Loaded ${offset + i}` },
          })),
        };
      },
      write: async () => {
        throw new Error('Unexpected remote write.');
      },
    });
    window.grid = createGrid({
      container: document.querySelector('#grid'),
      dataSource: {
        ...window.source,
        getRowId: (row) => {
          window.identityReads++;
          return window.source.getRowId(row);
        },
      },
      columns: [{ key: 'value', title: 'Value', editable: true }],
      accessibility: 'viewport',
      getCellLabel: (_row, _key, value) => (value === undefined ? 'Unloaded' : String(value)),
      resolveCellPermission: ({ rowIndex }) => {
        const ready = window.source.getPageState(Math.floor(rowIndex / 20) * 20)?.status === 'ready';
        return { writable: ready, pasteable: ready, copyable: ready };
      },
    });
    window.originalViewport = document.querySelector('[role=grid]');
  });
}

test('million-row paged window refresh keeps one Canvas mount and retains verified drafts/history across eviction', async ({
  page,
}) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await mount(page);
  const grid = page.getByRole('grid');
  await grid.press('Control+Home');
  const result = await page.evaluate(async () => {
    await window.source.loadPage(0);
    window.identityReads = 0;
    return window.grid.refreshRows(0, 19);
  });
  expect(result.selectionCleared).toBe(true);
  await expect(grid.getByRole('gridcell', { name: 'Loaded 0', exact: true })).toBeAttached();
  expect(await page.evaluate(() => window.identityReads)).toBeLessThan(2000);
  await page.evaluate(() => window.grid.updateCells([{ rowIndex: 0, columnKey: 'value', value: 'Draft' }]));
  const afterEviction = await page.evaluate(async () => {
    await window.source.loadPage(20);
    return window.grid.refreshRows(0, 39);
  });
  expect(afterEviction.droppedHistoryEntries).toBe(0);
  await expect(grid.getByRole('gridcell', { name: 'Draft', exact: true })).toBeAttached();
  expect(await page.evaluate(() => window.source.pendingCellCount)).toBe(1);
  await page.evaluate(async () => {
    await window.source.loadPage(0);
    window.grid.refreshRows(0, 39);
    window.grid.undo();
  });
  await expect(grid.getByRole('gridcell', { name: 'Loaded 0', exact: true })).toBeAttached();
  await page.evaluate(() => window.grid.redo());
  await expect(grid.getByRole('gridcell', { name: 'Draft', exact: true })).toBeAttached();
  expect(await page.evaluate(() => window.originalViewport === document.querySelector('[role=grid]'))).toBe(true);
  expect(await page.evaluate(() => window.grid.rowCount)).toBe(1000000);
  expect(await grid.getByRole('row').count()).toBeLessThan(40);
  expect(await page.evaluate(() => window.requests)).toEqual([0, 20, 0]);
  expect(await page.evaluate(() => window.grid.takeObserverErrors())).toEqual([]);
  expect(errors).toEqual([]);
});

test('row refresh refuses open editor/local search without losing unsent input or starting global find scans', async ({
  page,
}) => {
  await mount(page);
  await page.evaluate(async () => {
    await window.source.loadPage(0);
    window.grid.refreshRows(0, 19);
  });
  const grid = page.getByRole('grid');
  await grid.press('Control+Home');
  await grid.press('F2');
  await page.getByRole('textbox').fill('unsent');
  expect(
    await page.evaluate(() => {
      try {
        window.grid.refreshRows(20, 39);
        return null;
      } catch (error) {
        return error.message;
      }
    }),
  ).toContain('Finish editing');
  await expect(page.getByRole('textbox')).toHaveValue('unsent');
  expect(await page.evaluate(() => window.source.pendingCellCount)).toBe(0);
  await page.getByRole('textbox').press('Escape');
  await grid.press('Control+f');
  await expect(page.locator('[data-grid-search]')).toBeVisible();
  const result = await page.evaluate(() => {
    window.identityReads = 0;
    try {
      window.grid.refreshRows(0, 19);
      return null;
    } catch (error) {
      return { message: error.message, reads: window.identityReads };
    }
  });
  expect(result.message).toContain('close local search');
  expect(result.reads).toBe(0);
  expect(await page.evaluate(() => window.grid.takeObserverErrors())).toEqual([]);
});
