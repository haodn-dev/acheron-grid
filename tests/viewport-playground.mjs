import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { writeFile } from 'node:fs/promises';

for (const width of [1100, 390])
  test(`stable-ID lookup restores a selected task with one mount and bounded page loading at ${width}px`, async ({
    page,
    request,
  }) => {
    await page.setViewportSize({ width, height: 860 });
    const errors = [],
      reads = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('request', (req) => {
      if (req.url().includes('/paged/api/viewport?')) reads.push(req.url());
    });
    await page.goto('/paged/viewport');
    await expect(page.getByRole('gridcell', { name: 'Task 0', exact: true })).toBeAttached();
    await page.evaluate(() => (window.originalGrid = document.querySelector('[role=grid]')));
    await page.getByRole('grid').press('Control+Home');
    await page.getByLabel('Keep selected task').check();
    await page.getByLabel('Task order').selectOption('desc');
    const before = reads.length;
    await page.getByRole('button', { name: 'Apply data view' }).click();
    await expect(page.locator('#anchor-status')).toHaveText('Kept Task 0 in the new view.');
    await expect(page.getByRole('gridcell', { name: 'Task 0', exact: true })).toBeAttached();
    const active = await page.getByRole('grid').getAttribute('aria-activedescendant');
    await expect(page.locator(`[id="${active}"]`)).toHaveText('Task 0');
    await expect(page.locator('#status')).toContainText('Ready');
    expect(reads.length - before).toBeLessThanOrEqual(3);
    expect(await page.evaluate(() => window.originalGrid === document.querySelector('[role=grid]'))).toBe(true);
    expect((await request.get('/paged/api/locate?rowId=50000&total=1000000&order=desc&revision=1')).status()).toBe(200);
    expect(
      await (await request.get('/paged/api/locate?rowId=50000&total=1000000&order=desc&revision=1')).json(),
    ).toMatchObject({ rowId: 50000, index: 949999, revision: '1' });
    for (const suffix of [
      'rowId=-1&revision=1',
      'rowId=&revision=1',
      'rowId=1.5&revision=1',
      'rowId=1000000&revision=1',
    ])
      expect((await request.get('/paged/api/locate?total=100000&order=asc&' + suffix)).status()).toBe(400);
    expect((await request.get('/paged/api/locate?rowId=0&total=100000&order=asc&revision=old')).status()).toBe(409);
    expect(errors).toEqual([]);
  });

test('a task removed from the new result clears selection and returns to the first row', async ({ page }) => {
  await page.goto('/paged/viewport?rows=1000000');
  await expect(page.getByRole('gridcell', { name: 'Task 0', exact: true })).toBeAttached();
  await page.getByLabel('Task order').selectOption('desc');
  await page.getByRole('button', { name: 'Apply data view' }).click();
  await expect(page.getByRole('gridcell', { name: 'Task 999999', exact: true })).toBeAttached();
  await page.getByRole('grid').press('Control+Home');
  await page.getByLabel('Keep selected task').check();
  await page.getByLabel('Record count').selectOption('100000');
  await page.getByRole('button', { name: 'Apply data view' }).click();
  await expect(page.locator('#anchor-status')).toContainText('not in this view');
  await expect(page.getByRole('gridcell', { name: 'Task 99999', exact: true })).toBeAttached();
  await expect(page.getByRole('grid')).not.toHaveAttribute('aria-activedescendant', /.+/);
  expect(await page.locator('[data-grid-viewport]').evaluate((node) => node.scrollTop)).toBe(0);
});

test('a superseded locator cannot replace the latest query or selection', async ({ page }) => {
  let release, entered;
  const held = new Promise((resolve) => (release = resolve)),
    started = new Promise((resolve) => (entered = resolve));
  await page.route('**/paged/api/locate?**', async (route) => {
    if (new URL(route.request().url()).searchParams.get('order') === 'desc') {
      entered();
      await held;
      await route.fulfill({
        json: { datasetId: 'viewport-demo', revision: '1', rowId: 0, total: 100000, order: 'desc', index: 99999 },
      });
    } else await route.continue();
  });
  await page.goto('/paged/viewport');
  await expect(page.getByRole('gridcell', { name: 'Task 0', exact: true })).toBeAttached();
  await page.getByRole('grid').press('Control+Home');
  await page.getByLabel('Keep selected task').check();
  await page.getByLabel('Task order').selectOption('desc');
  await page.getByRole('button', { name: 'Apply data view' }).click();
  await started;
  await page.getByLabel('Task order').selectOption('asc');
  await page.getByRole('button', { name: 'Apply data view' }).click();
  await expect(page.locator('#anchor-status')).toHaveText('Kept Task 0 in the new view.');
  release();
  await expect(page.locator('#status')).toContainText('lowest ID first');
  await expect(page.getByRole('gridcell', { name: 'Task 0', exact: true })).toBeAttached();
  expect(await page.locator('[data-grid-viewport]').evaluate((node) => node.scrollTop)).toBe(0);
});

