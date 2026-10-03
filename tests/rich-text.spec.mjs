import { test, expect } from '@playwright/test';

test('rich text paints partial styles, wraps, searches visible text and preserves source/history', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const { createGrid } = await import('/canvas/index.js');
    const { LocalDataSource } = await import('/core/index.js');
    const { markdownToHtml } = await import('/markdown/index.js');
    window.drawn = [];
    const original = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function(text, ...args) { window.drawn.push({ text, font: this.font }); return original.call(this, text, ...args); };
    window.raw = '**Bold** and *italic* with [reference](https://example.com/page)\n\nNext paragraph';
    window.source = new LocalDataSource([{ id: 1, notes: window.raw, description: '<b>Strong</b> <i>slanted</i> <u>underlined</u><br>Next &amp; last' }], row => row.id);
    window.grid = createGrid({ container: document.querySelector('#grid'), dataSource: window.source,
      columns: [{ key: 'notes', title: 'Notes', editable: true }, { key: 'description', title: 'Description', editable: true }],
      richTextColumns: { notes: 'markdown', description: 'html' }, markdownToHtml,
      wrapText: true, autoRowHeight: true, multilineEditor: true, accessibility: 'viewport', columnWidth: 200 });
  });
  await expect(page.getByRole('gridcell', { name: /Notes: Bold and italic with reference/ })).toBeAttached();
  await expect(page.getByRole('gridcell', { name: /Description: Strong slanted underlined/ })).toHaveText('Description: Strong slanted underlined\nNext & last');
  expect(await page.evaluate(() => window.drawn.some(run => run.text === 'Bold' && /bold|700/.test(run.font)))).toBe(true);
  expect(await page.evaluate(() => window.drawn.some(run => run.text === 'italic' && run.font.includes('italic')))).toBe(true);
  expect(await page.getByRole('button', { name: 'Select row 1', exact: true }).evaluate(el => el.offsetHeight)).toBeGreaterThan(24);
  const viewport = page.getByLabel(/^Data grid viewport/);
  await viewport.press('Control+Home'); await viewport.press('F2');
  const editor = page.getByRole('textbox', { name: 'Edit row 1, Notes', exact: true });
  await expect(editor).toHaveValue(await page.evaluate(() => window.raw));
  await editor.fill('**Changed** and *part*'); await editor.press('Enter');
  expect(await page.evaluate(() => window.source.getValue(0, 'notes'))).toBe('**Changed** and *part*');
  await expect(page.getByRole('gridcell', { name: 'Notes: Changed and part', exact: true })).toBeAttached();
  expect(await page.evaluate(() => window.grid.copySelection())).toBe('**Changed** and *part*');
  await page.evaluate(() => window.grid.undo());
  expect(await page.evaluate(() => window.source.getValue(0, 'notes') === window.raw)).toBe(true);
  await viewport.press('Alt+Enter');
  await expect(page.getByRole('dialog', { name: 'Cell links' }).getByRole('link', { name: 'reference' })).toHaveAttribute('href', 'https://example.com/page');
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.evaluate(() => window.grid.openSearch());
  const search = page.getByRole('searchbox', { name: 'Find in grid' });
  await search.fill('Bold and italic'); await expect(page.getByRole('search').getByRole('status')).toHaveText('1 of 1');
  await search.fill('**Bold**'); await expect(page.getByRole('search').getByRole('status')).toHaveText('No matches');
  await page.getByRole('button', { name: 'Close search' }).click();
  await page.evaluate(() => { window.grid.autoFitColumn(0); window.grid.setTheme({ font: '400 16px system-ui' }); });
  await expect(page.getByRole('gridcell', { name: /Notes: Bold/ })).toBeAttached();
});

test('HTML and Markdown remain inert, unsafe links are plain text and optional adapter is required', async ({ page }) => {
  const external = []; page.on('request', request => { if (request.url().includes('attacker.invalid')) external.push(request.url()); });
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { readHtml } = await import('/canvas/rich-text.js');
    const { markdownToHtml } = await import('/markdown/index.js');
    const { createGrid } = await import('/canvas/index.js');
    const { LocalDataSource } = await import('/core/index.js');
    const payload = '<script>window.compromised=1</script><style>body{display:none}</style><img src="https://attacker.invalid/a" onerror="window.compromised=1"><iframe src="https://attacker.invalid/b"></iframe><svg onload="window.compromised=1"><text>hidden</text></svg><b onclick="window.compromised=1">Visible</b> <a href="jav&#97;script:alert(1)">unsafe</a> <a href="https://user:password@example.com">credentials</a> <a href="https://example.com/path.">safe</a>';
    const html = readHtml(payload, document);
    const md = readHtml(markdownToHtml('**Strong** *italic* __bold__ <u>plain</u> [bad](javascript:alert%281%29)\n\n<script>window.compromised=1</script>'), document);
    let missing;
    try { createGrid({ container: document.querySelector('#grid'), columns: [{ key: 'x', title: 'X' }], dataSource: new LocalDataSource([], row => row.id), richTextColumns: { x: 'markdown' } }); }
    catch (error) { missing = error.message; }
    return { html, md, missing, compromised: window.compromised ?? false, mounted: document.querySelectorAll('img,iframe,svg,style').length };
  });
  expect(result.html.text).toBe('Visible unsafe credentials safe');
  expect(result.html.runs.filter(run => run.href).map(run => run.href)).toEqual(['https://example.com/path.']);
  expect(result.md.text).toBe('Strong italic bold plain bad');
  expect(result.md.runs.some(run => run.underline || run.href)).toBe(false);
  expect(result.compromised).toBe(false); expect(result.mounted).toBe(0); expect(external).toEqual([]);
  expect(result.missing).toContain('adapter');
});
