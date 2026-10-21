import { test, expect } from '@playwright/test';

test('choice initialization errors clean up mounted controls and allow a fresh editor', async ({ page }) => {
  await setup(page);
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  for (const kind of [
    'height-zero',
    'height-negative',
    'height-nan',
    'height-infinity',
    'delay-negative',
    'delay-nan',
    'delay-infinity',
    'attached',
    'foreign',
    'second-draw',
  ]) {
    await page.evaluate((kind) => {
      const attached = document.createElement('span');
      attached.id = 'host-choice';
      attached.textContent = 'Host-owned';
      document.body.append(attached);
      let calls = 0;
      const options = kind.startsWith('height')
        ? {
            maxHeight: { 'height-zero': 0, 'height-negative': -1, 'height-nan': NaN, 'height-infinity': Infinity }[
              kind
            ],
          }
        : kind.startsWith('delay')
          ? { searchDelay: { 'delay-negative': -1, 'delay-nan': NaN, 'delay-infinity': Infinity }[kind] }
          : {
              ...(kind === 'second-draw' ? { searchDelay: 0, loadOptions: async () => [] } : {}),
              renderOption: (_, doc) => {
                if (kind === 'attached') return attached;
                if (kind === 'foreign') return document.implementation.createHTMLDocument().createElement('span');
                if (++calls === 3) throw new Error('Host renderer failed');
                return doc.createElement('span');
              },
            };
      window.grid.setColumnEditor('tags', { type: 'multiselect', values: ['a', 'b'], choiceEditor: options });
    }, kind);
    const viewport = page.getByRole('grid');
    await viewport.press('Control+Home');
    await viewport.press('Enter');
    await expect(page.locator('select')).toHaveCount(0);
    await expect(page.locator('[data-grid-choices]')).toHaveCount(0);
    await expect(page.getByRole('alert').filter({ hasText: /Choice|renderer/ })).toBeVisible();
    await expect(viewport).toBeFocused();
    expect(await page.evaluate(() => window.source.getValue(0, 'tags'))).toBe('b, a');
    await expect(page.locator('#host-choice')).toHaveText('Host-owned');
    await page.evaluate(() => {
      document.querySelector('#host-choice').remove();
      window.grid.setColumnEditor('tags', { type: 'multiselect', values: ['a', 'b'], choiceEditor: {} });
    });
    await viewport.press('Enter');
    await expect(page.locator('[data-grid-choices]')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(viewport).toBeFocused();
  }
  expect(errors).toEqual([]);
});

test('choice keyboard focus loops, skips disabled entries and preserves uncommitted drafts', async ({ page }) => {
  await setup(page);
  await page.evaluate(() =>
    window.grid.setColumnEditor('tags', {
      type: 'multiselect',
      values: ['a', { value: 'blocked', disabled: true }, 'b'],
      choiceEditor: { valueOrder: 'options' },
    }),
  );
  const viewport = page.getByRole('grid');
  await viewport.press('Control+Home');
  await viewport.press('Enter');
  const panel = page.locator('[data-grid-choices]');
  const search = panel.getByRole('searchbox');
  await search.press('Shift+Tab');
  await expect(panel.getByRole('button', { name: 'Apply', exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(search).toBeFocused();
  await search.press('ArrowDown');
  await expect(panel.getByRole('checkbox', { name: 'b', exact: true })).toBeFocused();
  await page.keyboard.press('Home');
  await expect(panel.getByRole('checkbox', { name: 'a', exact: true })).toBeFocused();
  await page.keyboard.press('Space');
  await expect(panel.getByRole('checkbox', { name: 'a', exact: true })).not.toBeChecked();
  expect(await page.evaluate(() => window.source.getValue(0, 'tags'))).toBe('b, a');
  await panel.evaluate((node) =>
    node.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true })),
  );
  await expect(panel).toBeVisible();
  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => window.source.getValue(0, 'tags'))).toBe('b, a');
  await viewport.press('Enter');
  await panel.getByRole('button', { name: 'Apply', exact: true }).click();
  expect(await page.evaluate(() => window.source.getValue(0, 'tags'))).toBe('a, b');
  await page.evaluate(() => window.grid.undo());
  expect(await page.evaluate(() => window.source.getValue(0, 'tags'))).toBe('b, a');
});