for (const mode of ['malformed', 'wrong-page-id'])
  test(`unverified anchor ${mode} falls back without selecting another record`, async ({ page }) => {
    if (mode === 'malformed')
      await page.route('**/paged/api/locate?**', (route) =>
        route.fulfill({
          json: { datasetId: 'viewport-demo', revision: '1', rowId: 42, total: 100000, order: 'desc', index: 99999 },
        }),
      );
    else
      await page.route('**/paged/api/viewport?**', async (route) => {
        const url = new URL(route.request().url());
        if (url.searchParams.get('order') === 'desc' && url.searchParams.get('offset') === '99900') {
          const response = await route.fetch(),
            body = await response.json();
          body.rows.at(-1).id = 999999;
          await route.fulfill({ json: body });
        } else await route.continue();
      });
    await page.goto('/paged/viewport');
    await expect(page.getByRole('gridcell', { name: 'Task 0', exact: true })).toBeAttached();
    await page.getByRole('grid').press('Control+Home');
    await page.getByLabel('Keep selected task').check();
    await page.getByLabel('Task order').selectOption('desc');
    await page.getByRole('button', { name: 'Apply data view' }).click();
    await expect(page.locator('#anchor-status')).toContainText('Selection cleared; returned to the first row.');
    await expect(page.locator('#anchor-status')).toContainText(
      mode === 'malformed' ? 'requested view' : 'located identity',
    );
    await expect(page.getByRole('gridcell', { name: 'Task 99999', exact: true })).toBeAttached();
    await expect(page.getByRole('grid')).not.toHaveAttribute('aria-activedescendant', /.+/);
  });

test('a native-unreachable anchor explicitly clears selection instead of claiming it was retained', async ({
  page,
}) => {
  await page.addInitScript(() => {
    const descriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight');
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
      configurable: true,
      get() {
        return Number.parseFloat(this.style.height) > 16000000 ? 0 : descriptor.get.call(this);
      },
    });
  });
  await page.goto('/paged/viewport?rows=1000000');
  await expect(page.getByRole('gridcell', { name: 'Task 0', exact: true })).toBeAttached();
  await page.getByRole('grid').press('Control+Home');
  await page.getByLabel('Keep selected task').check();
  await page.getByLabel('Task order').selectOption('desc');
  await page.getByRole('button', { name: 'Apply data view' }).click();
  await expect(page.locator('#anchor-status')).toContainText('outside the browser scroll range');
  await expect(page.getByRole('gridcell', { name: 'Task 999999', exact: true })).toBeAttached();
  await expect(page.getByRole('grid')).not.toHaveAttribute('aria-activedescendant', /.+/);
  expect(await page.locator('[data-grid-viewport]').evaluate((node) => node.scrollTop)).toBe(0);
});

