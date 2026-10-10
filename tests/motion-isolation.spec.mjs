import { test, expect } from './browser-fixtures.mjs';
for (const axis of ['column', 'row'])
  test(
    axis + ' motion preserves frozen pixels throughout hide, show, resize and history',
    async ({ page }, testInfo) => {
      await page.goto('/');
      await page.emulateMedia({ reducedMotion: 'no-preference' });
      await page.evaluate(async (axis) => {
        const { createGrid } = await import('/canvas/index.js'),
          { LocalDataSource } = await import('/core/index.js');
        window.grid = createGrid({
          container: document.querySelector('#grid'),
          indexColumn: false,
          columnWidth: 100,
          rowHeight: 40,
          headerHeight: 30,
          frozenColumns: axis === 'column' ? 1 : 0,
          frozenRows: axis === 'row' ? 1 : 0,
          motion: { duration: 1000, easing: 'linear' },
          columns: Array.from({ length: 12 }, (_, i) => ({ key: 'c' + i, title: 'Column ' + i })),
          dataSource: new LocalDataSource(
            Array.from({ length: 50 }, (_, id) => ({ id })),
            (r) => r.id,
          ),
          renderCell: (ctx, cell) => {
            ctx.fillStyle = (axis === 'column' ? cell.columnKey === 'c0' : cell.rowIndex === 0) ? '#00cc66' : '#ee3344';
            ctx.fillRect(cell.x + 1, cell.y + 1, cell.width - 2, cell.height - 2);
            return true;
          },
        });
        const viewport = document.querySelector('[role=grid]');
        viewport[axis === 'column' ? 'scrollLeft' : 'scrollTop'] = 250;
        viewport.dispatchEvent(new Event('scroll'));
      }, axis);
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const box = await page.getByRole('grid').boundingBox(),
        clip =
          axis === 'column'
            ? { x: box.x + 2, y: box.y + 5, width: 95, height: 150 }
            : { x: box.x + 5, y: box.y + 2, width: 200, height: 35 };
      const before = await page.screenshot({ clip, path: testInfo.outputPath('before.png') });
      await testInfo.attach('frozen-before', { body: before, contentType: 'image/png' });
      for (const action of ['hide', 'show', 'resize', 'undo', 'redo']) {
        await page.evaluate(
          ({ axis, action }) => {
            window.grid.setMotion({ duration: 1000, easing: 'linear' });
            if (action === 'hide' || action === 'show')
              axis === 'column'
                ? window.grid.setColumnsHidden([3], action === 'hide')
                : window.grid.setRowsHidden([7], action === 'hide');
            else if (action === 'resize')
              axis === 'column' ? window.grid.setColumnWidth(3, 65) : window.grid.setRowHeight(7, 20);
            else window.grid[action]();
            for (const animation of document.getAnimations()) {
              animation.pause();
              animation.currentTime = 0;
            }
          },
          { axis, action },
        );
        await expect(page.locator('[data-grid-motion]')).not.toHaveCount(0);
        for (const phase of [0.25, 0.5, 0.75, 0.9]) {
          await page.evaluate((phase) => {
            for (const animation of document.getAnimations()) animation.currentTime = 1000 * phase;
          }, phase);
          const during = await page.screenshot({ clip, path: testInfo.outputPath(action + '-' + phase + '.png') });
          await testInfo.attach(action + '-' + phase, { body: during, contentType: 'image/png' });
          expect(during.equals(before), action + ' at ' + phase + ' must preserve the frozen ' + axis).toBe(true);
          const movingClip =
            axis === 'column'
              ? { x: box.x + 102, y: box.y + 5, width: 200, height: 150 }
              : { x: box.x + 5, y: box.y + 42, width: 200, height: 150 };
          const moving = await page.screenshot({ clip: movingClip });
          const leaked = await page.evaluate(async (base64) => {
            const img = new Image();
            img.src = 'data:image/png;base64,' + base64;
            await img.decode();
            const canvas = document.createElement('canvas');
            canvas.width = img.width;
            canvas.height = img.height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0);
            const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
            for (let i = 0; i < pixels.length; i += 4)
              if (pixels[i] < 50 && pixels[i + 1] > 150 && pixels[i + 2] < 150) return true;
            return false;
          }, moving.toString('base64'));
          await testInfo.attach(action + '-' + phase + '-scroll', { body: moving, contentType: 'image/png' });
          expect(leaked, action + ' at ' + phase + ' must not copy frozen content into scrolling cells').toBe(false);
        }
        await page.evaluate(() => window.grid.setMotion(false));
        expect((await page.screenshot({ clip })).equals(before), action + ' settled').toBe(true);
      }
      await page.evaluate(() => window.grid.destroy());
      await expect(page.locator('[data-grid-motion]')).toHaveCount(0);
    },
  );

