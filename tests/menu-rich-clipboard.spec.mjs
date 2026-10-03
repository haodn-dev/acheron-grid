import { test, expect } from '@playwright/test';

async function setup(page) {
  await page.goto('/');
  await page.evaluate(async () => {
    const { createGrid } = await import('/canvas/index.js'); const { LocalDataSource } = await import('/core/index.js'); const { markdownToHtml } = await import('/markdown/index.js');
    window.source = new LocalDataSource([{ id: 1, md: '**Bold** and *italic*', html: '<strong>HTML</strong> <u>underline</u>', plain: 'original' }, { id: 2, md: 'second', html: 'other', plain: 'tail' }], row => row.id);
    window.grid = createGrid({ container: document.querySelector('#grid'), columns: ['md','html','plain'].map(key => ({ key, title: key, editable: true })), dataSource: window.source, richTextColumns: { md: 'markdown', html: 'html' }, markdownToHtml, accessibility: 'viewport', multilineEditor: true, editorOptions: { pinned: true }, wrapText: true, rowHeight: 48, columnWidth: 180 });
  });
}

test('context actions filter by typing, preserve keyboard navigation and keep focus inside separated rows', async ({ page }) => {
  await setup(page);
  expect(await page.evaluate(() => window.grid.copySelection())).toBe('');
  const viewport = page.getByLabel(/^Data grid viewport/); await viewport.click({ button: 'right', position: { x: 24, y: 20 } });
  const menu = page.getByRole('menu', { name: 'Cell actions' }); await expect(menu).toBeVisible();
  await page.keyboard.type('freeze');
  const filter = menu.getByRole('searchbox', { name: 'Filter actions' }); await expect(filter).toHaveValue('freeze');
  await expect(menu.getByRole('menuitem', { name: 'Copy', exact: true })).toBeHidden();
  await expect(menu.getByRole('menuitem', { name: 'Freeze rows through this row', exact: true })).toBeVisible();
  await filter.press('ArrowDown'); await expect(menu.getByRole('menuitem', { name: 'Freeze rows through this row', exact: true })).toBeFocused();
  await expect(menu.getByRole('menuitem', { name: 'Freeze rows through this row', exact: true })).toHaveCSS('outline-style', 'none');
  await page.keyboard.press('Escape'); await expect(menu.getByRole('menuitem', { name: 'Copy', exact: true })).toBeVisible();
  await page.keyboard.type('no such action'); await expect(menu.getByRole('status')).toHaveText('No matching actions');
  await filter.fill('resize'); await expect(menu.getByRole('menuitem', { name: 'Resize row…' })).toBeVisible();
  await page.keyboard.press('Escape'); await page.keyboard.press('Escape'); await expect(menu).toHaveCount(0);
  await viewport.click({ button: 'right', position: { x: 24, y: 20 } }); await viewport.click({ button: 'right', position: { x: 390, y: 20 } }); await expect(menu).toHaveCount(1);
  await page.mouse.click(1000, 700); await expect(menu).toHaveCount(0);
});

test('copy keeps rich text and colors across plain columns, with one atomic undo/redo', async ({ page }) => {
  await setup(page); const viewport = page.getByLabel(/^Data grid viewport/);
  await page.evaluate(() => window.grid.format([{ scope: 'cell', rowIndex: 0, columnIndex: 0 }], { background: '#ffeecc', textColor: '#123456' }));
  await viewport.press('Control+Home');
  const copied = await viewport.evaluate(el => { const data = new DataTransfer(); el.dispatchEvent(new ClipboardEvent('copy', { bubbles: true, cancelable: true, clipboardData: data })); window.copied = data; return { text: data.getData('text/plain'), html: data.getData('text/html') }; });
  expect(copied.text).toBe('Bold and italic'); expect(copied.html).toContain('<strong>'); expect(copied.text).not.toContain('**');
  await viewport.press('ArrowRight'); await viewport.press('ArrowRight');
  await viewport.evaluate(el => el.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: window.copied })));
  await expect(page.getByRole('gridcell', { name: 'plain: Bold and italic', exact: true })).toBeAttached();
  expect(await page.evaluate(() => window.grid.getFormat(0, 2))).toEqual({ background: '#ffeecc', textColor: '#123456', contentFormat: 'html' });
  await viewport.press('F2'); const editor = page.getByRole('textbox', { name: 'Edit row 1, plain', exact: true });
  await expect(editor.locator('strong')).toHaveText('Bold'); await expect(editor.locator('em')).toHaveText('italic');
  expect(await editor.textContent()).not.toContain('<'); await editor.press('Escape');
  await page.evaluate(() => window.grid.undo()); expect(await page.evaluate(() => window.source.getValue(0, 'plain'))).toBe('original'); expect(await page.evaluate(() => window.grid.getFormat(0, 2))).toEqual({});
  await page.evaluate(() => window.grid.redo()); await expect(page.getByRole('gridcell', { name: 'plain: Bold and italic', exact: true })).toBeAttached();
  await viewport.press('ArrowDown');
  await viewport.evaluate(el => { const data = new DataTransfer(); data.setData('text/html', window.copied.getData('text/html')); el.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data })); });
  await expect(page.getByRole('gridcell', { name: 'plain: Bold and italic', exact: true })).toHaveCount(2);
});

test('context menu clipboard preserves styles and visual editors save partial marks without exposing source', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']); await setup(page);
  const viewport = page.getByLabel(/^Data grid viewport/);
  await viewport.click({ button: 'right', position: { x: 24, y: 20 } }); await page.getByRole('menuitem', { name: 'Copy', exact: true }).click();
  await expect.poll(() => page.evaluate(async () => navigator.clipboard.readText())).toBe('Bold and italic');
  await viewport.click({ button: 'right', position: { x: 390, y: 20 } }); await page.getByRole('menuitem', { name: 'Paste', exact: true }).click();
  await expect(page.getByRole('gridcell', { name: 'plain: Bold and italic', exact: true })).toBeAttached();
  await viewport.press('F2'); const editor = page.getByRole('textbox', { name: 'Edit row 1, plain', exact: true }); await expect(editor.locator('strong')).toHaveText('Bold');
  await editor.locator('strong span').evaluate(el => { el.textContent = 'Modified'; el.closest('[contenteditable]').dispatchEvent(new InputEvent('input', { bubbles: true })); });
  await editor.press('Enter'); await expect(page.getByRole('gridcell', { name: 'plain: Modified and italic', exact: true })).toBeAttached();
  expect(await page.evaluate(() => window.source.getValue(0, 'plain'))).toContain('<strong>');
  await viewport.press('F2'); await expect(editor.locator('strong')).toHaveText('Modified'); await expect(editor.locator('em')).toHaveText('italic'); await editor.press('Escape');
});
