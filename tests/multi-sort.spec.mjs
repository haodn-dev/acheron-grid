import { test, expect } from '@playwright/test';

test('multi-sort headers describe both keys and a single-column view replaces the criteria', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const { createGrid } = await import('/canvas/index.js');
    const { LocalDataSource } = await import('/core/index.js');
    window.grid = createGrid({ container: document.querySelector('#grid'), accessibility: 'viewport',
      dataSource: new LocalDataSource([{ id: 0, team: 'B', score: 1 }, { id: 1, team: 'A', score: 2 }], row => row.id),
      columns: [{ key: 'team', title: 'Team' }, { key: 'score', title: 'Score' }],
      view: { sorts: [{ columnKey: 'team', direction: 'asc' }, { columnKey: 'score', direction: 'desc' }] } });
  });
  const team = page.getByRole('columnheader', { name: 'Team', exact: true });
  const score = page.getByRole('columnheader', { name: 'Score', exact: true });
  await expect(team).toHaveAttribute('aria-sort', 'other');
  await expect(team).toHaveAttribute('aria-description', /Sorted ascending/);
  await expect(score).toHaveAttribute('aria-sort', 'none');
  await expect(score).toHaveAttribute('aria-description', /Sorted descending/);
  await page.evaluate(() => window.grid.setView({ sort: { columnKey: 'score', direction: 'asc' } }));
  await expect(score).toHaveAttribute('aria-sort', 'ascending');
  await expect(team).toHaveAttribute('aria-sort', 'none');
  await page.evaluate(() => window.grid.destroy());
  await expect(page.locator('canvas')).toHaveCount(0);
});