for (const [width, rows] of [
  [1100, 100000],
  [390, 1000000],
]) {
  test(`remote viewport keeps one mount and bounded requests/cache at ${width}px with ${rows} logical rows`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 860 });
    const requests = [],
      errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('request', (request) => {
      if (request.url().includes('/paged/api/viewport?')) requests.push(request.url());
    });
    await page.goto('/paged/viewport?rows=' + rows);
    await expect(page.locator('#status')).toContainText('Ready');
    await expect(page.getByRole('gridcell', { name: 'Task 0', exact: true })).toBeAttached();
    await page.evaluate(() => {
      window.originalGrid = document.querySelector('[role=grid]');
    });
    await page.locator('[data-grid-viewport]').evaluate((node) => {
      node.scrollTop = 1500000;
      node.dispatchEvent(new Event('scroll'));
    });
    await expect(page.locator('#status')).toContainText('Ready');
    await expect.poll(() => requests.length).toBeGreaterThan(2);
    await expect.poll(() => page.getByRole('gridcell', { name: /^Task / }).count()).toBeGreaterThan(0);
    for (const top of [3000000, 100000, 2100000, 0]) {
      await page.locator('[data-grid-viewport]').evaluate((node, top) => {
        node.scrollTop = top;
        node.dispatchEvent(new Event('scroll'));
      }, top);
      await expect(page.getByRole('gridcell', { name: /^Task / }).first()).toBeAttached();
      await expect(page.locator('#status')).toContainText('Ready');
    }
    await expect(page.getByRole('gridcell', { name: 'Task 0', exact: true })).toBeAttached();
    expect(await page.evaluate(() => window.originalGrid === document.querySelector('[role=grid]'))).toBe(true);
    await expect(page.getByRole('grid')).toHaveCount(1);
    expect(await page.getByRole('row').count()).toBeLessThan(40);
    expect(requests.length).toBeLessThan(25);
    const status = await page.locator('#status').textContent();
    expect(Number(/(\d+) \/ 8 cached/.exec(status)[1])).toBeLessThanOrEqual(8);
    const before = requests.length;
    await page.getByRole('grid').press('Control+Home');
    await page.getByRole('grid').press('Control+a');
    await page.getByRole('grid').press('Control+c');
    await page.getByRole('grid').press('Control+f');
    await expect(page.locator('[data-grid-search]')).toBeHidden();
    expect(requests.length).toBe(before);
    const violations = (await new AxeBuilder({ page }).analyze()).violations;
    expect(violations).toEqual([]);
    await page.screenshot({ path: `../.verification/r0c-${width}.png`, fullPage: true });
    const native = await page.locator('[data-grid-viewport]').evaluate((node) => {
      node.scrollTop = node.scrollHeight;
      return { scrollHeight: node.scrollHeight, clientHeight: node.clientHeight, lastScrollTop: node.scrollTop };
    });
    expect(native.lastScrollTop).toBeGreaterThan(1000000);
    await writeFile(
      new URL(`../../.verification/r0c-native-${testInfo.project.use.browserName}-${rows}.json`, import.meta.url),
      JSON.stringify({ rows, ...native }),
    );
    await testInfo.attach('native-scroll-range', {
      body: JSON.stringify({ browser: testInfo.project.use.browserName, rows, ...native }),
      contentType: 'application/json',
    });
    expect(errors).toEqual([]);
  });
}

test('remote viewport shows page failure without retry storms and recovers explicitly', async ({ page, request }) => {
  let failures = 0,
    attempts = 0;
  await page.route('**/paged/api/viewport?**', async (route) => {
    attempts++;
    if (new URL(route.request().url()).searchParams.get('offset') === '0' && failures++ === 0) {
      await route.fulfill({ status: 503, body: '{}' });
    } else await route.continue();
  });
  await page.goto('/paged/viewport');
  await expect(page.locator('#status')).toContainText('HTTP 503');
  await expect(page.locator('#status')).toContainText('Ready');
  const failedAttempts = attempts;
  await page.locator('[data-grid-viewport]').evaluate((node) => {
    for (let i = 0; i < 20; i++) node.dispatchEvent(new Event('scroll'));
  });
  expect(attempts).toBe(failedAttempts);
  await page.getByRole('button', { name: 'Retry visible pages' }).click();
  await expect(page.getByRole('gridcell', { name: 'Task 0', exact: true })).toBeAttached();
  await expect(page.getByRole('button', { name: 'Retry visible pages' })).toBeDisabled();
  expect((await request.get('/paged/api/viewport?offset=1&limit=100&total=100000')).status()).toBe(400);
  expect((await request.get('/paged/api/viewport?offset=0&limit=1000000&total=1000000')).status()).toBe(400);
});

for (const width of [1100, 390]) {
  test(`server order and record-count changes keep the viewport mounted and clear the old selection at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto('/paged/viewport');
    await expect(page.getByRole('gridcell', { name: 'Task 0', exact: true })).toBeAttached();
    await page.evaluate(() => {
      window.originalGrid = document.querySelector('[role=grid]');
    });
    const grid = page.getByRole('grid');
    await grid.press('Control+Home');
    await page.getByLabel('Task order').selectOption('desc');
    await page.getByRole('button', { name: 'Apply data view' }).click();
    await expect(page.getByRole('gridcell', { name: 'Task 99999', exact: true })).toBeAttached();
    await expect(grid).not.toHaveAttribute('aria-activedescendant', /.+/);
    await page.getByLabel('Record count').selectOption('1000000');
    await page.getByRole('button', { name: 'Apply data view' }).click();
    await expect(page.getByRole('gridcell', { name: 'Task 999999', exact: true })).toBeAttached();
    await expect(grid).toHaveAttribute('aria-rowcount', '1000001');
    await expect(page.locator('#status')).toContainText('highest ID first');
    await page.getByLabel('Task order').selectOption('asc');
    await page.getByRole('button', { name: 'Apply data view' }).click();
    await expect(page.getByRole('gridcell', { name: 'Task 0', exact: true })).toBeAttached();
    expect(await page.evaluate(() => window.originalGrid === document.querySelector('[role=grid]'))).toBe(true);
    expect(await page.getByRole('row').count()).toBeLessThan(40);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.screenshot({ path: `../.verification/r0d-${width}.png`, fullPage: true });
    expect(errors).toEqual([]);
  });
}
