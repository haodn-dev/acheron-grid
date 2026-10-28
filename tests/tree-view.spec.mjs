import { test, expect } from '@playwright/test';

async function mount(page, accessibility = 'viewport', extra = {}) {
  await page.goto('/');
  await page.evaluate(
    async ({ accessibility, extra }) => {
      const { createGrid } = await import('/canvas/index.js');
      const { LocalDataSource } = await import('/core/index.js');
      window.source = new LocalDataSource(
        [
          { id: 0, parent: null, name: 'Roadmap', amount: 0 },
          { id: '', parent: 0, name: 'Delivery', amount: 0 },
          { id: 'task', parent: '', name: 'Review', amount: 10 },
          { id: 'next', parent: 0, name: 'Release', amount: 20 },
          { id: 'other', parent: null, name: 'Archive', amount: 0 },
        ],
        (row) => row.id,
      );
      window.rendered = [];
      window.grid = createGrid({
        container: document.querySelector('#grid'),
        dataSource: window.source,
        tree: { parentColumnKey: 'parent' },
        accessibility,
        autoRowHeight: true,
        columns: ['name', 'amount', 'parent'].map((key) => ({
          key,
          title: key,
          editable: true,
          ...(key === 'amount' ? { parse: Number } : {}),
        })),
        renderCell: (_ctx, cell) => {
          window.rendered.push({ rowId: cell.rowId, columnKey: cell.columnKey, x: cell.x, width: cell.width });
          return false;
        },
        ...extra,
      });
      window.treeState = window.grid.exportTreeState();
    },
    { accessibility, extra },
  );
}

for (const accessibility of ['active', 'viewport']) {
  test(`Canvas tree pointer, keyboard, record editing and ARIA agree (${accessibility})`, async ({ page }) => {
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await mount(page, accessibility);
    const grid = page.getByRole('treegrid');
    await expect(grid).toHaveAttribute('aria-rowcount', accessibility === 'viewport' ? '6' : '5');
    expect(
      await page.evaluate(() => window.rendered.find((cell) => cell.rowId === 'task' && cell.columnKey === 'name').x),
    ).toBe(48);
    await grid.press('Control+Home');
    await grid.press('ArrowDown');
    await grid.press('ArrowDown');
    await expect
      .poll(() =>
        page.evaluate(() => {
          const viewport = document.querySelector('[role=treegrid]');
          return document
            .getElementById(viewport.getAttribute('aria-activedescendant'))
            ?.closest('[role=row]')
            ?.getAttribute('aria-level');
        }),
      )
      .toBe('3');
    await grid.press('ArrowLeft');
    expect(await page.evaluate(() => window.grid.getSelection().rowId)).toBe('');
    await grid.press('ArrowLeft');
    expect(await page.evaluate(() => window.grid.rowCount)).toBe(4);
    await grid.press('ArrowLeft');
    expect(await page.evaluate(() => window.grid.getSelection().rowId)).toBe(0);
    await grid.press('ArrowLeft');
    expect(await page.evaluate(() => window.grid.rowCount)).toBe(2);
    await expect(page.locator('[data-grid-tree-row="0"]')).toHaveAttribute('aria-expanded', 'false');
    await page.locator('[data-grid-tree-row="0"]').click();
    await expect.poll(() => page.evaluate(() => window.grid.rowCount)).toBe(4);
    await page.evaluate(() => window.grid.restoreTreeState(window.treeState));
    const bounds = await grid.boundingBox();
    await page.mouse.click(bounds.x + 12, bounds.y + 16);
    await expect.poll(() => page.evaluate(() => window.grid.rowCount)).toBe(2);
    await grid.press('ArrowRight');
    await expect.poll(() => page.evaluate(() => window.grid.rowCount)).toBe(5);
    await grid.press('ArrowRight');
    expect(await page.evaluate(() => window.grid.getSelection().rowId)).toBe('');
    await grid.press('ArrowRight');
    expect(await page.evaluate(() => window.grid.getSelection().rowId)).toBe('task');
    await grid.press('ArrowRight'); // leaf keeps normal cell navigation
    await grid.press('F2');
    await page.getByRole('textbox').fill('50');
    await page.getByRole('textbox').press('Enter');
    expect(await page.evaluate(() => window.source.getValue(2, 'amount'))).toBe(50);
    await page.evaluate(() => window.grid.undo());
    expect(await page.evaluate(() => window.source.getValue(2, 'amount'))).toBe(10);
    expect(await page.evaluate(() => window.grid.getCellPermission(2, 2).editable)).toBe(false);
    await page.mouse.click(bounds.x + 2, bounds.y + 95);
    expect(await page.evaluate(() => window.grid.rowCount)).toBe(5);
    await expect(page.locator('[data-grid-row-resize]')).toHaveCount(0);
    expect(await page.evaluate(() => [...new Set(window.rendered.map((cell) => cell.rowId))])).toEqual([
      0,
      '',
      'task',
      'next',
      'other',
    ]);
    await page.evaluate(() => window.grid.setColumnsHidden([0, 1, 2], true));
    await page.locator('[data-grid-tree-row="0"]').click();
    expect(errors).toEqual([]);
    await expect.poll(() => page.evaluate(() => window.grid.rowCount)).toBe(2);
    expect(await page.evaluate(() => window.grid.takeObserverErrors())).toEqual([]);
    expect(errors).toEqual([]);
  });
}

