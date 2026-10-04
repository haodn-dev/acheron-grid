import { test, expect } from '@playwright/test';

test('framework adapters preserve live state, forward current events and clean up mounts', async ({ page }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/'); await page.addScriptTag({ type: 'module', url: '/adapters.js' });
  for (const framework of ['react', 'vue']) {
    const host = page.locator('#' + framework);
    await expect(host.getByRole('grid')).toHaveCount(1);
    expect(await page.evaluate(name => !!window.adapters[name], framework)).toBe(true);
    expect(await page.evaluate(name => window.adapters[name].exportConfiguration().version, framework)).toBe(1);
    await page.evaluate(name => {
      const api = window.adapters; api[name].updateCells([{ rowIndex: 0, columnKey: 'name', value: 'Edited' }]);
      api[name + 'Before'] = api[name];
      api[name === 'react' ? 'updateReact' : 'updateVue']({ theme: { background: '#ffeecc' }, frozenRows: 1, onEvent: event => api.events.push([name + '-new', event.type]) });
    }, framework);
    await expect.poll(() => page.evaluate(name => window.adapters[name].frozenRows, framework)).toBe(1);
    expect(await page.evaluate(name => window.adapters[name] === window.adapters[name + 'Before'], framework)).toBe(true);
    await expect(host.getByRole('gridcell', { name: 'Name: Edited' })).toBeAttached();
    await page.evaluate(name => window.adapters[name].undo(), framework);
    await page.evaluate(name => window.adapters[name].undo(), framework);
    await expect(host.getByRole('gridcell', { name: 'Name: Alpha' })).toBeAttached();
    expect(await page.evaluate(name => window.adapters.events.some(([who, type]) => who === name + '-new' && type === 'cell:change'), framework)).toBe(true);
    await page.evaluate(name => window.adapters[name === 'react' ? 'updateReact' : 'updateVue']({ view: { filters: [{ columnKey: 'name', operator: 'equals', query: 'Beta' }] } }), framework);
    await expect.poll(() => page.evaluate(name => window.adapters[name].rowCount, framework)).toBe(1);
    await page.evaluate(name => {
      const api = window.adapters;
      api[name === 'react' ? 'updateReact' : 'updateVue']({ options: { columns: [{ key: 'name', title: 'Renamed' }], dataSource: { getRowCount: () => 1, getRowId: () => 7, getValue: () => 'Replacement' }, accessibility: 'viewport' }, view: {} });
    }, framework);
    await expect(host.getByRole('gridcell', { name: 'Renamed: Replacement' })).toBeAttached();
    expect(await page.evaluate(name => window.adapters[name] !== window.adapters[name + 'Before'], framework)).toBe(true);
    await expect(host.getByRole('grid')).toHaveCount(1);
    await page.evaluate(name => window.adapters[name === 'react' ? 'unmountReact' : 'unmountVue'](), framework);
    await expect(host.getByRole('grid')).toHaveCount(0);
    expect(await page.evaluate(name => window.adapters[name], framework)).toBe(null);
  }
  expect(await page.evaluate(() => window.adapters.ready.filter(([name, mounted]) => name === 'react' && !mounted).length)).toBeGreaterThanOrEqual(2);
  expect(errors).toEqual([]);
});
