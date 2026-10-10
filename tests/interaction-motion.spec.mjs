import { test, expect } from './browser-fixtures.mjs';
async function setup(page, motion = { duration: 400 }) {
  await page.goto('/');
  await page.evaluate(async (motion) => {
    const { createGrid } = await import('/canvas/index.js'),
      { LocalDataSource } = await import('/core/index.js');
    window.requests = [];
    window.grid = createGrid({
      container: document.querySelector('#grid'),
      accessibility: 'viewport',
      motion,
      columns: [
        { key: 'name', title: 'Name' },
        { key: 'score', title: 'Score' },
        { key: 'team', title: 'Team' },
      ],
      dataSource: (window.source = new LocalDataSource(
        Array.from({ length: 30 }, (_, id) => ({ id, name: 'Asset ' + id, score: 30 - id, team: id % 2 ? 'A' : 'B' })),
        (row) => row.id,
      )),
      onReorder: (request) => {
        window.requests.push(request);
        request.axis === 'column'
          ? window.grid.moveColumns(request.indices, request.beforeIndex)
          : window.grid.moveRows(request.indices, request.beforeIndex);
      },
    });
  }, motion);
}
test('sort and filter animate bounded strips immediately, update icons and cancel safely', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await setup(page);
  const result = await page.evaluate(() => {
    window.grid.setView({ sorts: [{ columnKey: 'score', direction: 'asc' }] });
    return {
      id: window.grid.getSelection()?.rowId,
      layers: document.querySelectorAll('[data-grid-motion]').length,
      icons: document.querySelector('[data-grid-header-state="arrow-up"]').getAnimations().length,
    };
  });
  expect(result.layers).toBeGreaterThan(0);
  expect(result.layers).toBeLessThanOrEqual(64);
  expect(result.icons).toBe(1);
  await expect(page.locator('[data-grid-header-cell="1"]')).toHaveAttribute('aria-sort', 'ascending');
  await expect(page.locator('[role=row][aria-rowindex="2"]')).toContainText('Asset 29');
  await page.evaluate(() =>
    window.grid.setView({
      sorts: [{ columnKey: 'score', direction: 'desc' }],
      filters: [{ columnKey: 'team', operator: 'equals', query: 'A' }],
    }),
  );
  await expect(page.locator('[data-grid-header-state="funnel"]')).toHaveCount(1);
  await expect(page.getByRole('grid')).toHaveAttribute('aria-rowcount', '16');
  await page.getByRole('grid').evaluate((el) => el.dispatchEvent(new Event('scroll')));
  await expect(page.locator('[data-grid-motion]')).toHaveCount(0);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.evaluate(() => window.grid.setView({ sorts: [{ columnKey: 'score', direction: 'asc' }] }));
  await expect(page.locator('[data-grid-motion]')).toHaveCount(0);
  expect(await page.locator('[data-grid-header-state="arrow-up"]').evaluate((el) => el.getAnimations().length)).toBe(0);
  await page.evaluate(() => window.grid.destroy());
  await expect(page.locator('[data-grid-header-state]')).toHaveCount(0);
});
test('pointer drag shows a real row or column ghost, commits on release, cancels and permits columns under sort', async ({
  page,
}, testInfo) => {
  await setup(page);
  await page.evaluate(() => window.grid.selectRow(0));
  const row = page.getByRole('button', { name: 'Select row 1', exact: true });
  await expect(row).toBeVisible();
  const bounds = await row.boundingBox();
  await page.mouse.move(bounds.x + 10, bounds.y + bounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 10, bounds.y + 100, { steps: 8 });
  await expect(page.locator('[data-grid-drag-ghost="row"]')).toBeVisible();
  await expect(page.locator('[data-grid-reorder-guide]')).toBeVisible();
  expect(await page.evaluate(() => window.requests.length)).toBe(0);
  await page.mouse.up();
  expect(await page.evaluate(() => window.requests.length)).toBe(1);
  await expect(page.locator('[data-grid-drag-ghost]')).toHaveCount(0);
  await page.evaluate(() => {
    window.grid.setView({ sorts: [{ columnKey: 'score', direction: 'asc' }] });
    window.grid.selectColumn(0);
  });
  await expect(page.locator('[data-grid-motion]')).toHaveCount(0);
  const col = await page.locator('[data-grid-header-cell="0"]').boundingBox();
  await page.mouse.move(col.x + 50, col.y + col.height / 2);
  await page.mouse.down();
  await page.mouse.move(col.x + 250, col.y + col.height / 2, { steps: 8 });
  await expect(page.locator('[data-grid-drag-ghost="column"]')).toBeVisible();
  await page.mouse.up();
  expect(await page.evaluate(() => window.grid.columns.map((c) => c.key))).toEqual(['score', 'name', 'team']);
  await expect(page.locator('[data-grid-header-state="arrow-up"]')).toHaveCount(1);
  await page.evaluate(() => window.grid.selectColumn(1));
  await expect(page.locator('[data-grid-header-cell="1"]')).toBeVisible();
  const next = await page.locator('[data-grid-header-cell="1"]').boundingBox();
  await page.mouse.move(next.x + 50, next.y + next.height / 2);
  await page.mouse.down();
  await page.mouse.move(next.x + 100, next.y + next.height / 2);
  await expect(page.locator('[data-grid-drag-ghost]')).toHaveCount(1);
  await page.keyboard.press('Escape');
  await page.mouse.up();
  await expect(page.locator('[data-grid-drag-ghost]')).toHaveCount(0);
  expect(await page.evaluate(() => window.requests.length)).toBe(2);
  await page.screenshot({ path: testInfo.outputPath('grid-motion-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: testInfo.outputPath('grid-motion-mobile.png') });
});

test('live refresh keeps an in-progress column drag and commits it once', async ({ page }) => {
  await setup(page);
  await page.evaluate(() => window.grid.setView({ sorts: [{ columnKey: 'score', direction: 'asc' }] }));
  await page.evaluate(() => window.grid.selectColumn(0));
  const col = await page.locator('[data-grid-header-cell="0"]').boundingBox();
  await page.mouse.move(col.x + 50, col.y + col.height / 2);
  await page.mouse.down();
  await page.mouse.move(col.x + 250, col.y + col.height / 2, { steps: 8 });
  await expect(page.locator('[data-grid-drag-ghost="column"]')).toBeVisible();
  for (let tick = 1; tick <= 3; tick++) {
    await page.evaluate((tick) => {
      window.source.setValue(0, 'score', tick);
      window.grid.refreshData('values');
      window.grid.render();
    }, tick);
    await expect(page.locator('[data-grid-drag-ghost="column"]')).toBeVisible();
    expect(await page.evaluate(() => window.requests.length)).toBe(0);
  }
  await page.mouse.up();
  expect(await page.evaluate(() => window.requests.length)).toBe(1);
  expect(await page.evaluate(() => window.grid.columns.map((column) => column.key))).toEqual(['score', 'name', 'team']);
  await expect(page.locator('[data-grid-drag-ghost]')).toHaveCount(0);
});

test('selection exits, visibility and replay use live customizable motion without delaying state', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await setup(page);
  const viewport = page.getByRole('grid');
  await viewport.click({ position: { x: 40, y: 16 } });
  await viewport.click({ position: { x: 200, y: 80 }, modifiers: ['Control'] });
  await viewport.click({ position: { x: 40, y: 16 } });
  await expect(page.locator('[data-grid-selection-exit]')).not.toHaveCount(0);
  await expect(page.locator('[data-grid-selection-exit]')).toHaveCount(0);
  const hidden = await page.evaluate(() => {
    window.grid.setMotion({ duration: 400, easing: 'linear', selectionDuration: 180, surfaceDuration: 90 });
    window.grid.setColumnsHidden([1], true);
    return {
      hidden: window.grid.getHiddenColumns(),
      tiles: document.querySelectorAll('[data-grid-motion="column"]').length,
      settings: window.grid.getMotion(),
    };
  });
  expect(hidden.hidden).toEqual([1]);
  expect(hidden.tiles).toBeGreaterThan(0);
  expect(hidden.settings.easing).toBe('linear');
  await page.evaluate(() => window.grid.undo());
  expect(await page.evaluate(() => window.grid.getHiddenColumns())).toEqual([]);
  await expect(page.locator('[data-grid-motion="column"]')).not.toHaveCount(0);
  await page.evaluate(() => window.grid.setRowsHidden([0], true));
  expect(await page.evaluate(() => window.grid.getHiddenRows())).toEqual([0]);
  await expect(page.locator('[data-grid-motion="row"]')).not.toHaveCount(0);
  await page.evaluate(() => window.grid.setMotion(false));
  await expect(page.locator('[data-grid-motion]')).toHaveCount(0);
  await page.evaluate(() => window.grid.setRowsHidden([0], false));
  await expect(page.locator('[data-grid-motion]')).toHaveCount(0);
  const validation = await page.evaluate(() => {
    const before = window.grid.getMotion();
    let errors = 0;
    for (const value of [
      { duration: -1 },
      { selectionDuration: Infinity },
      { easing: 'invalid-easing' },
      { layout: 'yes' },
    ]) {
      try {
        window.grid.setMotion(value);
      } catch {
        errors++;
      }
    }
    return { errors, same: JSON.stringify(before) === JSON.stringify(window.grid.getMotion()) };
  });
  expect(validation).toEqual({ errors: 4, same: true });
});

test('header state controls open sort and filter dialogs by mouse and keyboard', async ({ page }) => {
  await setup(page);
  await page.evaluate(() =>
    window.grid.setView({
      sort: { columnKey: 'score', direction: 'asc' },
      filters: [{ columnKey: 'team', query: 'A' }],
    }),
  );
  await page.getByRole('button', { name: 'Sort column Score', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Change row view' })).toBeVisible();
  await page.getByRole('button', { name: 'Apply view', exact: true }).click();
  expect(await page.evaluate(() => window.grid.view.sort.direction)).toBe('desc');
  const filter = page.getByRole('button', { name: 'Filter column Team', exact: true });
  await filter.focus();
  await filter.press('Enter');
  await expect(page.getByRole('dialog', { name: 'Filter column', exact: true })).toBeVisible();
  await expect(page.getByRole('searchbox', { name: 'Contains text' })).toHaveValue('A');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
});

test('live value refresh and repaint keep header context menu and keyboard focus, invalid targets close safely', async ({
  page,
}) => {
  await setup(page);
  await page.evaluate(() => window.grid.setView({ sort: { columnKey: 'score', direction: 'asc' } }));
  await page.locator('[data-grid-header-cell="1"]').click({ button: 'right' });
  const menu = page.getByRole('menu', { name: 'Column actions' });
  await expect(menu).toBeVisible();
  const action = menu.getByRole('menuitem', { name: 'Hide selected columns', exact: true });
  await action.focus();
  await page.evaluate(() => {
    window.menuBefore = document.querySelector('[role=menu]');
    for (let tick = 0; tick < 5; tick++) {
      window.source.setValues([{ rowIndex: 0, columnKey: 'score', value: 100 + tick }]);
      window.grid.refreshData('values');
      window.grid.render();
    }
  });
  await expect(menu).toBeVisible();
  await expect(action).toBeFocused();
  expect(await page.evaluate(() => window.menuBefore === document.querySelector('[role=menu]'))).toBe(true);
  await action.click();
  expect(await page.evaluate(() => window.grid.getHiddenColumns())).toEqual([1]);
  await expect(menu).not.toBeVisible();
  await page.evaluate(() => window.grid.setView({}));
  await page.getByRole('grid').click({ button: 'right', position: { x: 40, y: 16 } });
  await expect(page.getByRole('menu', { name: 'Cell actions' })).toBeVisible();
  await page.evaluate(() => window.grid.deleteRows([0]));
  await expect(page.getByRole('menu', { name: 'Cell actions' })).not.toBeVisible();
});

test('live sort animation is opt-in, moves stable records and keeps header menu open', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await setup(page);
  await page.evaluate(() => window.grid.setView({ sort: { columnKey: 'score', direction: 'asc' } }));
  await expect(page.locator('[data-grid-motion]')).toHaveCount(0);
  await page.locator('[data-grid-header-cell="1"]').click({ button: 'right' });
  const menu = page.getByRole('menu', { name: 'Column actions' });
  await page.evaluate(() => {
    window.source.setValues([{ rowIndex: 29, columnKey: 'score', value: 100 }]);
    window.grid.refreshData('values');
  });
  await expect(menu).toBeVisible();
  await expect(page.locator('[data-grid-motion]')).toHaveCount(0);
  const moving = await page.evaluate(() => {
    window.grid.setMotion({ duration: 400, liveSort: true });
    window.source.setValues([{ rowIndex: 29, columnKey: 'score', value: 0 }]);
    window.grid.refreshData('values');
    return document.querySelectorAll('[data-grid-motion="row"]').length;
  });
  expect(moving).toBeGreaterThan(0);
  expect(moving).toBeLessThanOrEqual(64);
  await expect(menu).toBeVisible();
  await expect(page.locator('[role=row][aria-rowindex="2"]:not([hidden])')).toContainText('Asset 29');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.evaluate(() => {
    window.source.setValues([{ rowIndex: 29, columnKey: 'score', value: 200 }]);
    window.grid.refreshData('values');
  });
  await expect(page.locator('[data-grid-motion]')).toHaveCount(0);
});

test('selection exit drops obsolete borders and never paints inside the retained selection', async ({ page }) => {
  await setup(page, { duration: 400, selectionDuration: 400 });
  const viewport = page.getByRole('grid');
  await viewport.click({ position: { x: 40, y: 60 } });
  await viewport.click({ position: { x: 200, y: 100 }, modifiers: ['Control'] });
  await viewport.click({ position: { x: 340, y: 140 }, modifiers: ['Control'] });
  expect(await page.evaluate(() => window.grid.getSelectionRanges().length)).toBeGreaterThan(1);
  await viewport.click({ position: { x: 40, y: 60 } });
  await expect(page.locator('[data-grid-selection-exit]')).not.toHaveCount(0);
  expect(
    await page
      .locator('[data-grid-selection-exit]')
      .evaluateAll((nodes) => nodes.every((node) => getComputedStyle(node).borderStyle === 'none')),
  ).toBe(true);
  await viewport.click({ position: { x: 200, y: 100 }, modifiers: ['Control'] });
  await viewport.click({ position: { x: 340, y: 140 }, modifiers: ['Control'] });
  await page.evaluate(() => window.grid.selectAll());
  await expect(page.locator('[data-grid-selection-exit]')).toHaveCount(0);
});

test('live arrows compare successive values and charts animate without data writes, respect reduced motion and settings', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/');
  await page.evaluate(async () => {
    const { createGrid } = await import('/canvas/index.js');
    const { LocalDataSource } = await import('/core/index.js');
    const { createChartRenderer } = await import('/charts/index.js');
    window.samples = [];
    window.arrowColors = [];
    const fill = CanvasRenderingContext2D.prototype.fill;
    CanvasRenderingContext2D.prototype.fill = function (...args) {
      window.arrowColors.push(this.fillStyle);
      return fill.apply(this, args);
    };
    const chart = createChartRenderer({ trend: { kind: 'line', domain: [0, 10], markerRadius: 0 } });
    window.source = new LocalDataSource([{ id: 1, price: 10, trend: [0, 10] }], (row) => row.id);
    window.grid = createGrid({
      container: document.querySelector('#grid'),
      columns: [
        { key: 'price', title: 'Price' },
        { key: 'trend', title: 'Trend' },
      ],
      dataSource: window.source,
      motion: { duration: 400, easing: 'linear', valueIndicators: true, chartUpdates: true },
      theme: { increaseColor: '#123456', decreaseColor: '#654321' },
      renderCell: (ctx, cell) => {
        if (cell.columnKey === 'trend')
          window.samples.push({ progress: cell.animationProgress, previous: cell.previousValue, value: cell.value });
        return chart(ctx, cell);
      },
    });
  });
  await expect.poll(() => page.evaluate(() => window.samples.length)).toBeGreaterThan(0);
  await page.evaluate(() => {
    window.samples = [];
    window.arrowColors = [];
    window.source.setValue(0, 'price', 12);
    window.source.setValue(0, 'trend', [10, 0, 5]);
    window.grid.refreshData('values');
  });
  await expect.poll(() => page.evaluate(() => window.samples.some((s) => s.progress > 0 && s.progress < 1))).toBe(true);
  await expect.poll(() => page.evaluate(() => window.samples.at(-1)?.progress)).toBe(1);
  expect(await page.evaluate(() => window.arrowColors.includes('#123456'))).toBe(true);
  expect(await page.evaluate(() => window.source.getValue(0, 'trend'))).toEqual([10, 0, 5]);
  await page.evaluate(() => {
    window.arrowColors = [];
    window.source.setValue(0, 'price', -2);
    window.grid.refreshData('values');
  });
  await expect.poll(() => page.evaluate(() => window.arrowColors.includes('#654321'))).toBe(true);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.evaluate(() => {
    window.samples = [];
    window.source.setValue(0, 'trend', [5, 5]);
    window.grid.refreshData('values');
  });
  await expect.poll(() => page.evaluate(() => window.samples.length)).toBeGreaterThan(0);
  expect(await page.evaluate(() => window.samples.every((s) => s.progress === 1))).toBe(true);
  await page.evaluate(() => {
    window.grid.setMotion(false);
    window.arrowColors = [];
    window.samples = [];
    window.source.setValue(0, 'price', 8);
    window.source.setValue(0, 'trend', [0, 10]);
    window.grid.refreshData('values');
  });
  await expect.poll(() => page.evaluate(() => window.samples.length)).toBeGreaterThan(0);
  expect(
    await page.evaluate(() => window.arrowColors.includes('#123456') || window.arrowColors.includes('#654321')),
  ).toBe(false);
  expect(await page.evaluate(() => window.samples.every((s) => (s.progress ?? 1) === 1))).toBe(true);
});

test('live value indicator gutters preserve formatted cell backgrounds', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const { createGrid } = await import('/canvas/index.js');
    const { LocalDataSource } = await import('/core/index.js');
    window.source = new LocalDataSource([{ id: 1, price: 10 }], (row) => row.id);
    window.grid = createGrid({
      container: document.querySelector('#grid'),
      columns: [{ key: 'price', title: 'Price' }],
      dataSource: window.source,
      motion: { valueIndicators: true },
    });
    window.grid.format([{ scope: 'column', columnIndex: 0 }], { background: '#123456' });
  });
  const pixel = () =>
    page.locator('canvas').evaluate((canvas) => {
      const scale = canvas.width / canvas.clientWidth;
      return Array.from(canvas.getContext('2d').getImageData(Math.round(2 * scale), Math.round(42 * scale), 1, 1).data);
    });
  await expect.poll(pixel).toEqual([18, 52, 86, 255]);
  for (const price of [12, 8]) {
    await page.evaluate(async (price) => {
      window.source.setValue(0, 'price', price);
      window.grid.refreshData('values');
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    }, price);
    await expect.poll(pixel).toEqual([18, 52, 86, 255]);
  }
  await page.evaluate(async () => {
    window.grid.format([{ scope: 'column', columnIndex: 0 }], null);
    window.grid.setTheme({ background: 'rgba(18, 52, 86, 0.5)' });
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  const translucent = await pixel();
  for (const price of [15, 4]) {
    await page.evaluate(async (price) => {
      window.source.setValue(0, 'price', price);
      window.grid.refreshData('values');
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    }, price);
    expect(await pixel()).toEqual(translucent);
  }
});

test('full-cell background effects cover the direction gutter for handled and fallback content', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const { createGrid } = await import('/canvas/index.js');
    const { LocalDataSource } = await import('/core/index.js');
    window.source = new LocalDataSource([{ id: 1, price: 10 }], (row) => row.id);
    window.handled = true;
    window.grid = createGrid({
      container: document.querySelector('#grid'),
      indexColumn: false,
      columns: [{ key: 'price', title: 'Price' }],
      dataSource: window.source,
      motion: { valueIndicators: true },
      renderCellBackground: (ctx, cell) => {
        ctx.globalAlpha = 0.3;
        ctx.fillStyle = '#e11d48';
        ctx.fillRect(cell.x, cell.y, cell.width, cell.height);
      },
      renderCell: () => window.handled,
    });
  });
  const pixels = () =>
    page.locator('canvas').evaluate((canvas) => {
      const ratio = canvas.width / canvas.clientWidth;
      const ctx = canvas.getContext('2d');
      return [2, 24].map((x) => [...ctx.getImageData(Math.round(x * ratio), Math.round(36 * ratio), 1, 1).data]);
    });
  const uniformFlash = async () => {
    const [gutter, content] = await pixels();
    return gutter[0] > gutter[1] + 40 && gutter.every((value, index) => value === content[index]);
  };
  await expect.poll(uniformFlash).toBe(true);
  for (const [price, handled] of [
    [12, true],
    [8, false],
  ]) {
    await page.evaluate(
      ([price, handled]) => {
        window.handled = handled;
        window.source.setValue(0, 'price', price);
        window.grid.refreshData('values');
      },
      [price, handled],
    );
    await expect.poll(uniformFlash).toBe(true);
  }
});

