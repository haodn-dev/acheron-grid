import { test, expect } from './browser-fixtures.mjs';

async function setup(page) {
  await page.goto('/');
  await page.evaluate(async () => {
    const { createGrid } = await import('/canvas/index.js');
    const { LocalDataSource } = await import('/core/index.js');
    const { markdownToHtml } = await import('/markdown/index.js');
    window.source = new LocalDataSource(
      [
        { id: 1, md: '**Bold** and *italic*', html: '<strong>HTML</strong> <u>underline</u>', plain: 'original' },
        { id: 2, md: 'second', html: 'other', plain: 'tail' },
      ],
      (row) => row.id,
    );
    window.grid = createGrid({
      container: document.querySelector('#grid'),
      columns: ['md', 'html', 'plain'].map((key) => ({ key, title: key, editable: true })),
      dataSource: window.source,
      richTextColumns: { md: 'markdown', html: 'html' },
      markdownToHtml,
      accessibility: 'viewport',
      multilineEditor: true,
      editorOptions: { pinned: true },
      wrapText: true,
      rowHeight: 48,
      columnWidth: 180,
    });
  });
}

test('link actions live in the popover without floating cell badges', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const { createGrid } = await import('/canvas/index.js');
    const { LocalDataSource } = await import('/core/index.js');
    window.grid = createGrid({
      container: document.querySelector('#grid'),
      dataSource: new LocalDataSource(
        [{ id: 1, text: 'https://example.com/one https://example.org/two' }],
        (row) => row.id,
      ),
      columns: [{ key: 'text', title: 'Text' }],
      columnWidth: 400,
    });
  });
  const viewport = page.getByRole('grid');
  await viewport.press('Control+Home');
  await viewport.press('Alt+Enter');
  const popup = page.getByRole('dialog', { name: 'Cell links' });
  await expect(popup.getByRole('link')).toHaveCount(2);
  await expect(popup.getByRole('link').nth(1)).toHaveAttribute('href', 'https://example.org/two');
  await expect(popup.getByRole('link').locator('svg')).toHaveCount(2);
  await expect(page.locator('[data-grid-link-badges]')).toHaveCount(0);
});

test('selected-cell font shortcuts toggle metadata, preserve data and replay history', async ({ page }) => {
  await setup(page);
  const viewport = page.getByRole('grid');
  await viewport.press('Control+Home');
  await viewport.press('Control+b');
  await viewport.press('Control+i');
  expect(await page.evaluate(() => window.grid.getFormat(0, 0))).toMatchObject({
    fontWeight: 'bold',
    fontStyle: 'italic',
  });
  expect(await page.evaluate(() => window.source.getValue(0, 'md'))).toBe('**Bold** and *italic*');
  await viewport.press('Control+b');
  expect(await page.evaluate(() => window.grid.getFormat(0, 0).fontWeight)).toBe('normal');
  await viewport.press('Control+z');
  expect(await page.evaluate(() => window.grid.getFormat(0, 0).fontWeight)).toBe('bold');
  await viewport.press('Control+z');
  expect(await page.evaluate(() => window.grid.getFormat(0, 0).fontStyle)).toBeUndefined();
  await viewport.press('Control+y');
  expect(await page.evaluate(() => window.grid.getFormat(0, 0).fontStyle)).toBe('italic');
  const data = await viewport.evaluate((el) => {
    const clipboardData = new DataTransfer();
    el.dispatchEvent(new ClipboardEvent('copy', { bubbles: true, cancelable: true, clipboardData }));
    window.fontClipboard = clipboardData;
    return clipboardData.getData('text/html');
  });
  expect(data).toContain('fontWeight');
  await viewport.press('ArrowRight');
  await viewport.press('ArrowRight');
  await viewport.evaluate((el) =>
    el.dispatchEvent(
      new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: window.fontClipboard }),
    ),
  );
  expect(await page.evaluate(() => window.grid.getFormat(0, 2))).toMatchObject({
    fontWeight: 'bold',
    fontStyle: 'italic',
  });
});