async function setup(page, options = {}) {
  await page.goto('/');
  await page.evaluate(async (options) => {
    const { createGrid } = await import('/canvas/index.js');
    const { LocalDataSource } = await import('/core/index.js');
    window.source = new LocalDataSource(
      [
        { id: 1, tags: 'b, a' },
        { id: 2, tags: 'a' },
      ],
      (row) => row.id,
    );
    window.grid = createGrid({
      container: document.querySelector('#grid'),
      dataSource: window.source,
      columns: [{ key: 'tags', title: 'Tags', editable: true }],
      ...options,
    });
  }, options);
}
test('per-column labels, disabled options and custom matching store values and allow dynamic updates', async ({
  page,
}) => {
  await setup(page);
  await page.evaluate(async () => {
    window.grid.destroy();
    const { createGrid } = await import('/canvas/index.js');
    window.grid = createGrid({
      container: document.querySelector('#grid'),
      dataSource: window.source,
      columns: [{ key: 'tags', title: 'Tags', editable: true }],
      columnEditors: {
        tags: {
          type: 'multiselect',
          values: [
            { value: 'a', label: 'Alpha' },
            { value: 'b', label: 'Beta' },
            { value: 'c', label: 'Blocked', disabled: true },
          ],
          choiceEditor: {
            placeholder: 'Look up',
            matches: (query, option) => !query || option.value === query,
            selectedLabel: (count) => count + ' picked',
            noMatchLabel: 'Nothing found',
          },
        },
      },
    });
  });
  const viewport = page.getByRole('grid');
  await viewport.press('Control+Home');
  await viewport.press('Enter');
  const query = page.getByRole('searchbox', { name: 'Search options' });
  await expect(page.getByRole('checkbox', { name: 'Blocked' })).toBeDisabled();
  await query.fill('b');
  await expect(page.getByRole('checkbox', { name: 'Beta' })).toBeVisible();
  await expect(page.getByRole('checkbox', { name: 'Alpha' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  expect(await page.evaluate(() => window.source.getValue(0, 'tags'))).toBe('b, a');
  await page.evaluate(() =>
    window.grid.setColumnEditor('tags', {
      type: 'multiselect',
      values: [{ value: 'a', label: 'New Alpha' }, 'b'],
      choiceEditor: { searchable: false },
    }),
  );
  await viewport.press('Enter');
  await expect(page.getByRole('searchbox', { name: 'Search options' })).toBeHidden();
  await expect(page.getByRole('checkbox', { name: 'New Alpha' })).toBeVisible();
  await page.keyboard.press('Escape');
});
test('remote option loaders cancel old requests, keep selected values and abort on editor disposal', async ({
  page,
}) => {
  await setup(page);
  await page.evaluate(() => {
    window.calls = [];
    window.grid.setColumnEditor('tags', {
      type: 'multiselect',
      values: ['a', 'b'],
      choiceEditor: {
        searchDelay: 0,
        loadOptions: (query, { signal, columnKey }) =>
          new Promise((resolve) => {
            window.calls.push({ query, signal, resolve, columnKey });
          }),
      },
    });
  });
  const viewport = page.getByRole('grid');
  await viewport.press('Control+Home');
  await viewport.press('Enter');
  await expect.poll(() => page.evaluate(() => window.calls.length)).toBe(1);
  const query = page.getByRole('searchbox', { name: 'Search options' });
  await query.fill('new');
  await expect.poll(() => page.evaluate(() => window.calls.length)).toBe(2);
  expect(await page.evaluate(() => window.calls[0].signal.aborted)).toBe(true);
  await page.evaluate(() => {
    window.calls[1].resolve([{ value: 'c', label: 'New choice' }]);
    window.calls[0].resolve([{ value: 'stale', label: 'Stale' }]);
  });
  await expect(page.getByRole('checkbox', { name: 'New choice' })).toBeVisible();
  await expect(page.getByRole('checkbox', { name: 'Stale' })).toHaveCount(0);
  await page.getByRole('checkbox', { name: 'New choice' }).check();
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  expect(await page.evaluate(() => window.source.getValue(0, 'tags'))).toBe('b, a, c');
  expect(await page.evaluate(() => window.calls[1].signal.aborted)).toBe(true);
});
test('invalid sparse remote options preserve the selected draft and recover without data loss', async ({ page }) => {
  await setup(page);
  await page.evaluate(() => {
    window.remoteQueries = [];
    window.grid.setColumnEditor('tags', {
      type: 'multiselect',
      values: ['a', 'b'],
      choiceEditor: {
        searchDelay: 0,
        loadOptions: async (query) => {
          window.remoteQueries.push(query);
          if (query === 'recover') return [{ value: 'c', label: 'Recovered' }];
          const invalid = [
            null,
            {},
            [null],
            [{ value: 1 }],
            [{ value: 'c', label: 1 }],
            [{ value: 'c', disabled: 'false' }],
            [{ value: 'c' }, { value: 'c' }],
            [{ value: '' }],
            [{ value: 'c,d' }],
          ];
          return query.startsWith('invalid-') ? invalid[Number(query.slice(8))] : Array(1);
        },
      },
    });
  });
  const viewport = page.getByRole('grid');
  await viewport.press('Control+Home');
  await viewport.press('Enter');
  await expect(page.getByText('Unable to load options. Try searching again.', { exact: true })).toBeVisible();
  expect(
    await page.locator('select').evaluate((select) => Array.from(select.selectedOptions, (option) => option.value)),
  ).toEqual(['a', 'b']);
  await expect(page.getByRole('checkbox', { name: 'a', exact: true })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: 'b', exact: true })).toBeChecked();
  expect(await page.evaluate(() => window.source.getValue(0, 'tags'))).toBe('b, a');
  for (let index = 0; index < 9; index++) {
    const query = `invalid-${index}`;
    await page.getByRole('searchbox', { name: 'Search options' }).fill(query);
    await expect.poll(() => page.evaluate((query) => window.remoteQueries.includes(query), query)).toBe(true);
    await expect(page.getByText('Unable to load options. Try searching again.', { exact: true })).toBeVisible();
    await expect(page.getByRole('checkbox', { name: 'a', exact: true })).toBeChecked();
    await expect(page.getByRole('checkbox', { name: 'b', exact: true })).toBeChecked();
    expect(await page.evaluate(() => window.source.getValue(0, 'tags'))).toBe('b, a');
  }
  await page.getByRole('searchbox', { name: 'Search options' }).fill('recover');
  await page.getByRole('checkbox', { name: 'Recovered' }).check();
  await page.getByRole('button', { name: 'Apply', exact: true }).click();
  expect(await page.evaluate(() => window.source.getValue(0, 'tags'))).toBe('b, a, c');
  await page.evaluate(() => window.grid.undo());
  expect(await page.evaluate(() => window.source.getValue(0, 'tags'))).toBe('b, a');
});

test('custom editor integration cleans up, external refresh and state restore update Canvas', async ({ page }) => {
  await setup(page);
  await page.evaluate(async () => {
    window.grid.destroy();
    const { createGrid } = await import('/canvas/index.js');
    window.mounts = 0;
    window.cleanups = 0;
    window.events = [];
    window.grid = createGrid({
      container: document.querySelector('#grid'),
      dataSource: window.source,
      columns: [{ key: 'tags', title: 'Tags', editable: true }],
      onEditorMount: () => {
        window.mounts++;
        return () => window.cleanups++;
      },
    });
    window.grid.subscribe({ onEvent: (event) => window.events.push(event.type) });
  });
  const viewport = page.getByRole('grid');
  await viewport.press('Control+Home');
  await viewport.press('Enter');
  await page.keyboard.press('Escape');
  expect(await page.evaluate(() => [window.mounts, window.cleanups])).toEqual([1, 1]);
  await page.evaluate(() => {
    window.saved = window.grid.exportState();
    window.source.setValue(0, 'tags', 'External');
    window.grid.refreshData('values');
  });
  await expect(page.locator('[role=gridcell]')).toContainText('External');
  await page.evaluate(() => window.grid.restoreState(window.saved));
  expect(await page.evaluate(() => window.events)).toContain('state:restore');
  await viewport.press('Enter');
  await page.evaluate(() => window.grid.destroy());
  expect(await page.evaluate(() => window.cleanups)).toBe(2);
});