test('hidden wrapped columns do not inflate rows after clearing a view', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const { createGrid } = await import('/canvas/index.js');
    const { LocalDataSource } = await import('/core/index.js');
    window.measured = [];
    window.grid = createGrid({
      container: document.querySelector('#grid'),
      columns: [
        { key: 'title', title: 'Title' },
        { key: 'category', title: 'Category' },
      ],
      dataSource: new LocalDataSource(
        Array.from({ length: 10 }, (_, id) => ({
          id,
          title: 'A long title that should wrap across several lines',
          category: 'Short',
        })),
        (row) => row.id,
      ),
      autoRowHeight: true,
      wrapText: true,
      rowHeight: 28,
      columnWidth: 120,
      motion: false,
      measureCellHeight: (value, key, width) => {
        window.measured.push({ key, width });
      },
    });
  });
  const row = page.getByRole('button', { name: 'Select row 1', exact: true });
  await expect.poll(() => row.evaluate((el) => el.offsetHeight)).toBeGreaterThan(28);
  await page.evaluate(() => window.grid.setColumnsHidden([0], true));
  await page.locator('[data-grid-header-cell="1"]').click({ button: 'right' });
  await page.getByRole('menuitem', { name: 'Clear sort and filters…', exact: true }).click();
  await page.getByRole('button', { name: 'Apply view', exact: true }).click();
  await expect.poll(() => row.evaluate((el) => el.offsetHeight)).toBeLessThan(60);
  expect(await page.evaluate(() => window.measured.some((item) => item.width <= 0))).toBe(false);
});

