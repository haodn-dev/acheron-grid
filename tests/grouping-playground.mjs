import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

for (const viewport of [
  { width: 1100, height: 800 },
  { width: 390, height: 700 },
]) {
  test(`grouping standalone example filters, discloses and edits local records at ${viewport.width}px`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/grouping/');
    const grid = page.getByRole('treegrid');
    await expect(grid).toBeVisible();
    await expect(page.getByRole('status').filter({ hasText: '100 local records' })).toContainText('4 visible rows');
    await page.getByRole('button', { name: 'Collapse all', exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.groupedExample.grid.rowCount)).toBe(4);
    await page.getByRole('button', { name: 'Expand all', exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.groupedExample.grid.rowCount)).toBe(104);
    await page.getByRole('searchbox', { name: 'Team filter' }).fill('Design');
    await expect.poll(() => page.evaluate(() => window.groupedExample.grid.rowCount)).toBe(26);
    const before = await page.evaluate(() => window.groupedExample.grid.getRowMetadata(0).sums.amount);
    await page.evaluate(() =>
      window.groupedExample.grid.updateCells([{ rowIndex: 1, columnKey: 'amount', value: 99 }]),
    );
    expect(await page.evaluate(() => window.groupedExample.grid.getRowMetadata(0).sums.amount)).toBe(before + 89);
    await page.getByRole('button', { name: 'Undo', exact: true }).click();
    expect(await page.evaluate(() => window.groupedExample.grid.getRowMetadata(0).sums.amount)).toBe(before);
    const accessibility = await new AxeBuilder({ page }).analyze();
    expect(accessibility.violations.filter((item) => ['serious', 'critical'].includes(item.impact))).toEqual([]);
    expect(errors).toEqual([]);
    expect(await page.evaluate(() => window.groupedExample.grid.takeObserverErrors().length)).toBe(0);
  });
}
