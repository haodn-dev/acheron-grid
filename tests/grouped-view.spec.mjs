import { test, expect } from '@playwright/test';

for (const accessibility of ['active', 'viewport']) {
  test(`local grouped Canvas preserves record editing, disclosure and keyboard focus (${accessibility})`, async ({
    page,
  }) => {
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/');
    await page.evaluate(async (accessibility) => {
      const { createGrid } = await import('/canvas/index.js');
      const { LocalDataSource } = await import('/core/index.js');
      window.source = new LocalDataSource(
        [
          { id: 'a', team: 'A', amount: 10 },
          { id: 'b', team: 'A', amount: 20 },
          { id: 'c', team: 'B', amount: 5 },
        ],
        (row) => row.id,
      );
      window.rendered = [];
      window.grid = createGrid({
        container: document.querySelector('#grid'),
        accessibility,
        dataSource: window.source,
        grouping: { columnKey: 'team', sumColumns: ['amount'] },
        columns: [
          { key: 'team', title: 'Team', editable: true },
          { key: 'amount', title: 'Amount', editable: true, parse: Number },
        ],
        renderCell: (_ctx, cell) => {
          window.rendered.push(cell.rowId);
          return false;
        },
        autoRowHeight: true,
      });
    }, accessibility);
    const grid = page.getByRole('treegrid');
    await expect(page.locator('[data-grid-data-group="0"]')).toHaveAttribute('aria-expanded', 'true');
    expect(await page.evaluate(() => window.grid.takeObserverErrors().length)).toBe(0);
    expect(await page.evaluate(() => window.grid.rowCount)).toBe(5);
    await page.locator('[data-grid-header-cell="1"]').press('Shift+F10');
    await expect(page.getByRole('menuitem', { name: 'Sort descending…', exact: true })).toBeVisible();
    await page.getByRole('menuitem', { name: 'Sort descending…', exact: true }).click();
    await page
      .getByRole('dialog', { name: 'Change row view', exact: true })
      .getByRole('button', { name: 'Apply view', exact: true })
      .click();
    await expect.poll(() => page.evaluate(() => window.grid.getRowMetadata(1).rowId)).toBe('b');
    await page.evaluate(() => window.grid.setView({}));
    await grid.press('Control+Home');
    await grid.press('ArrowDown');
    await grid.press('Control+Space');
    await grid.press('Shift+F10');
    await expect(page.getByRole('menuitem', { name: 'Sort ascending…', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    const bounds = await grid.boundingBox();
    await page.mouse.move(bounds.x + 80, bounds.y + 48);
    await page.mouse.down();
    await page.mouse.move(bounds.x + 80, bounds.y + 144, { steps: 10 });
    await page.mouse.up();
    expect(
      await page.evaluate(() => window.grid.getSelectionRanges().map((range) => [range.startRow, range.endRow])),
    ).toEqual([
      [4, 4],
      [1, 2],
    ]);
    expect(await page.evaluate(() => window.grid.copySelection().split(/\r?\n/))).toEqual(['A', 'A', 'B']);
    await page.locator('[data-grid-data-group="0"]').click();
    await expect.poll(() => page.evaluate(() => window.grid.rowCount)).toBe(3);
    expect(await page.evaluate(() => window.grid.getSelection())).toBeNull();
    expect(await page.evaluate(() => window.grid.getFocusedGroup())).toBe(0);
    await expect(grid).toBeFocused();
    await grid.press('ArrowRight');
    await expect.poll(() => page.evaluate(() => window.grid.rowCount)).toBe(5);
    await grid.press('ArrowDown');
    expect(await page.evaluate(() => window.grid.getSelection().rowId)).toBe('a');
    await grid.press('ArrowRight');
    await grid.press('F2');
    await page.getByRole('textbox').fill('40');
    await page.getByRole('textbox').press('Enter');
    expect(await page.evaluate(() => window.grid.getRowMetadata(0).sums.amount)).toBe(60);
    await page.evaluate(() => window.grid.undo());
    expect(await page.evaluate(() => window.grid.getRowMetadata(0).sums.amount)).toBe(30);
    await grid.press('Control+Home');
    await grid.press('ArrowDown');
    await grid.press('ArrowUp');
    expect(await page.evaluate(() => window.grid.getFocusedGroup())).toBe(0);
    await grid.press('Enter');
    await expect.poll(() => page.evaluate(() => window.grid.rowCount)).toBe(3);
    await grid.press('Space');
    await expect.poll(() => page.evaluate(() => window.grid.rowCount)).toBe(5);
    if (accessibility === 'viewport') {
      await expect(grid.getByRole('row', { name: 'Group A, 2 records', exact: true })).toHaveAttribute(
        'aria-expanded',
        'true',
      );
      await expect(grid.getByRole('row', { name: 'Group A, 2 records', exact: true })).toHaveAttribute(
        'aria-level',
        '1',
      );
    }
    expect(await page.evaluate(() => [...new Set(window.rendered)].sort())).toEqual(['a', 'b', 'c']);
    expect(errors).toEqual([]);
    expect(await page.evaluate(() => window.grid.takeObserverErrors().length)).toBe(0);
    await page.evaluate(() => window.grid.setGrouping(null));
    await expect(page.getByRole('grid')).toBeVisible();
    expect(await page.evaluate(() => window.grid.rowCount)).toBe(3);
  });
}

test('group disclosure works without index column, localizes and falls back when key column is hidden', async ({
  page,
}) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const { createGrid } = await import('/canvas/index.js');
    const { LocalDataSource } = await import('/core/index.js');
    window.grid = createGrid({
      container: document.querySelector('#grid'),
      accessibility: 'viewport',
      indexColumn: false,
      locale: 'vi',
      dataSource: new LocalDataSource(
        [
          { id: 1, team: 'A', amount: 10 },
          { id: 2, team: 'A', amount: 20 },
        ],
        (r) => r.id,
      ),
      columns: [
        { key: 'team', title: 'Team' },
        { key: 'amount', title: 'Amount' },
      ],
    });
    window.grid.setGrouping({ columnKey: 'team', sumColumns: ['amount'] });
  });
  const grid = page.getByRole('treegrid');
  await expect(grid.getByRole('gridcell', { name: 'A (2)', exact: true })).toBeVisible();
  await expect(grid.getByRole('row', { name: 'Nhóm A, 2 bản ghi', exact: true })).toBeVisible();
  const box = await grid.boundingBox();
  await page.mouse.click(box.x + 15, box.y + 16);
  await expect.poll(() => page.evaluate(() => window.grid.rowCount)).toBe(1);
  await grid.press('ArrowRight');
  await expect.poll(() => page.evaluate(() => window.grid.rowCount)).toBe(3);
  await page.evaluate(() => window.grid.setColumnsHidden([0], true));
  await expect(grid.getByRole('gridcell', { name: 'A (2) · 30', exact: true })).toBeVisible();
  expect(await page.evaluate(() => window.grid.takeObserverErrors().length)).toBe(0);
});