test('narrow grouped headers reserve icon space and ellipsize their titles', async ({ page }) => {
  await setup(page);
  await page.evaluate(() => {
    window.headerText = [];
    const ctx = document.querySelector('canvas').getContext('2d');
    const fill = ctx.fillText.bind(ctx);
    ctx.fillText = function (text, x, y, ...rest) {
      if (y < 40) window.headerText.push({ text, x, width: this.measureText(text).width });
      return fill(text, x, y, ...rest);
    };
    window.grid.setColumnWidth(1, 72);
    window.grid.setView({
      sort: { columnKey: 'score', direction: 'asc' },
      filters: [{ columnKey: 'score', query: '' }],
    });
  });
  const header = page.locator('[data-grid-header-cell="1"]');
  await expect(header.locator('[data-grid-header-state]')).toHaveCount(2);
  expect(
    await page.evaluate(() =>
      window.headerText.some((item) => item.text === '…' || item.text.endsWith('…') || item.text === ''),
    ),
  ).toBe(true);
  const icons = await header.locator('[data-grid-header-state]').evaluateAll((nodes) =>
    nodes.map((node) => {
      const r = node.getBoundingClientRect();
      return { left: r.left, right: r.right };
    }),
  );
  expect(icons[0].left).toBeGreaterThanOrEqual(icons[1].right);
});