for (const axis of ['column', 'row'])
  test('drag ' + axis + ' ghost keeps one axis strip after merging cells', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(async (axis) => {
      const { createGrid } = await import('/canvas/index.js'),
        { LocalDataSource } = await import('/core/index.js');
      window.grid = createGrid({
        container: document.querySelector('#grid'),
        columnWidth: 100,
        rowHeight: 40,
        columns: Array.from({ length: 5 }, (_, i) => ({ key: 'c' + i, title: 'Column ' + i })),
        dataSource: new LocalDataSource(
          Array.from({ length: 30 }, (_, id) => ({ id })),
          (r) => r.id,
        ),
        onReorder: () => {},
      });
      window.grid.mergeCells({
        startRow: 0,
        endRow: axis === 'row' ? 1 : 0,
        startColumn: 0,
        endColumn: axis === 'column' ? 1 : 0,
      });
      axis === 'column' ? window.grid.selectColumn(0) : window.grid.selectRow(0);
    }, axis);
    const handle =
      axis === 'column'
        ? page.locator('[data-grid-header-cell="0"]')
        : page.getByRole('button', { name: 'Select row 1', exact: true });
    await expect(handle).toBeVisible();
    const box = await handle.boundingBox();
    await page.mouse.move(box.x + 10, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(
      box.x + 10 + (axis === 'column' ? 30 : 0),
      box.y + box.height / 2 + (axis === 'row' ? 30 : 0),
      { steps: 4 },
    );
    const ghost = page.locator('[data-grid-drag-ghost="' + axis + '"]');
    await expect(ghost).toBeVisible();
    const actual = await ghost.boundingBox();
    expect(axis === 'column' ? actual.width : actual.height).toBe(axis === 'column' ? box.width : box.height);
    await page.keyboard.press('Escape');
    await page.mouse.up();
    await expect(ghost).toHaveCount(0);
  });

for (const axis of ['column', 'row'])
  test('drag ' + axis + ' insertion follows its header even above merged cells', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(async (axis) => {
      const { createGrid } = await import('/canvas/index.js'),
        { LocalDataSource } = await import('/core/index.js');
      window.requests = [];
      window.grid = createGrid({
        container: document.querySelector('#grid'),
        columnWidth: 100,
        rowHeight: 40,
        columns: Array.from({ length: 5 }, (_, i) => ({ key: 'c' + i, title: 'Column ' + i })),
        dataSource: new LocalDataSource(
          Array.from({ length: 30 }, (_, id) => ({ id })),
          (r) => r.id,
        ),
        onReorder: (request) => window.requests.push(request),
      });
      window.grid.mergeCells({
        startRow: 0,
        endRow: axis === 'row' ? 1 : 0,
        startColumn: 0,
        endColumn: axis === 'column' ? 1 : 0,
      });
      axis === 'column' ? window.grid.selectColumn(2) : window.grid.selectRow(2);
    }, axis);
    const handle = (index) =>
      axis === 'column'
        ? page.locator('[data-grid-header-cell="' + index + '"]')
        : page.getByRole('button', { name: 'Select row ' + (index + 1), exact: true });
    await expect(handle(2)).toBeVisible();
    const from = await handle(2).boundingBox(),
      to = await handle(1).boundingBox();
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(to.x + to.width * 0.75, to.y + to.height * 0.75, { steps: 8 });
    await page.mouse.up();
    expect(
      await page.evaluate(() =>
        window.requests.map((r) => ({ axis: r.axis, indices: r.indices, beforeIndex: r.beforeIndex })),
      ),
    ).toEqual([{ axis, indices: [2], beforeIndex: 2 }]);
  });

for (const axis of ['column', 'row'])
  test('drag ' + axis + ' ghost excludes pixels hidden behind its frozen pane', async ({ page }) => {
    await page.goto('/');
    await page.evaluate(async (axis) => {
      const { createGrid } = await import('/canvas/index.js'),
        { LocalDataSource } = await import('/core/index.js');
      window.grid = createGrid({
        container: document.querySelector('#grid'),
        columnWidth: 100,
        rowHeight: 40,
        frozenColumns: axis === 'column' ? 1 : 0,
        frozenRows: axis === 'row' ? 1 : 0,
        columns: Array.from({ length: 12 }, (_, i) => ({ key: 'c' + i, title: 'Column ' + i })),
        dataSource: new LocalDataSource(
          Array.from({ length: 50 }, (_, id) => ({ id })),
          (r) => r.id,
        ),
        onReorder: () => {},
        renderCell: (ctx, cell) => {
          ctx.fillStyle = (axis === 'column' ? cell.columnKey === 'c0' : cell.rowIndex === 0) ? '#00cc66' : '#ee3344';
          ctx.fillRect(cell.x + 1, cell.y + 1, cell.width - 2, cell.height - 2);
          return true;
        },
      });
      axis === 'column' ? window.grid.selectColumn(3) : window.grid.selectRow(7);
      const viewport = document.querySelector('[role=grid]');
      viewport[axis === 'column' ? 'scrollLeft' : 'scrollTop'] = 250;
      viewport.dispatchEvent(new Event('scroll'));
    }, axis);
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const handle =
      axis === 'column'
        ? page.locator('[data-grid-header-cell="3"]')
        : page.getByRole('button', { name: 'Select row 8', exact: true });
    await expect(handle).toBeVisible();
    const box = await handle.boundingBox();
    const x = axis === 'column' ? box.x + box.width - 20 : box.x + 10,
      y = axis === 'row' ? box.y + box.height - 15 : box.y + box.height / 2;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + (axis === 'column' ? 30 : 0), y + (axis === 'row' ? 30 : 0), { steps: 4 });
    const ghost = page.locator('[data-grid-drag-ghost="' + axis + '"]');
    await expect(ghost).toBeVisible();
    const leaked = await ghost.evaluate((canvas) => {
      const p = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;
      for (let i = 0; i < p.length; i += 4) if (p[i] < 50 && p[i + 1] > 150 && p[i + 2] < 150) return true;
      return false;
    });
    expect(leaked).toBe(false);
    await page.keyboard.press('Escape');
    await page.mouse.up();
  });
