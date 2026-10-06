import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('remote HTTP lifecycle: pending, rejected, conflict review and idempotent uncertain retry', async ({
  page,
  request,
}) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/remote/');
  await expect(page.locator('#status')).toContainText('ready');
  const edit = async (value) => {
    await page.getByLabel('First task title').fill(value);
    await page.getByRole('button', { name: 'Stage edit', exact: true }).click();
    await expect(page.locator('#status')).toContainText('1 pending');
  };
  let release;
  const pending = new Promise((resolve) => {
    release = resolve;
  });
  await page.route('**/remote/api/write', async (route) => {
    await pending;
    await route.continue();
  });
  await edit('Accepted title');
  await page.getByRole('button', { name: 'Save / retry', exact: true }).click();
  await expect(page.locator('#status')).toContainText('committing');
  await expect(page.getByRole('button', { name: 'Stage edit', exact: true })).toBeDisabled();
  release();
  await expect(page.locator('#status')).toContainText('0 pending');
  await page.unroute('**/remote/api/write');
  await page.getByLabel('Next server response').selectOption('reject');
  await edit('Rejected draft');
  await page.getByRole('button', { name: 'Save / retry', exact: true }).click();
  await expect(page.locator('#status')).toContainText('Server rejected');
  await expect(page.locator('#status')).toContainText('1 pending');
  await page.getByLabel('Next server response').selectOption('normal');
  await page.getByRole('button', { name: 'Save / retry', exact: true }).click();
  await expect(page.locator('#status')).toContainText('0 pending');
  await edit('Reviewed local change');
  await page.getByRole('button', { name: 'Simulate another client', exact: true }).click();
  await page.getByRole('button', { name: 'Save / retry', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Review conflict' })).toBeVisible();
  await expect(page.locator('#review')).toContainText('Server edit');
  await expect(page.locator('#review')).toContainText('Reviewed local change');
  await page.getByRole('button', { name: 'Reapply my reviewed changes', exact: true }).click();
  await expect(page.locator('#status')).toContainText('ready');
  await expect(page.locator('#status')).toContainText('1 pending');
  await page.getByLabel('Next server response').selectOption('drop');
  await page.getByRole('button', { name: 'Save / retry', exact: true }).click();
  await expect(page.locator('#status')).toContainText('disconnected');
  const before = await (await request.get('/remote/api/snapshot')).json();
  await page.getByRole('button', { name: 'Save / retry', exact: true }).click();
  await expect(page.locator('#status')).toContainText('0 pending');
  const after = await (await request.get('/remote/api/snapshot')).json();
  expect(after).toEqual(before);
  expect(after.rows[0].values.title).toBe('Reviewed local change');
  expect(errors).toEqual([]);
});

test('remote example has no serious or critical axe violations on desktop and mobile', async ({ page }, testInfo) => {
  for (const width of [1280, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto('/remote/');
    await expect(page.getByRole('grid')).toBeVisible();
    const report = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']).analyze();
    await testInfo.attach('axe-' + width, { body: JSON.stringify(report, null, 2), contentType: 'application/json' });
    expect(report.violations.filter((item) => ['serious', 'critical'].includes(item.impact))).toEqual([]);
  }
});