test('tree disclosure follows the first visible column with bounded deep/narrow gutters and localized labels', async ({
  page,
}) => {
  await mount(page, 'viewport', { locale: 'vi', rowIndexWidth: 0 });
  await page.evaluate(() => window.grid.setColumnsHidden([0], true));
  const grid = page.getByRole('treegrid');
  const bounds = await grid.boundingBox();
  await page.mouse.click(bounds.x + 12, bounds.y + 16);
  await expect.poll(() => page.evaluate(() => window.grid.rowCount)).toBe(2);
  await expect(page.locator('[role=status]').filter({ hasText: 'Cấp 1' })).toContainText('Đã thu gọn');
  await grid.press('ArrowRight');
  expect(await page.evaluate(() => window.grid.rowCount)).toBe(5);
  const geometry = await page.evaluate(async () => {
    const { treeIndent } = await import('/canvas/internal/display.js');
    return [treeIndent(1, 160), treeIndent(4096, 160), treeIndent(4096, 60), treeIndent(1, 30)];
  });
  expect(geometry).toEqual([24, 120, 36, 0]);
  expect(await page.evaluate(() => window.grid.takeObserverErrors())).toEqual([]);
});

test('tree viewport accessibility and page navigation stay bounded across 10k real records', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const { createGrid } = await import('/canvas/index.js');
    const { LocalDataSource } = await import('/core/index.js');
    const source = new LocalDataSource(
      Array.from({ length: 10000 }, (_, id) => ({ id, parent: id ? 0 : null, name: `Record ${id}` })),
      (row) => row.id,
    );
    const read = source.getValue.bind(source);
    window.reads = 0;
    source.getValue = (...args) => {
      window.reads++;
      return read(...args);
    };
    window.grid = createGrid({
      container: document.querySelector('#grid'),
      dataSource: source,
      tree: { parentColumnKey: 'parent' },
      accessibility: 'viewport',
      columns: [
        { key: 'name', title: 'Name' },
        { key: 'parent', title: 'Parent' },
      ],
    });
  });
  const grid = page.getByRole('treegrid');
  await grid.press('Control+End');
  await expect.poll(() => page.evaluate(() => window.grid.getSelection()?.rowId)).toBe(9999);
  await grid.press('PageUp');
  expect(await page.evaluate(() => window.grid.getSelection().rowIndex)).toBeLessThan(9999);
  await page.evaluate(() => {
    window.reads = 0;
    const viewport = document.querySelector('[role=treegrid]');
    viewport.scrollTop = 100000;
    viewport.dispatchEvent(new Event('scroll'));
  });
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  expect(await grid.getByRole('row').count()).toBeLessThan(40);
  expect(await page.evaluate(() => window.reads)).toBeLessThan(1000);
  expect(await page.evaluate(() => window.grid.takeObserverErrors())).toEqual([]);
});

test('host-managed tree construction and state changes reject before partial mount', async ({ page }) => {
  await page.goto('/');
  const results = await page.evaluate(async () => {
    const { createGrid } = await import('/canvas/index.js');
    return [{ viewMode: 'host' }, { onViewChange: () => {} }].map((view) => {
      const container = document.createElement('div');
      container.style.cssText = 'width:400px;height:240px';
      document.body.append(container);
      const options = {
        container,
        ...view,
        columns: [{ key: 'parent', title: 'Parent' }],
        dataSource: { getRowCount: () => 1, getRowId: () => 0, getValue: () => null },
      };
      const fails = (action) => {
        try {
          action();
          return false;
        } catch (error) {
          return /core-managed/.test(error.message);
        }
      };
      const initial = fails(() => createGrid({ ...options, tree: { parentColumnKey: 'parent' } }));
      const clean = container.children.length === 0;
      const grid = createGrid(options);
      const setter = fails(() => grid.setTree({ parentColumnKey: 'parent' }));
      const restore = fails(() =>
        grid.restoreTreeState({ version: 1, tree: { parentColumnKey: 'parent' }, collapsedIds: [] }),
      );
      const unchanged = grid.tree === null && grid.rowCount === 1;
      grid.destroy();
      return { initial, clean, setter, restore, unchanged };
    });
  });
  expect(results).toEqual(
    Array.from({ length: 2 }, () => ({ initial: true, clean: true, setter: true, restore: true, unchanged: true })),
  );
});

test('tree auto-fit includes the depth gutter in content width', async ({ page }) => {
  await mount(page);
  await expect(page.locator('[data-grid-tree-row="0"]')).toBeAttached();
  const expected = await page.evaluate(() => {
    const ctx = document.createElement('canvas').getContext('2d');
    ctx.font = getComputedStyle(document.querySelector('[role=treegrid]').parentElement).getPropertyValue(
      '--acheron-font',
    );
    const minimum = Math.ceil(ctx.measureText('Review').width + 20 + 48);
    window.grid.autoFitColumn(0);
    return minimum;
  });
  await expect
    .poll(async () => (await page.locator('[data-grid-header-cell="0"]').boundingBox())?.width ?? 0)
    .toBeGreaterThanOrEqual(expected);
});
