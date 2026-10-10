import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

async function expectFirstCell(page, text) {
  await page.getByRole('grid').click({ position: { x: 100, y: 16 } });
  await expect(page.getByRole('gridcell')).toContainText(text);
}

test('paged HTTP writes survive eviction, retry exactly and query the server globally', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  const responses = [];
  page.on('response', (response) => {
    if (response.url().includes('/paged/api/')) responses.push(response);
  });
  await page.goto('/paged/');
  await expect(page.locator('#status')).toContainText('10000 records');
  await page.getByRole('button', { name: 'Stage first row' }).click();
  for (let i = 0; i < 3; i++) await page.getByRole('button', { name: 'Next page' }).click();
  await expect(page.locator('#status')).toContainText('page 4');
  for (let i = 0; i < 3; i++) await page.getByRole('button', { name: 'Previous page' }).click();
  await expectFirstCell(page, 'Updated task');
  await page.getByLabel('Server response').selectOption('drop');
  const save = page.getByRole('button', { name: 'Save / retry' });
  await save.click();
  await expect(page.locator('#status')).toContainText('disconnected');
  await save.click();
  await expect(page.locator('#status')).toContainText('0 pending cells');
  await expectFirstCell(page, 'Updated task');
  const writes = responses.filter((response) => response.url().endsWith('/write'));
  expect(writes).toHaveLength(2);
  expect(writes[0].request().postDataJSON()).toEqual(writes[1].request().postDataJSON());
  const receipt = await writes[1].json();
  expect(receipt.delta.cells).toHaveLength(1);
  expect(JSON.stringify(receipt).length).toBeLessThan(500);
  await page.getByLabel('Server response').selectOption('normal');
  await page.getByLabel('Order').selectOption('desc');
  await page.getByLabel('Search tasks').fill('Task 9');
  await page.getByRole('button', { name: 'Apply server query' }).click();
  await expectFirstCell(page, 'Task 9999');
  await page.getByLabel('Search tasks').fill('Task 9999');
  await page.getByRole('button', { name: 'Apply server query' }).click();
  await expect(page.locator('#status')).toContainText('1 records');
  expect(errors).toEqual([]);
});

test('paged example rejection/conflict review and accessibility preserve the draft', async ({ page }) => {
  await page.goto('/paged/');
  await expect(page.locator('#status')).toContainText('ready');
  await page.getByLabel('Server response').selectOption('reject');
  await page.getByRole('grid').click({ position: { x: 100, y: 16 } });
  await page.getByRole('grid').press('F2');
  await page.getByRole('textbox').fill('Conflict draft');
  await page.getByRole('textbox').press('Enter');
  await page.getByRole('button', { name: 'Save / retry' }).click();
  await expect(page.locator('#status')).toContainText('Server rejected');
  await expectFirstCell(page, 'Conflict draft');
  await page.getByLabel('Server response').selectOption('normal');
  await page.getByRole('button', { name: 'Simulate external edit' }).click();
  await page.getByRole('button', { name: 'Save / retry' }).click();
  await expect(page.getByRole('heading', { name: 'Review conflict' })).toBeVisible();
  await expect(page.locator('#review')).toContainText('Server edit');
  await page.getByRole('button', { name: 'Accept server and discard draft' }).click();
  await expectFirstCell(page, 'Server edit');
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 844 });
    const results = await new AxeBuilder({ page }).analyze();
    expect(results.violations.filter((issue) => ['serious', 'critical'].includes(issue.impact))).toEqual([]);
  }
});
