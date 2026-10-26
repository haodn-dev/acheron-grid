import { test, expect } from '@playwright/test';

test('React and Vue inherit tree options and expose the same record-based tree handle', async ({ page }) => {
  await page.goto('/');
  await page.addScriptTag({ type: 'module', url: '/adapters.js' });
  for (const framework of ['react', 'vue']) {
    const host = page.locator('#' + framework);
    await expect(host.getByRole('grid')).toHaveCount(1);
    await page.evaluate(
      (name) =>
        window.adapters[name === 'react' ? 'updateReact' : 'updateVue']({
          options: {
            columns: [
              { key: 'name', title: 'Name' },
              { key: 'parent', title: 'Parent' },
            ],
            dataSource: {
              getRowCount: () => 2,
              getRowId: (index) => (index === 0 ? 0 : ''),
              getValue: (index, key) => (key === 'parent' ? (index === 0 ? null : 0) : index === 0 ? 'Root' : 'Child'),
            },
            accessibility: 'viewport',
            tree: { parentColumnKey: 'parent' },
          },
        }),
      framework,
    );
    await expect(host.getByRole('treegrid')).toHaveCount(1);
    expect(await page.evaluate((name) => window.adapters[name].getTreeRowMetadata(1).rowId, framework)).toBe('');
    await page.evaluate((name) => {
      const grid = window.adapters[name];
      window.adapters[name + 'State'] = grid.exportTreeState();
      grid.setTreeExpanded(0, false);
    }, framework);
    await expect.poll(() => page.evaluate((name) => window.adapters[name].rowCount, framework)).toBe(1);
    await page.evaluate((name) => window.adapters[name].restoreTreeState(window.adapters[name + 'State']), framework);
    await expect.poll(() => page.evaluate((name) => window.adapters[name].rowCount, framework)).toBe(2);
    expect(await page.evaluate((name) => window.adapters[name].takeObserverErrors(), framework)).toEqual([]);
  }
  await page.evaluate(() => {
    window.adapters.unmountReact();
    window.adapters.unmountVue();
  });
  await expect(page.getByRole('treegrid')).toHaveCount(0);
});

test('React and Vue pass grouped construction options and expose the same grouping handle', async ({ page }) => {
  await page.goto('/');
  await page.addScriptTag({ type: 'module', url: '/adapters.js' });
  for (const framework of ['react', 'vue']) {
    const host = page.locator('#' + framework);
    await expect(host.getByRole('grid')).toHaveCount(1);
    await page.evaluate(
      (name) =>
        window.adapters[name === 'react' ? 'updateReact' : 'updateVue']({
          options: {
            columns: [{ key: 'name', title: 'Name' }],
            dataSource: { getRowCount: () => 2, getRowId: (index) => index, getValue: () => 'A' },
            accessibility: 'viewport',
            grouping: { columnKey: 'name' },
          },
        }),
      framework,
    );
    await expect(host.getByRole('treegrid')).toHaveCount(1);
    expect(await page.evaluate((name) => window.adapters[name].getRowMetadata(0).count, framework)).toBe(2);
    await page.evaluate((name) => window.adapters[name].setDataGroupExpanded('A', false), framework);
    await expect.poll(() => page.evaluate((name) => window.adapters[name].rowCount, framework)).toBe(1);
    expect(await page.evaluate((name) => window.adapters[name].takeObserverErrors().length, framework)).toBe(0);
  }
  await page.evaluate(() => {
    window.adapters.unmountReact();
    window.adapters.unmountVue();
  });
  await expect(page.getByRole('treegrid')).toHaveCount(0);
});

