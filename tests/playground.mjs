import { test, expect } from '@playwright/test';

test('vanilla app edits, replays and remounts without Laravel or duplicated grid roots', async ({ page, request }) => {
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.goto('/'); await expect(page.getByRole('heading', { name: 'Explore the grid.' })).toBeVisible();
  const viewport = page.getByLabel(/^Data grid viewport/);
  await viewport.click({ position: { x: 180, y: 16 } }); await viewport.press('F2');
  const input = page.getByRole('textbox'); await input.fill('Edited sample'); await input.press('Enter');
  await expect(page.locator('#activity')).toContainText('edit: 1');
  await page.getByRole('button', { name: 'Undo', exact: true }).click(); await expect(page.locator('#activity')).toContainText('undo: 1');
  await page.getByRole('button', { name: 'Redo', exact: true }).click(); await expect(page.locator('#activity')).toContainText('redo: 1');
  await page.getByRole('combobox', { name: 'Appearance', exact: true }).selectOption('light');
  await expect(page.locator('#grid canvas')).toHaveCount(1); await expect(page.locator('#range-count')).toHaveText('0 ranges selected');
  await viewport.click({ position: { x: 180, y: 16 } }); await viewport.press('F2'); await expect(input).toHaveValue('Edited sample'); await input.press('Escape');
  await page.getByLabel('Freeze first row and ID column').uncheck(); await expect(viewport).toHaveCount(1);
  await viewport.click({ position: { x: 340, y: 16 } }); await viewport.press('F2');
  const select = page.getByRole('combobox', { name: 'Edit row 1, Status' }); await select.selectOption('Active'); await select.press('Enter');
  await viewport.click({ position: { x: 494, y: 16 } }); await viewport.press('F2');
  const checkbox = page.getByRole('checkbox', { name: 'Edit row 1, Approved' }); await expect(checkbox).not.toBeChecked(); await checkbox.press('Escape');
  await viewport.press('Shift+F8'); await viewport.press('Control+End'); await expect(page.locator('#range-count')).toHaveText('2 ranges selected');
  await page.getByRole('button', { name: 'Reset view' }).click(); await expect(page.locator('#grid canvas')).toHaveCount(1);
  await page.getByRole('button', { name: 'Undo', exact: true }).click(); await expect(page.locator('#activity')).toHaveText('Nothing to undo.');
  expect((await request.get('/core/../package.json')).status()).toBe(404);
  expect((await request.get('/core/%2e%2e%2fpackage.json')).status()).toBe(404);
  expect((await request.get('/missing')).status()).toBe(404);
  expect((await request.post('/')).status()).toBe(405);
  expect(errors).toEqual([]);
});
