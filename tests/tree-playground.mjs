import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

for (const viewport of [
  { width: 1100, height: 800 },
  { width: 390, height: 700 },
]) {
  test(`tree standalone example preserves ancestors, estimates and accessible layout at ${viewport.width}px`, async ({
    page,
  }, info) => {
    await page.setViewportSize(viewport);
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/tree/');
    await expect(page.getByRole('treegrid')).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: '20 local records' })).toContainText('8 visible records');
    await page.screenshot({ path: info.outputPath('tree-preview.png'), fullPage: true });
    await page.getByRole('button', { name: 'Collapse roots', exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.treeExample.grid.rowCount)).toBe(4);
    await page.evaluate(() => window.treeExample.grid.selectAll());
    expect(await page.evaluate(() => window.treeExample.grid.copySelection().split(/\r?\n/).length)).toBe(4);
    await page.getByRole('button', { name: 'Expand all', exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.treeExample.grid.rowCount)).toBe(20);
    await page.getByRole('searchbox', { name: 'Task filter' }).fill('Review');
    await expect.poll(() => page.evaluate(() => window.treeExample.grid.rowCount)).toBe(12);
    expect(await page.evaluate(() => window.treeExample.grid.getTreeRowMetadata(2).level)).toBe(3);
    await page.evaluate(() => window.treeExample.grid.updateCells([{ rowIndex: 2, columnKey: 'estimate', value: 9 }]));
    expect(await page.evaluate(() => window.treeExample.source.getValue(4, 'estimate'))).toBe(9);
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    expect(await page.evaluate(() => window.treeExample.source.getValue(4, 'estimate'))).toBe(3);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const accessibility = await new AxeBuilder({ page }).analyze();
    expect(accessibility.violations.filter((item) => ['serious', 'critical'].includes(item.impact))).toEqual([]);
    expect(await page.evaluate(() => window.treeExample.grid.takeObserverErrors())).toEqual([]);
    expect(errors).toEqual([]);
  });
}