test('minimum-width headers keep sort and filter controls reachable inside their own column', async ({ page }) => {
  await setup(page);
  await page.evaluate(() =>
    window.grid.setView({
      sort: { columnKey: 'score', direction: 'asc' },
      filters: [{ columnKey: 'score', query: '' }],
    }),
  );
  const header = page.locator('[data-grid-header-cell="1"]');
  for (const width of [24, 40, 55, 56]) {
    await page.evaluate((width) => window.grid.setColumnWidth(1, width), width);
    await expect.poll(() => header.evaluate((node) => node.offsetWidth)).toBe(width);
    expect(
      await header.evaluate((node) => {
        const column = node.getBoundingClientRect();
        return Array.from(node.querySelectorAll('[data-grid-header-state]')).every((button) => {
          const bounds = button.getBoundingClientRect();
          return bounds.left >= column.left && bounds.right <= column.right;
        });
      }),
    ).toBe(true);
    if (width < 54) {
      const actions = header.getByRole('button', { name: 'Sort and filter column Score', exact: true });
      await expect(actions).toBeVisible();
      await actions.click();
      await expect(page.getByRole('menuitem', { name: 'Sort ascending…', exact: true })).toBeVisible();
      await page.getByRole('menuitem', { name: 'Filter column…', exact: true }).click();
      await expect(page.getByRole('dialog', { name: 'Filter column', exact: true })).toBeVisible();
      await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    } else {
      await expect(header.locator('[data-grid-header-state]')).toHaveCount(2);
    }
  }
});

