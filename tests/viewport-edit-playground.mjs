import { test, expect } from './browser-fixtures.mjs';
import AxeBuilder from '@axe-core/playwright';

const journalKey = 'acheron-viewport-edit-mutation-v1';
async function simulation(page, mode) {
  const details = page.getByText('Simulate server responses', { exact: true });
  if (!(await page.locator('#mode').isVisible())) await details.click();
  await page.getByLabel('Server response').selectOption(mode);
  await expect(page.locator('#mode')).toBeEnabled();
}
async function open(page) {
  await page.goto('/paged/viewport-edit');
  await expect(page.locator('#status')).toContainText('ready');
  await simulation(page, 'normal');
}
async function edit(page, text) {
  await page.locator('#grid').scrollIntoViewIfNeeded();
  const grid = page.getByRole('grid');
  await grid.press('Control+Home');
  await expect(grid.getByRole('gridcell').first()).not.toHaveText('Not loaded');
  await grid.press('F2');
  const editor = page.getByRole('textbox');
  await editor.fill(text);
  await editor.press('Enter');
  await expect(page.locator('#status')).toContainText('1 pending cells');
}
async function scroll(page, top) {
  await page.getByRole('grid').evaluate((node, top) => {
    node.scrollTop = top;
    node.dispatchEvent(new Event('scroll'));
  }, top);
  await expect(page.locator('#status')).toContainText('ready');
}