test('keyboard context menus suppress the browser menu on focused popup controls', async ({ page }) => {
  await setup(page);
  const viewport = page.getByLabel(/^Data grid viewport/);
  await viewport.press('Control+Home');
  for (const key of ['Shift+F10', 'ContextMenu']) {
    await viewport.press(key);
    const menu = page.getByRole('menu', { name: 'Cell actions' });
    await expect(menu).toBeVisible();
    expect(
      await page.evaluate(() => {
        const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
        document.activeElement.dispatchEvent(event);
        return event.defaultPrevented;
      }),
    ).toBe(true);
    await expect(menu).toHaveCount(1);
    await page.keyboard.press('Escape');
  }
  await page.getByRole('columnheader', { name: 'md', exact: true }).press('Shift+F10');
  await expect(page.getByRole('menu', { name: 'Column actions' })).toBeVisible();
  expect(
    await page.evaluate(() =>
      document.activeElement.dispatchEvent(
        new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, clientX: 200, clientY: 100 }),
      ),
    ),
  ).toBe(false);
  await expect(page.getByRole('menu', { name: 'Column actions' })).toHaveCount(1);
  await page.keyboard.press('Escape');
  await viewport.press('F2');
  const editor = page.getByRole('textbox', { name: 'Edit row 1, md', exact: true });
  expect(
    await editor.evaluate(
      (el) => !el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true })),
    ),
  ).toBe(false);
});

test('Enter opens choices without committing, toggles checkboxes and keeps focus borders inside cells', async ({
  page,
}) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const { createGrid } = await import('/canvas/index.js');
    const { LocalDataSource } = await import('/core/index.js');
    window.source = new LocalDataSource([{ id: 1, tags: 'Idea', approved: false, text: 'draft' }], (row) => row.id);
    window.grid = createGrid({
      container: document.querySelector('#grid'),
      dataSource: window.source,
      columns: ['tags', 'approved', 'text'].map((key) => ({
        key,
        title: key,
        editable: true,
        ...(key === 'approved' ? { parse: (text) => text === 'true' } : {}),
      })),
      columnEditors: { tags: { type: 'multiselect', values: ['Idea', 'Design'] }, approved: { type: 'checkbox' } },
      choiceEditor: {
        renderOption: (option, doc) => {
          const span = doc.createElement('span');
          span.textContent = option.value;
          span.dataset.columnKey = option.columnKey;
          return span;
        },
      },
    });
  });
  const viewport = page.getByRole('grid');
  await viewport.press('Control+Home');
  await viewport.press('Enter');
  const panel = page.locator('[data-grid-choices]');
  await expect(panel).toBeVisible();
  await expect(panel.locator('span[data-column-key="tags"]').first()).toBeVisible();
  await expect(panel.getByRole('checkbox', { name: 'Idea' })).toBeChecked();
  await panel.getByRole('checkbox', { name: 'Design' }).check();
  await page.keyboard.press('Enter');
  expect(await page.evaluate(() => window.source.getValue(0, 'tags'))).toBe('Idea, Design');
  await viewport.press('ArrowRight');
  await viewport.press('Enter');
  expect(await page.evaluate(() => window.source.getValue(0, 'approved'))).toBe(true);
  await expect(page.getByLabel('Edit row 1, approved', { exact: true })).toHaveCount(0);
  await viewport.press('Enter');
  expect(await page.evaluate(() => window.source.getValue(0, 'approved'))).toBe(false);
  await expect(viewport).toHaveCSS('outline-style', 'none');
  await viewport.press('ArrowRight');
  await viewport.press('Enter');
  await expect(page.getByLabel('Edit row 1, text', { exact: true })).toHaveCSS('border-top-width', '1px');
});

test('whole-column selection opens column actions from a data cell', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const { createGrid } = await import('/canvas/index.js');
    const { LocalDataSource } = await import('/core/index.js');
    window.grid = createGrid({
      container: document.querySelector('#grid'),
      dataSource: new LocalDataSource(
        [
          { id: 1, a: 'a', b: 'b' },
          { id: 2, a: 'c', b: 'd' },
        ],
        (row) => row.id,
      ),
      columns: ['a', 'b'].map((key) => ({ key, title: key })),
      allowColumnChanges: true,
      accessibility: 'viewport',
    });
  });
  const viewport = page.getByRole('grid');
  await viewport.press('Control+Home');
  await viewport.press('Control+Space');
  await viewport.press('Shift+F10');
  const menu = page.getByRole('menu', { name: 'Column actions' });
  await expect(menu).toBeVisible();
  await menu.getByRole('menuitem', { name: 'Delete column', exact: true }).click();
  await expect(page.getByRole('columnheader', { name: 'a', exact: true })).toHaveCount(0);
  await expect(page.getByRole('columnheader', { name: 'b', exact: true })).toBeVisible();
});

