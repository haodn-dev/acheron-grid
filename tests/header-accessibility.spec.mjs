import { test, expect } from './browser-fixtures.mjs';
import AxeBuilder from '@axe-core/playwright';

test('virtualized grouped headers omit empty ARIA rows while retaining logical indices and spans', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const { createGrid } = await import('/canvas/index.js');
    const { LocalDataSource } = await import('/core/index.js');
    const container = document.querySelector('#grid');
    container.style.width = '260px';
    window.grid = createGrid({
      container,
      accessibility: 'viewport',
      dataSource: new LocalDataSource([{ id: 1, title: 'Sample', value: 2 }], (row) => row.id),
      columns: [
        { key: 'title', title: 'Title' },
        { key: 'value', title: 'Value' },
      ],
      columnWidth: 400,
      headerGroups: [{ title: 'Outer', children: [{ title: 'Inner', children: ['value'] }] }],
    });
  });
  const grid = page.getByRole('grid');
  const header = page.locator('[id^="acheron-header-"]');
  await expect(grid).toHaveAttribute('aria-rowcount', '4');
  await expect(header.getByRole('row')).toHaveCount(1);
  await expect(header.getByRole('columnheader', { name: 'Title', exact: true })).toHaveAttribute('aria-rowspan', '3');
  for (const scrollLeft of [0, 500, 0]) {
    await grid.evaluate((element, offset) => {
      element.scrollLeft = offset;
    }, scrollLeft);
    await expect.poll(() => header.getByRole('row').count()).toBe(scrollLeft ? 3 : 1);
    expect(
      await header
        .getByRole('row')
        .evaluateAll((rows) => rows.every((row) => row.querySelector('[role="columnheader"]'))),
    ).toBe(true);
    const report = await new AxeBuilder({ page })
      .include('[role="grid"]')
      .withRules(['aria-required-children'])
      .analyze();
    expect(report.violations).toEqual([]);
    if (scrollLeft)
      await expect(header.getByRole('columnheader', { name: 'Value', exact: true }).locator('..')).toHaveAttribute(
        'aria-rowindex',
        '3',
      );
  }
});