for (const width of [1100, 390]) {
  test(`loaded viewport edits survive eviction, undo/redo and explicit save without remounting at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    const writes = [],
      errors = [];
    page.on('request', (request) => {
      if (request.url().endsWith('/paged/api/write')) writes.push(request.postDataJSON());
    });
    page.on('pageerror', (error) => errors.push(error.message));
    await open(page);
    await page.evaluate(() => {
      window.originalGrid = document.querySelector('[role=grid]');
    });
    const value = `Viewport staged ${width}`;
    await edit(page, value);
    expect(writes).toHaveLength(0);
    await scroll(page, 6400);
    await scroll(page, 12800);
    await scroll(page, 19200);
    await scroll(page, 0);
    await expect(page.getByRole('gridcell', { name: value, exact: true })).toBeAttached();
    const grid = page.getByRole('grid');
    await grid.press('Control+z');
    await expect(page.locator('#status')).toContainText('0 pending cells');
    await grid.press('Control+y');
    await expect(page.locator('#status')).toContainText('1 pending cells');
    await page.getByRole('button', { name: 'Save / retry', exact: true }).click();
    await expect(page.locator('#status')).toContainText('ready');
    await expect(page.locator('#status')).toContainText('0 pending cells');
    await expect(page.getByRole('gridcell', { name: value, exact: true })).toBeAttached();
    expect(writes).toHaveLength(1);
    expect(await page.evaluate(() => localStorage.getItem('acheron-viewport-edit-mutation-v1'))).toBeNull();
    expect(await page.evaluate(() => window.originalGrid === document.querySelector('[role=grid]'))).toBe(true);
    expect(await grid.getByRole('row').count()).toBeLessThan(40);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    await page.screenshot({ path: `../.verification/r1-${width}.png`, fullPage: true });
    expect(errors).toEqual([]);
  });
}

test('lost receipts restore the exact request after reload without old-revision loads or automatic writes', async ({
  page,
  request,
}) => {
  const writes = [],
    loads = [];
  page.on('request', (request) => {
    if (request.url().endsWith('/paged/api/write')) writes.push(request.postDataJSON());
    if (request.url().includes('/paged/api/page?')) loads.push(request.url());
  });
  await open(page);
  await simulation(page, 'drop');
  await edit(page, 'Recovered viewport request');
  await page.getByRole('button', { name: 'Save / retry', exact: true }).click();
  await expect(page.locator('#status')).toContainText('disconnected');
  await expect(page.locator('#grid')).toHaveJSProperty('inert', true);
  const checkpoint = await page.evaluate((key) => JSON.parse(localStorage.getItem(key)), journalKey);
  expect(checkpoint.writer.mutation).toEqual(writes[0].mutation);
  const before = await (await request.get('/paged/api/page?offset=0&limit=20&query=%7B%7D')).json();
  const loadCount = loads.length;
  await page.reload();
  await expect(page.locator('#status')).toContainText('Recovered a pending request');
  expect(writes).toHaveLength(1);
  expect(loads).toHaveLength(loadCount);
  await simulation(page, 'normal');
  await page.getByRole('button', { name: 'Save / retry', exact: true }).click();
  await expect(page.locator('#status')).toContainText('ready');
  await expect(page.locator('#status')).toContainText('0 pending cells');
  expect(writes).toHaveLength(2);
  expect(writes[1]).toEqual(writes[0]);
  const after = await (await request.get('/paged/api/page?offset=0&limit=20&query=%7B%7D')).json();
  expect(after.revision).toBe(before.revision);
  expect(await page.evaluate((key) => localStorage.getItem(key), journalKey)).toBeNull();
});

test('storage failure prevents transport and preserves the prepared request for explicit retry', async ({ page }) => {
  const writes = [];
  page.on('request', (request) => {
    if (request.url().endsWith('/paged/api/write')) writes.push(request.postDataJSON());
  });
  await open(page);
  await edit(page, 'Storage protected viewport value');
  await page.evaluate((key) => {
    window.originalSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (name, value) {
      if (name === key) throw new DOMException('Storage quota denied', 'QuotaExceededError');
      return window.originalSetItem.call(this, name, value);
    };
  }, journalKey);
  await page.getByRole('button', { name: 'Save / retry', exact: true }).click();
  await expect(page.locator('#status')).toContainText('Storage quota denied');
  await expect(page.locator('#status')).toContainText('1 pending cells');
  expect(writes).toHaveLength(0);
  await expect(page.getByRole('button', { name: 'Save / retry', exact: true })).toBeEnabled();
  await page.evaluate(() => {
    Storage.prototype.setItem = window.originalSetItem;
  });
  await page.getByRole('button', { name: 'Save / retry', exact: true }).click();
  await expect(page.locator('#status')).toContainText('0 pending cells');
  expect(writes).toHaveLength(1);
});

test('a delayed incoming page cannot evict raw editor input or force a write', async ({ page }) => {
  const writes = [];
  page.on('request', (request) => {
    if (request.url().endsWith('/paged/api/write')) writes.push(request);
  });
  await open(page);
  await scroll(page, 6400);
  await scroll(page, 12800);
  let release,
    started = false;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  await page.route('**/paged/api/page?**', async (route) => {
    if (new URL(route.request().url()).searchParams.get('offset') === '600') {
      started = true;
      await gate;
    }
    await route.continue();
  });
  try {
    await page.getByRole('grid').evaluate((node) => {
      node.scrollTop = 19200;
      node.dispatchEvent(new Event('scroll'));
    });
    await expect.poll(() => started).toBe(true);
    await page.getByRole('grid').evaluate((node) => {
      node.scrollTop = 0;
      node.dispatchEvent(new Event('scroll'));
    });
    const grid = page.getByRole('grid');
    await grid.press('Control+Home');
    await grid.press('F2');
    const editor = page.getByRole('textbox');
    await editor.fill('Pinned raw viewport input');
    await expect(page.getByRole('button', { name: 'Save / retry', exact: true })).toBeDisabled();
    await expect(page.locator('#query')).toBeDisabled();
    release();
    await expect(page.locator('#status')).toContainText('New pages will appear after editing finishes.');
    await expect(editor).toHaveValue('Pinned raw viewport input');
    await expect(page.locator('#status')).toContainText('0 pending cells');
    expect(writes).toHaveLength(0);
    await editor.press('Enter');
    await expect(page.locator('#status')).toContainText('ready');
    await expect(page.locator('#status')).toContainText('1 pending cells');
    await expect(page.getByRole('gridcell', { name: 'Pinned raw viewport input', exact: true })).toBeAttached();
    expect(writes).toHaveLength(0);
  } finally {
    release();
  }
});

test('title validation and wire-budget preflight retain edits without a write or frozen recovery state', async ({
  page,
}) => {
  const writes = [];
  page.on('request', (request) => {
    if (request.url().endsWith('/paged/api/write')) writes.push(request);
  });
  await open(page);
  const grid = page.getByRole('grid');
  await grid.press('Control+Home');
  await grid.press('F2');
  const editor = page.getByRole('textbox');
  await editor.fill('   ');
  await editor.press('Enter');
  await expect(editor).toHaveAttribute('aria-invalid', 'true');
  await editor.fill('x'.repeat(201));
  await editor.press('Enter');
  await expect(editor).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByRole('button', { name: 'Save / retry', exact: true })).toBeDisabled();
  await editor.press('Escape');
  await expect(page.locator('#status')).toContainText('ready');
  await grid.evaluate((node) => {
    const data = new DataTransfer();
    data.setData('text/plain', Array(30).fill('字'.repeat(200)).join('\n'));
    node.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  });
  await expect(page.locator('#status')).toContainText('30 pending cells');
  await page.getByRole('button', { name: 'Save / retry', exact: true }).click();
  await expect(page.locator('#status')).toContainText('16 KiB');
  await expect(page.locator('#status')).toContainText('ready');
  await expect(page.locator('#grid')).toHaveJSProperty('inert', false);
  expect(writes).toHaveLength(0);
  await grid.press('Control+z');
  await expect(page.locator('#status')).toContainText('0 pending cells');
  expect(writes).toHaveLength(0);
});

test('rejection keeps drafts, conflict adoption stays outside the inert grid, and invalid journals never auto-send', async ({
  page,
}) => {
  await open(page);
  await simulation(page, 'reject');
  await edit(page, 'Rejected viewport draft');
  await page.getByRole('button', { name: 'Save / retry', exact: true }).click();
  await expect(page.locator('#status')).toContainText('ready');
  await expect(page.locator('#status')).toContainText('1 pending cells');
  await simulation(page, 'normal');
  await page.getByRole('button', { name: 'Simulate external edit', exact: true }).click();
  await expect(page.locator('#external')).toBeEnabled();
  await page.getByRole('button', { name: 'Save / retry', exact: true }).click();
  await expect(page.locator('#conflict')).toBeVisible();
  await expect(page.locator('#grid')).toHaveJSProperty('inert', true);
  await expect(page.getByRole('button', { name: 'Accept server and discard draft' })).toBeEnabled();
  await page.getByRole('button', { name: 'Accept server and discard draft' }).click();
  await expect(page.locator('#status')).toContainText('0 pending cells');
  await expect(page.getByRole('gridcell', { name: 'Server edit', exact: true })).toBeAttached();
  await page.evaluate((key) => localStorage.setItem(key, '{invalid'), journalKey);
  const writes = [],
    loads = [];
  page.on('request', (request) => {
    if (request.url().endsWith('/paged/api/write')) writes.push(request);
    if (request.url().includes('/paged/api/page?')) loads.push(request);
  });
  await page.reload();
  await expect(page.locator('#recovery')).toBeVisible();
  await expect(page.locator('#status')).toContainText('JSON');
  expect(writes).toHaveLength(0);
  expect(loads).toHaveLength(0);
  expect(await page.evaluate((key) => localStorage.getItem(key), journalKey)).toBe('{invalid');
});

test('matching draft checkpoints restore without writes and an accepted filtered edit adopts the new total and order', async ({
  page,
  request,
}) => {
  const writes = [];
  page.on('request', (request) => {
    if (request.url().endsWith('/paged/api/write')) writes.push(request.postDataJSON());
  });
  const query = {
    sort: { columnKey: 'title', direction: 'desc' },
    filters: [{ columnKey: 'title', operator: 'contains', query: 'Task 8' }],
  };
  const expected = await (
    await request.get('/paged/api/page?' + new URLSearchParams({ offset: 0, limit: 20, query: JSON.stringify(query) }))
  ).json();
  await open(page);
  async function applyQuery() {
    await page.getByText('Server query and draft checkpoints', { exact: true }).click();
    await page.getByLabel('Search tasks').fill('Task 8');
    await page.getByRole('combobox', { name: 'Order', exact: true }).selectOption('desc');
    await page.getByRole('button', { name: 'Apply server query' }).click();
    await expect(page.locator('#status')).toContainText('ready');
    await expect(page.getByRole('grid')).toHaveAttribute('aria-rowcount', String(expected.total + 1));
  }
  await applyQuery();
  await page.evaluate(() => {
    window.originalGrid = document.querySelector('[role=grid]');
  });
  await edit(page, 'Checkpoint viewport draft');
  await expect(page.getByRole('button', { name: 'Apply server query' })).toBeDisabled();
  await page.getByRole('button', { name: 'Save draft locally' }).click();
  await expect(page.locator('#checkpoint')).toBeEnabled();
  expect(writes).toHaveLength(0);
  await page.reload();
  await expect(page.locator('#status')).toContainText('ready');
  await applyQuery();
  await page.evaluate(() => {
    window.originalGrid = document.querySelector('[role=grid]');
  });
  await page.getByRole('button', { name: 'Restore saved draft' }).click();
  await expect(page.locator('#status')).toContainText('1 pending cells');
  await expect(page.getByRole('gridcell', { name: 'Checkpoint viewport draft', exact: true })).toBeAttached();
  expect(writes).toHaveLength(0);
  await page.getByRole('button', { name: 'Save / retry', exact: true }).click();
  await expect(page.locator('#status')).toContainText('ready');
  await expect(page.locator('#status')).toContainText('0 pending cells');
  await expect(page.getByRole('grid')).toHaveAttribute('aria-rowcount', String(expected.total));
  expect(writes).toHaveLength(1);
  expect(writes[0].query).toEqual(query);
  expect(await page.evaluate(() => window.originalGrid === document.querySelector('[role=grid]'))).toBe(true);
  expect(await page.evaluate(() => localStorage.getItem('acheron-viewport-edit-draft-v1'))).toBeNull();
});