test('context actions filter by typing, preserve keyboard navigation and keep focus inside separated rows', async ({
  page,
}) => {
  await setup(page);
  expect(await page.evaluate(() => window.grid.copySelection())).toBe('');
  const viewport = page.getByLabel(/^Data grid viewport/);
  await viewport.click({ button: 'right', position: { x: 24, y: 20 } });
  const menu = page.getByRole('menu', { name: 'Cell actions' });
  await expect(menu).toBeVisible();
  await page.keyboard.type('freeze');
  const filter = menu.getByRole('searchbox', { name: 'Filter actions' });
  await expect(filter).toHaveValue('freeze');
  await expect(menu.getByRole('menuitem', { name: 'Copy', exact: true })).toBeHidden();
  await expect(menu.getByRole('menuitem', { name: 'Freeze rows through this row', exact: true })).toBeVisible();
  await filter.press('ArrowDown');
  await expect(menu.getByRole('menuitem', { name: 'Freeze rows through this row', exact: true })).toBeFocused();
  await expect(menu.getByRole('menuitem', { name: 'Freeze rows through this row', exact: true })).toHaveCSS(
    'outline-style',
    'none',
  );
  await page.keyboard.press('Escape');
  await expect(menu.getByRole('menuitem', { name: 'Copy', exact: true })).toBeVisible();
  await page.keyboard.type('no such action');
  await expect(menu.getByRole('status')).toHaveText('No matching actions');
  await filter.fill('resize');
  await expect(menu.getByRole('menuitem', { name: 'Resize row…' })).toBeVisible();
  await page.keyboard.press('Escape');
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await viewport.click({ button: 'right', position: { x: 24, y: 20 } });
  await viewport.click({ button: 'right', position: { x: 390, y: 20 } });
  await expect(menu).toHaveCount(1);
  await page.mouse.click(1000, 700);
  await expect(menu).toHaveCount(0);
});

test('copy keeps rich text and colors across plain columns, with one atomic undo/redo', async ({ page }) => {
  await setup(page);
  const viewport = page.getByLabel(/^Data grid viewport/);
  await page.evaluate(() =>
    window.grid.format([{ scope: 'cell', rowIndex: 0, columnIndex: 0 }], {
      background: '#ffeecc',
      textColor: '#123456',
    }),
  );
  await viewport.press('Control+Home');
  const copied = await viewport.evaluate((el) => {
    const data = new DataTransfer();
    el.dispatchEvent(new ClipboardEvent('copy', { bubbles: true, cancelable: true, clipboardData: data }));
    window.copied = data;
    return { text: data.getData('text/plain'), html: data.getData('text/html') };
  });
  expect(copied.text).toBe('Bold and italic');
  expect(copied.html).toContain('<strong>');
  expect(copied.text).not.toContain('**');
  await viewport.press('ArrowRight');
  await viewport.press('ArrowRight');
  await viewport.evaluate((el) =>
    el.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: window.copied })),
  );
  await expect(page.getByRole('gridcell', { name: 'plain: Bold and italic', exact: true })).toBeAttached();
  expect(await page.evaluate(() => window.grid.getFormat(0, 2))).toEqual({
    background: '#ffeecc',
    textColor: '#123456',
    contentFormat: 'html',
  });
  await viewport.press('F2');
  const editor = page.getByRole('textbox', { name: 'Edit row 1, plain', exact: true });
  await expect(editor.locator('strong')).toHaveText('Bold');
  await expect(editor.locator('em')).toHaveText('italic');
  expect(await editor.textContent()).not.toContain('<');
  await editor.press('Escape');
  await page.evaluate(() => window.grid.undo());
  expect(await page.evaluate(() => window.source.getValue(0, 'plain'))).toBe('original');
  expect(await page.evaluate(() => window.grid.getFormat(0, 2))).toEqual({});
  await page.evaluate(() => window.grid.redo());
  await expect(page.getByRole('gridcell', { name: 'plain: Bold and italic', exact: true })).toBeAttached();
  await viewport.press('ArrowDown');
  await viewport.evaluate((el) => {
    const data = new DataTransfer();
    data.setData('text/html', window.copied.getData('text/html'));
    el.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }));
  });
  await expect(page.getByRole('gridcell', { name: 'plain: Bold and italic', exact: true })).toHaveCount(2);
});

