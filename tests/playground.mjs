import { test, expect } from '@playwright/test';

test('standalone playground serves a working module worker', async ({ page }) => {
  await page.goto('/');
  expect(
    await page.evaluate(async () => {
      const { createTsvWorker } = await import('/core/worker.js');
      const decoder = createTsvWorker(() => new Worker('/core/worker-entry.js', { type: 'module' }));
      try {
        return await decoder.decodeTsv('standalone\tworker');
      } finally {
        decoder.destroy();
      }
    }),
  ).toEqual([['standalone', 'worker']]);
});

test('vanilla app edits, replays and remounts without Laravel or duplicated grid roots', async ({ page, request }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Explore the grid.' })).toBeVisible();
  const viewport = page.getByLabel(/^Data grid viewport/);
  await viewport.click({ position: { x: 180, y: 16 } });
  await viewport.press('F2');
  const input = page.getByRole('textbox');
  await input.fill('Edited sample');
  await input.press('Enter');
  await expect(page.locator('#activity')).toContainText('edit: 1');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.locator('#activity')).toContainText('undo: 1');
  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await expect(page.locator('#activity')).toContainText('redo: 1');
  await page.getByRole('combobox', { name: 'Appearance', exact: true }).selectOption('light');
  await expect(page.locator('#grid canvas')).toHaveCount(1);
  await expect(page.locator('#range-count')).toHaveText('1 ranges selected');
  await viewport.click({ position: { x: 180, y: 16 } });
  await viewport.press('F2');
  await expect(input).toHaveValue('Edited sample');
  await input.press('Escape');
  await page.getByLabel('Freeze first row and ID column').uncheck();
  await expect(viewport).toHaveCount(1);
  await viewport.click({ position: { x: 340, y: 16 } });
  await viewport.press('F2');
  const select = page.getByRole('combobox', { name: 'Edit row 1, Status' });
  await select.selectOption('Active');
  await select.press('Enter');
  await viewport.click({ position: { x: 494, y: 16 } });
  await viewport.press('F2');
  const checkbox = page.getByRole('checkbox', { name: 'Edit row 1, Approved' });
  await expect(checkbox).not.toBeChecked();
  await checkbox.press('Escape');
  await viewport.press('Shift+F8');
  await viewport.press('Control+End');
  await expect(page.locator('#range-count')).toHaveText('2 ranges selected');
  await page.getByRole('button', { name: 'Reset view' }).click();
  await expect(page.locator('#grid canvas')).toHaveCount(1);
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await expect(page.locator('#activity')).toHaveText('Nothing to undo.');
  expect((await request.get('/core/../package.json')).status()).toBe(404);
  expect((await request.get('/core/%2e%2e%2fpackage.json')).status()).toBe(404);
  expect((await request.get('/missing')).status()).toBe(404);
  expect((await request.post('/')).status()).toBe(405);
  expect(errors).toEqual([]);
});

test('column menus apply local sort and combined filters, map edits, and recover an empty view', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await page.addStyleTag({
    content:
      'dialog { margin:0; padding:0; border:0 } button,input,select { border:0; padding:0; background:transparent }',
  });
  const viewport = page.getByRole('grid');
  const cell = async () => page.locator('#' + (await viewport.getAttribute('aria-activedescendant')));
  const header = async (x = 240) => {
    const bounds = await viewport.boundingBox();
    await page.mouse.click(bounds.x + x, bounds.y - 18, { button: 'right' });
  };
  await header();
  await page.getByRole('menuitem', { name: 'Sort descending…', exact: true }).click();
  await page.getByRole('button', { name: 'Apply view', exact: true }).click();
  await viewport.press('ArrowRight');
  await viewport.press('ArrowRight');
  await expect(await cell()).toHaveText('Name: Record 10000');
  await expect(page.getByRole('button', { name: 'Select row 1', exact: true })).toHaveText('1');
  await viewport.press('F2');
  await page.getByRole('textbox', { name: 'Edit row 1, Name' }).fill('Mapped edit');
  await page.getByRole('textbox', { name: 'Edit row 1, Name' }).press('Enter');
  await header();
  await page.getByRole('menuitem', { name: 'Filter column…', exact: true }).click();
  const filterDialog = page.getByRole('dialog', { name: 'Filter column' });
  const layout = await filterDialog.evaluate((el) => {
    const b = el.getBoundingClientRect();
    const input = el.querySelector('input').getBoundingClientRect();
    const buttons = [...el.querySelectorAll('button')].map((button) => button.getBoundingClientRect());
    return {
      centered: Math.abs(b.x + b.width / 2 - innerWidth / 2) < 2 && Math.abs(b.y + b.height / 2 - innerHeight / 2) < 2,
      contained: input.x >= b.x && input.right <= b.right,
      separated: buttons[1].x >= buttons[0].right + 7,
    };
  });
  expect(layout).toEqual({ centered: true, contained: true, separated: true });
  await page.getByRole('combobox', { name: 'Filter condition' }).selectOption('equals');
  await page.getByRole('searchbox', { name: 'Contains text' }).fill('Mapped edit');
  await page.getByRole('button', { name: 'Apply view', exact: true }).click();
  await expect(viewport).toHaveAttribute('aria-rowcount', '2');
  await expect(page.locator('[data-grid-index] button[aria-label^="Select row "]')).toHaveCount(1);
  await expect(page.locator('[data-grid-index] button[aria-label^="Select row "]')).toHaveText('1');
  await header(400);
  await page.getByRole('menuitem', { name: 'Filter column…', exact: true }).click();
  await page.getByRole('searchbox', { name: 'Contains text' }).fill('no-match');
  await page.getByRole('button', { name: 'Apply view', exact: true }).click();
  await expect(viewport).toHaveAttribute('aria-rowcount', '1');
  await expect(page.locator('[data-grid-index] button[aria-label^="Select row "]')).toHaveCount(0);
  await expect(viewport).toBeFocused();
  await header();
  await page.getByRole('menuitem', { name: 'Clear sort and filters…', exact: true }).click();
  await page.getByRole('button', { name: 'Apply view', exact: true }).click();
  await expect(viewport).toHaveAttribute('aria-rowcount', '10001');
  await viewport.press('Control+End');
  await expect(await cell()).toHaveText('Metric 2: 20000');
  await viewport.press('Home');
  await viewport.press('ArrowRight');
  await expect(await cell()).toHaveText('Name: Mapped edit');
  expect(errors).toEqual([]);
});