test('drag selection followed by click or Escape fades only removed tint and cancels on another drag', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await setup(page, { duration: 400, selectionDuration: 400 });
  const viewport = page.getByRole('grid');
  const box = await viewport.boundingBox();
  const start = { x: box.x + 40, y: box.y + 20 },
    end = { x: box.x + 300, y: box.y + 180 };
  async function drag() {
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(end.x, end.y, { steps: 8 });
    await page.mouse.up();
  }
  await drag();
  await expect.poll(() => page.evaluate(() => window.grid.getSelectionRange().endRow)).toBeGreaterThan(3);
  expect(await page.evaluate(() => window.grid.getSelectionRanges().length)).toBe(1);
  await page.mouse.click(start.x, start.y);
  await expect
    .poll(() =>
      page.evaluate(() => {
        const r = window.grid.getSelectionRange();
        return r.startRow === r.endRow && r.startColumn === r.endColumn;
      }),
    )
    .toBe(true);
  await expect(page.locator('[data-grid-selection-exit]')).not.toHaveCount(0);
  expect(
    await page
      .locator('[data-grid-selection-exit]')
      .evaluateAll((nodes) => nodes.every((n) => getComputedStyle(n).borderStyle === 'none')),
  ).toBe(true);
  await expect(page.locator('[data-grid-selection-exit]')).toHaveCount(0);
  await drag();
  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => window.grid.getSelectionRanges())).toEqual([]);
  await expect(page.locator('[data-grid-selection-exit]')).not.toHaveCount(0);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 8 });
  await expect(page.locator('[data-grid-selection-exit]')).toHaveCount(0);
  await page.mouse.up();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.mouse.click(start.x, start.y);
  await expect(page.locator('[data-grid-selection-exit]')).toHaveCount(0);
});

test('merging cells does not animate unrelated row or column strips', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await setup(page);
  const result = await page.evaluate(() => {
    const counts = [];
    for (const range of [
      { startRow: 0, endRow: 0, startColumn: 0, endColumn: 1 },
      { startRow: 0, endRow: 1, startColumn: 0, endColumn: 0 },
    ]) {
      window.grid.mergeCells(range);
      counts.push(document.querySelectorAll('[data-grid-motion]').length);
      window.grid.unmergeCells(range);
      counts.push(document.querySelectorAll('[data-grid-motion]').length);
      window.grid.undo();
      counts.push(document.querySelectorAll('[data-grid-motion]').length);
      window.grid.redo();
      counts.push(document.querySelectorAll('[data-grid-motion]').length);
    }
    return counts;
  });
  expect(result).toEqual(Array(8).fill(0));
  await page.evaluate(() => window.grid.destroy());
});