test('grouped viewport accessibility stays bounded while scrolling a complete local working set', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const { createGrid } = await import('/canvas/index.js');
    const { LocalDataSource } = await import('/core/index.js');
    const source = new LocalDataSource(
      Array.from({ length: 10_000 }, (_, id) => ({ id, team: 'Team ' + Math.floor(id / 10), amount: id })),
      (row) => row.id,
    );
    const getValue = source.getValue.bind(source);
    window.reads = 0;
    source.getValue = (...args) => {
      window.reads++;
      return getValue(...args);
    };
    window.grid = createGrid({
      container: document.querySelector('#grid'),
      accessibility: 'viewport',
      dataSource: source,
      grouping: { columnKey: 'team', sumColumns: ['amount'] },
      columns: [
        { key: 'team', title: 'Team' },
        { key: 'amount', title: 'Amount' },
      ],
    });
  });
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  await page.evaluate(() => {
    window.reads = 0;
    const grid = document.querySelector('[role=treegrid]');
    grid.scrollTop = 200_000;
    grid.dispatchEvent(new Event('scroll'));
  });
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  expect(await page.getByRole('treegrid').getByRole('row').count()).toBeLessThan(40);
  expect(await page.evaluate(() => window.reads)).toBeLessThan(1000);
  expect(await page.evaluate(() => window.grid.rowCount)).toBe(11_000);
  expect(await page.evaluate(() => window.grid.takeObserverErrors().length)).toBe(0);
});

test('host-managed views reject grouping before mounting or changing view state', async ({ page }) => {
  await page.goto('/');
  const results = await page.evaluate(async () => {
    const { createGrid } = await import('/canvas/index.js');
    return [{ viewMode: 'host' }, { onViewChange: () => {} }].map((view) => {
      const container = document.createElement('div');
      container.style.cssText = 'width:400px;height:240px';
      document.body.append(container);
      const options = {
        ...view,
        container,
        columns: [{ key: 'team', title: 'Team' }],
        dataSource: { getRowCount: () => 1, getRowId: () => 1, getValue: () => 'A' },
      };
      const message = (action) => {
        try {
          action();
          return null;
        } catch (error) {
          return error.message;
        }
      };
      const initial = message(() => createGrid({ ...options, grouping: { columnKey: 'team' } }));
      const clean = container.children.length === 0;
      const grid = createGrid(options);
      const change = message(() => grid.setGrouping({ columnKey: 'team' }));
      const restore = message(() =>
        grid.restoreGroupingState({ version: 1, grouping: { columnKey: 'team' }, collapsedKeys: [] }),
      );
      const unchanged = grid.grouping === null && grid.rowCount === 1;
      grid.destroy();
      container.remove();
      return { initial, change, restore, clean, unchanged };
    });
  });
  for (const result of results) {
    expect(result).toEqual({
      initial: 'Grouping requires a core-managed local view.',
      change: 'Grouping requires a core-managed local view.',
      restore: 'Grouping requires a core-managed local view.',
      clean: true,
      unchanged: true,
    });
  }
});