test('context menu clipboard preserves styles and visual editors save partial marks without exposing source', async ({
  page,
  context,
  browserName,
}) => {
  test.skip(
    browserName !== 'chromium',
    'Playwright clipboard permission grants are Chromium-only; synthetic clipboard tests run on all engines.',
  );
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await setup(page);
  const viewport = page.getByLabel(/^Data grid viewport/);
  await viewport.click({ button: 'right', position: { x: 24, y: 20 } });
  await page.getByRole('menuitem', { name: 'Copy', exact: true }).click();
  await expect.poll(() => page.evaluate(async () => navigator.clipboard.readText())).toBe('Bold and italic');
  await viewport.click({ button: 'right', position: { x: 390, y: 20 } });
  await page.getByRole('menuitem', { name: 'Paste', exact: true }).click();
  await expect(page.getByRole('gridcell', { name: 'plain: Bold and italic', exact: true })).toBeAttached();
  await viewport.press('F2');
  const editor = page.getByRole('textbox', { name: 'Edit row 1, plain', exact: true });
  await expect(editor.locator('strong')).toHaveText('Bold');
  await editor.locator('strong span').evaluate((el) => {
    el.textContent = 'Modified';
    el.closest('[contenteditable]').dispatchEvent(new InputEvent('input', { bubbles: true }));
  });
  await editor.press('Enter');
  await expect(page.getByRole('gridcell', { name: 'plain: Modified and italic', exact: true })).toBeAttached();
  expect(await page.evaluate(() => window.source.getValue(0, 'plain'))).toContain('<strong>');
  await viewport.press('F2');
  await expect(editor.locator('strong')).toHaveText('Modified');
  await expect(editor.locator('em')).toHaveText('italic');
  await editor.press('Escape');
});

test('multi-cell selection keeps one uniform tint without an inner active border', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const { createGrid } = await import('/canvas/index.js');
    const { LocalDataSource } = await import('/core/index.js');
    window.grid = createGrid({
      container: document.querySelector('#grid'),
      dataSource: new LocalDataSource(
        [
          { id: 1, text: '' },
          { id: 2, text: '' },
          { id: 3, text: '' },
        ],
        (row) => row.id,
      ),
      columns: [{ key: 'text', title: 'Text' }],
      indexColumn: false,
      rowHeight: 40,
      headerHeight: 30,
      columnWidth: 120,
      theme: { background: '#ffffff', selectionColor: '#ff6600' },
    });
  });
  const viewport = page.getByRole('grid');
  await viewport.press('Control+Home');
  await viewport.press('Shift+ArrowDown');
  await viewport.press('Shift+ArrowDown');
  expect(
    await page.evaluate(() => {
      const canvas = document.querySelector('#grid canvas');
      const ctx = canvas.getContext('2d');
      const scale = canvas.width / canvas.clientWidth;
      const pixel = (y) => [...ctx.getImageData(Math.round(60 * scale), Math.round(y * scale), 1, 1).data];
      return pixel(112).join(',') === pixel(115).join(',');
    }),
  ).toBe(true);
});

test('popup surfaces preserve light/dark themes and keyboard opening', async ({ page }) => {
  await setup(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const dark of [false, true]) {
    await page.evaluate(
      (dark) =>
        window.grid.setTheme(
          dark
            ? {
                background: '#171915',
                textColor: '#eeefe5',
                headerBackground: '#292d25',
                gridLineColor: '#393d33',
                selectionColor: '#ff885f',
                iconColor: '#aaaea1',
              }
            : {
                background: '#f4f3ed',
                textColor: '#23241f',
                headerBackground: '#eaeae1',
                gridLineColor: '#d5d6cb',
                selectionColor: '#d44b21',
                iconColor: '#62645a',
              },
        ),
      dark,
    );
    const grid = page.getByRole('grid');
    await grid.press('Control+Home');
    await grid.press('Shift+F10');
    await expect(page.getByRole('menu')).toBeVisible();
    await page.screenshot({ path: `test-results/popup-${dark ? 'dark' : 'light'}.png` });
    await page.keyboard.press('Escape');
  }
});

test('long tooltips stay inside a narrow viewport', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 480 });
  await setup(page);
  await page.evaluate(() => {
    const root = document.querySelector('[data-grid-viewport]').parentElement;
    const button = document.createElement('button');
    button.textContent = 'Help';
    button.title = 'Long tooltip '.repeat(15);
    button.style.cssText = 'position:fixed;right:8px;bottom:8px';
    root.append(button);
  });
  await page.getByRole('button', { name: 'Help', exact: true }).hover();
  const tip = page.getByRole('tooltip');
  await expect(tip).toBeVisible();
  const box = await tip.boundingBox();
  expect(box.x).toBeGreaterThanOrEqual(8);
  expect(box.y).toBeGreaterThanOrEqual(8);
  expect(box.x + box.width).toBeLessThanOrEqual(312);
  expect(box.y + box.height).toBeLessThanOrEqual(472);
});
