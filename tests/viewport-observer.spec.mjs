import { test, expect } from '@playwright/test';

test('a browser collapsing an oversized row spacer retains a usable bounded scroll prefix', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const { createGrid } = await import('/canvas/index.js');
    const descriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight');
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
      configurable: true,
      get() {
        return Number.parseFloat(this.style.height) === 32000000 ? 0 : descriptor.get.call(this);
      },
    });
    window.restoreNativeOffsetHeight = () => Object.defineProperty(HTMLElement.prototype, 'offsetHeight', descriptor);
    window.grid = createGrid({
      container: document.querySelector('#grid'),
      rowHeight: 32,
      dataSource: { getRowCount: () => 1000000, getRowId: (row) => row, getValue: (row) => row },
      columns: [{ key: 'value', title: 'Value' }],
    });
  });
  const height = await page.locator('[data-grid-viewport]').evaluate((node) => {
    node.scrollTop = 32000;
    node.dispatchEvent(new Event('scroll'));
    return node.firstElementChild.offsetHeight;
  });
  expect(height).toBe(16000000);
  expect(await page.evaluate(() => window.grid.getViewport().regions.some((region) => region.rows.start >= 1000))).toBe(
    true,
  );
  await page.evaluate(() => {
    window.grid.destroy();
    window.restoreNativeOffsetHeight();
  });
});

async function mount(page, extra = {}) {
  await page.goto('/');
  await page.evaluate(async (extra) => {
    const { createGrid } = await import('/canvas/index.js');
    window.notices = [];
    window.reads = 0;
    window.grid = createGrid({
      container: document.querySelector('#grid'),
      dataSource: {
        getRowCount: () => 1000000,
        getRowId: (row) => row,
        getValue: (row) => {
          window.reads++;
          return row;
        },
      },
      columns: Array.from({ length: 12 }, (_, i) => ({ key: String(i), title: String(i), width: 120 })),
      ...extra,
      onViewportChange: (snapshot) => {
        window.notices.push(snapshot);
        // Repainting from a subscriber must not create a notification loop.
        window.grid.render();
      },
    });
    window.initial = window.grid.getViewport();
  }, extra);
  await expect.poll(() => page.evaluate(() => window.notices.length)).toBe(1);
}

test('viewport snapshots share frozen geometry, coalesce paints and stay bounded for a million rows', async ({
  page,
}) => {
  await mount(page, { frozenRows: 2, frozenColumns: 1 });
  const initial = await page.evaluate(() => ({
    equal: JSON.stringify(window.initial) === JSON.stringify(window.notices[0]),
    frozen: Object.isFrozen(window.initial) && Object.isFrozen(window.initial.regions[0].rows),
    hasMethods: 'cellRect' in window.initial || 'hitTest' in window.initial,
    regions: window.initial.regions,
  }));
  expect(initial.equal).toBe(true);
  expect(initial.frozen).toBe(true);
  expect(initial.hasMethods).toBe(false);
  expect(initial.regions).toHaveLength(4);
  expect(initial.regions[0].rows).toEqual({ start: 0, end: 2 });
  const result = await page.evaluate(async () => {
    const before = window.reads;
    for (let i = 0; i < 20; i++) window.grid.getViewport();
    const reads = window.reads - before;
    window.grid.render();
    window.grid.render();
    await Promise.resolve();
    return { reads, count: window.notices.length };
  });
  expect(result).toEqual({ reads: 0, count: 1 });
  await page.locator('[data-grid-viewport]').evaluate((node) => {
    node.scrollTop = 32000;
    node.scrollLeft = 360;
    node.dispatchEvent(new Event('scroll'));
  });
  await expect.poll(() => page.evaluate(() => window.notices.length)).toBe(2);
  const scrolled = await page.evaluate(() => window.notices.at(-1));
  expect(scrolled.regions[0].rows).toEqual({ start: 0, end: 2 });
  expect(scrolled.regions.some((region) => region.rows.start >= 1000)).toBe(true);
  expect(scrolled.regions.every((region) => region.rows.end - region.rows.start < 100)).toBe(true);
  await page.evaluate(() => window.grid.setRowHeight(1002, 60));
  await expect.poll(() => page.evaluate(() => window.notices.length)).toBe(3);
  await page.evaluate(() => {
    document.querySelector('#grid').style.height = '260px';
  });
  await expect.poll(() => page.evaluate(() => window.notices.at(-1).height)).toBeLessThan(scrolled.height);
});

test('viewport callback errors are isolated, reported and drainable', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { createGrid } = await import('/canvas/index.js');
    const reported = [];
    const grid = createGrid({
      container: document.querySelector('#grid'),
      dataSource: { getRowCount: () => 0, getRowId: () => 0, getValue: () => undefined },
      columns: [],
      onViewportChange: () => {
        throw new Error('viewport observer');
      },
      onObserverError: (error) => {
        reported.push(error.message);
        throw new Error('reporter');
      },
    });
    await Promise.resolve();
    const snapshot = grid.getViewport();
    const errors = grid.takeObserverErrors().map((error) => error.message);
    const drained = grid.takeObserverErrors();
    grid.destroy();
    return { reported, errors, drained, regions: snapshot.regions };
  });
  expect(result).toEqual({
    reported: ['viewport observer'],
    errors: ['viewport observer', 'reporter'],
    drained: [],
    regions: [],
  });
});

test('destroy cancels queued viewport notices and rejects geometry reads', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { createGrid } = await import('/canvas/index.js');
    let calls = 0;
    const grid = createGrid({
      container: document.querySelector('#grid'),
      dataSource: { getRowCount: () => 1, getRowId: () => 0, getValue: () => '' },
      columns: [{ key: 'value', title: 'Value' }],
      onViewportChange: () => calls++,
    });
    grid.destroy();
    await Promise.resolve();
    let error;
    try {
      grid.getViewport();
    } catch (caught) {
      error = caught.message;
    }
    return { calls, error };
  });
  expect(result).toEqual({ calls: 0, error: 'Grid is destroyed.' });
});

test('remote hosts can disable local Find without reading data or intercepting the browser shortcut', async ({
  page,
}) => {
  await mount(page, { allowSearch: false });
  const result = await page.evaluate(() => {
    const reads = window.reads;
    window.grid.openSearch();
    const event = new KeyboardEvent('keydown', { key: 'f', ctrlKey: true, bubbles: true, cancelable: true });
    document.querySelector('[data-grid-viewport]').dispatchEvent(event);
    return { reads: window.reads - reads, prevented: event.defaultPrevented };
  });
  expect(result).toEqual({ reads: 0, prevented: false });
  await expect(page.getByRole('grid')).not.toHaveAttribute('aria-keyshortcuts', /Control\+f|Meta\+f/);
  await expect(page.locator('[data-grid-search]')).toBeHidden();
});
