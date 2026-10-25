import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('uncertain remote mutation survives reload and retries the original request exactly once', async ({
  page,
  request,
}) => {
  const writes = [];
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (req) => {
    if (req.url().endsWith('/remote/api/write')) writes.push(req.postDataJSON());
  });
  await page.goto('/remote/');
  await expect(page.locator('#status')).toContainText('ready');
  await page.getByLabel('First task title').fill('Recovered after reload');
  await page.getByRole('button', { name: 'Stage edit', exact: true }).click();
  await page.getByLabel('Next server response').selectOption('drop');
  await page.getByRole('button', { name: 'Save / retry', exact: true }).click();
  await expect(page.locator('#status')).toContainText('disconnected');
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('acheron-remote-mutation-v1')));
  expect(saved.mutation).toEqual(writes[0]);
  const server = await (await request.get('/remote/api/snapshot')).json();
  await page.reload();
  await expect(page.locator('#status')).toContainText('disconnected');
  await expect(page.locator('#status')).toContainText('1 pending');
  await expect(page.getByRole('button', { name: 'Stage edit', exact: true })).toBeDisabled();
  expect(writes).toHaveLength(1);
  await page.getByRole('button', { name: 'Save / retry', exact: true }).click();
  await expect(page.locator('#status')).toContainText('ready');
  await expect(page.locator('#status')).toContainText('0 pending');
  expect(writes).toHaveLength(2);
  expect(writes[1]).toEqual(writes[0]);
  expect((await (await request.get('/remote/api/snapshot')).json()).revision).toBe(server.revision);
  expect(await page.evaluate(() => localStorage.getItem('acheron-remote-mutation-v1'))).toBeNull();
  expect(errors).toEqual([]);
});

for (const kind of ['remote', 'paged']) {
  test(`${kind} example retries its initial HTTP failure without a partial grid`, async ({ page }) => {
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    let first = true;
    await page.route(kind === 'remote' ? '**/remote/api/snapshot' : '**/paged/api/page?**', async (route) => {
      if (first) {
        first = false;
        await route.fulfill({ status: 503, body: '{}' });
      } else await route.continue();
    });
    await page.goto(`/${kind}/`);
    await expect(page.locator('#status')).toContainText('HTTP 503');
    await expect(page.getByRole('grid')).toHaveCount(0);
    await page.getByRole('button', { name: 'Reload server data', exact: true }).click();
    await expect(page.locator('#status')).toContainText('ready');
    await expect(page.getByRole('grid')).toBeVisible();
    await page.getByRole('button', { name: 'Reload server data', exact: true }).click();
    await expect(page.locator('#status')).toContainText('ready');
    await expect(page.locator('#grid canvas')).toHaveCount(1);
    expect(errors).toEqual([]);
  });

  test(`${kind} example retains its grid on persisted pagehide and disposes on final pagehide`, async ({ page }) => {
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`/${kind}/`);
    await expect(page.locator('#status')).toContainText('ready');
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })));
    const grid = page.getByRole('grid');
    await expect(grid).toBeVisible();
    await grid.press('Control+Home');
    await grid.press('F2');
    const editor = page.getByRole('textbox', { name: /^Edit row 1/ });
    await editor.fill('Retained page draft');
    await editor.press('Enter');
    await expect(page.locator('#status')).toContainText('1 pending');
    await grid.press('Control+z');
    await expect(page.locator('#status')).toContainText('0 pending');
    await grid.press('Control+y');
    await expect(page.locator('#status')).toContainText('1 pending');
    await page.evaluate(() => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false })));
    await expect(page.getByRole('grid')).toHaveCount(0);
    expect(errors).toEqual([]);
  });

  test(`${kind} HTTP boundaries reject malformed writes without changing server state`, async ({ request }) => {
    const snapshot = async () =>
      (
        await request.get(kind === 'remote' ? '/remote/api/snapshot' : '/paged/api/page?offset=0&limit=2&query=%7B%7D')
      ).json();
    const before = await snapshot();
    const mutation = {
      datasetId: kind === 'remote' ? 'demo' : 'paged-demo',
      mutationId: 'denied-boundary',
      expectedRevision: before.revision,
      changes: [
        { rowId: before.rows[0].id, columnKey: 'title', previous: before.rows[0].values.title, value: 'Valid title' },
      ],
    };
    const body = (value) => (kind === 'remote' ? value : { mutation: value, query: {} });
    const path = `/${kind}/api/write`;
    expect(
      (await request.post(path, { headers: { origin: 'https://attacker.invalid' }, data: body(mutation) })).status(),
    ).toBe(403);
    expect((await request.post(path, { headers: { 'content-type': 'text/plain' }, data: '{}' })).status()).toBe(403);
    expect((await request.post(path, { headers: { 'content-type': 'application/json' }, data: '{' })).status()).toBe(
      400,
    );
    expect((await request.post(path, { data: { oversized: 'x'.repeat(16385) } })).status()).toBe(400);
    for (const patch of [
      { changes: [] },
      { changes: {} },
      { mutationId: '' },
      { mutationId: 'x'.repeat(257) },
      { expectedRevision: 1 },
      { changes: [mutation.changes[0], mutation.changes[0]] },
      ...[
        { columnKey: 'private' },
        { rowId: 'missing' },
        { previous: 1 },
        { value: '' },
        { value: 'x'.repeat(201) },
      ].map((change) => ({ changes: [{ ...mutation.changes[0], ...change }] })),
    ])
      expect((await request.post(path, { data: body({ ...mutation, ...patch }) })).status()).toBe(400);
    if (kind === 'paged') {
      for (const query of [null, [], 42, { filters: null }, { filters: [null] }, { sort: null }])
        expect(
          (
            await request.get('/paged/api/page', { params: { offset: 0, limit: 2, query: JSON.stringify(query) } })
          ).status(),
        ).toBe(400);
      const filtered = await (
        await request.get('/paged/api/page', {
          params: {
            offset: 0,
            limit: 10,
            query: JSON.stringify({
              filters: [
                { columnKey: 'title', operator: 'contains', query: 'task' },
                { columnKey: 'title', operator: 'contains', query: '1' },
              ],
            }),
          },
        })
      ).json();
      expect(filtered.rows.length).toBeGreaterThan(0);
      expect(
        filtered.rows.every((row) => row.values.title.toLowerCase().includes('task') && row.values.title.includes('1')),
      ).toBe(true);
    }
    expect(await snapshot()).toEqual(before);
  });
}

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
