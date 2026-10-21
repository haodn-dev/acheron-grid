import { test, expect } from '@playwright/test';

for (const accessibility of ['active-cell', 'viewport']) {
  test(`validation is announced and refreshed in ${accessibility} accessibility`, async ({ page }) => {
    await page.goto('/');
    await page.evaluate(async (accessibility) => {
      const { createGrid } = await import('/canvas/index.js');
      const { LocalDataSource } = await import('/core/index.js');
      window.source = new LocalDataSource([{ id: 1, value: 'bad' }], (row) => row.id);
      window.grid = createGrid({
        container: document.querySelector('#grid'),
        dataSource: window.source,
        ...(accessibility === 'viewport' ? { accessibility } : {}),
        columns: [
          {
            key: 'value',
            title: 'Value',
            editable: true,
            invalidInput: 'allow',
            validate: (value) => (value === 'bad' ? 'Use a valid value.' : undefined),
          },
        ],
      });
    }, accessibility);
    const viewport = page.getByRole('grid');
    await viewport.press('Control+Home');
    const cell = viewport.getByRole('gridcell', { name: 'Value: bad', exact: true });
    await expect(cell).toHaveAttribute('aria-invalid', 'true');
    await expect(cell).toHaveAttribute('aria-description', /Use a valid value\./);
    await viewport.press('F2');
    const editor = page.getByRole('textbox');
    await editor.fill('good');
    await editor.press('Enter');
    await expect(viewport.getByRole('gridcell', { name: 'Value: good', exact: true })).toHaveAttribute(
      'aria-invalid',
      'false',
    );
    await expect(viewport.getByRole('gridcell', { name: 'Value: good', exact: true })).not.toHaveAttribute(
      'aria-description',
      /Use a valid value\./,
    );
    await viewport.press('Control+z');
    await expect(cell).toHaveAttribute('aria-invalid', 'true');
    await expect(cell).toHaveAttribute('aria-description', /Use a valid value\./);
    await viewport.press('Escape');
    await expect(viewport).not.toHaveAttribute('aria-activedescendant');
    await page.evaluate(() => window.grid.destroy());
    await expect(page.getByRole('grid')).toHaveCount(0);
  });
}