test('adapter initialization failures destroy the created grid before reporting errors', async ({ page }) => {
  await page.goto('/');
  await page.addScriptTag({ type: 'module', url: '/adapters.js' });
  await expect(page.locator('#react').getByRole('grid')).toHaveCount(1);
  await page.evaluate(() => window.adapters.mountFailingReact());
  await expect(page.getByText('Ready failure handled')).toBeVisible();
  expect(
    await page.evaluate(() => {
      try {
        window.adapters.failedReact.updateCells([{ rowIndex: 0, columnKey: 'name', value: 'bad' }]);
        return false;
      } catch (error) {
        return /destroyed/.test(error.message);
      }
    }),
  ).toBe(true);
  await page.evaluate(() => window.adapters.mountFailingVue());
  await expect.poll(() => page.evaluate(() => window.adapters.vueMountError)).toContain('Invalid frozen');
  expect(await page.getByRole('grid').count()).toBe(2);
  await page.evaluate(() => {
    window.adapters.unmountFailingReact();
    window.adapters.unmountFailingVue();
    window.adapters.unmountReact();
    window.adapters.unmountVue();
  });
  await expect(page.getByRole('grid')).toHaveCount(0);
});

test('framework adapters preserve live state, forward current events and clean up mounts', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await page.addScriptTag({ type: 'module', url: '/adapters.js' });
  for (const framework of ['react', 'vue']) {
    const host = page.locator('#' + framework);
    await expect(host.getByRole('grid')).toHaveCount(1);
    expect(await page.evaluate((name) => !!window.adapters[name], framework)).toBe(true);
    expect(await page.evaluate((name) => window.adapters[name].exportConfiguration().version, framework)).toBe(1);
    await page.evaluate((name) => {
      const api = window.adapters;
      api[name].updateCells([{ rowIndex: 0, columnKey: 'name', value: 'Edited' }]);
      api[name + 'Before'] = api[name];
      api[name === 'react' ? 'updateReact' : 'updateVue']({
        theme: { background: '#ffeecc' },
        frozenRows: 1,
        onEvent: (event) => api.events.push([name + '-new', event.type]),
      });
    }, framework);
    await expect.poll(() => page.evaluate((name) => window.adapters[name].frozenRows, framework)).toBe(1);
    expect(await page.evaluate((name) => window.adapters[name] === window.adapters[name + 'Before'], framework)).toBe(
      true,
    );
    await expect(host.getByRole('gridcell', { name: 'Name: Edited' })).toBeAttached();
    await page.evaluate((name) => window.adapters[name].undo(), framework);
    await page.evaluate((name) => window.adapters[name].undo(), framework);
    await expect(host.getByRole('gridcell', { name: 'Name: Alpha' })).toBeAttached();
    expect(
      await page.evaluate(
        (name) => window.adapters.events.some(([who, type]) => who === name + '-new' && type === 'cell:change'),
        framework,
      ),
    ).toBe(true);
    await page.evaluate(
      (name) =>
        window.adapters[name === 'react' ? 'updateReact' : 'updateVue']({
          view: { filters: [{ columnKey: 'name', operator: 'equals', query: 'Beta' }] },
        }),
      framework,
    );
    await expect.poll(() => page.evaluate((name) => window.adapters[name].rowCount, framework)).toBe(1);
    await page.evaluate((name) => {
      const api = window.adapters;
      api[name === 'react' ? 'updateReact' : 'updateVue']({
        options: {
          columns: [{ key: 'name', title: 'Renamed' }],
          dataSource: { getRowCount: () => 1, getRowId: () => 7, getValue: () => 'Replacement' },
          accessibility: 'viewport',
        },
        view: {},
      });
    }, framework);
    await expect(host.getByRole('gridcell', { name: 'Renamed: Replacement' })).toBeAttached();
    expect(await page.evaluate((name) => window.adapters[name] !== window.adapters[name + 'Before'], framework)).toBe(
      true,
    );
    await expect(host.getByRole('grid')).toHaveCount(1);
    await page.evaluate((name) => window.adapters[name === 'react' ? 'unmountReact' : 'unmountVue'](), framework);
    await expect(host.getByRole('grid')).toHaveCount(0);
    expect(await page.evaluate((name) => window.adapters[name], framework)).toBe(null);
  }
  expect(
    await page.evaluate(() => window.adapters.ready.filter(([name, mounted]) => name === 'react' && !mounted).length),
  ).toBeGreaterThanOrEqual(2);
  expect(errors).toEqual([]);
});
