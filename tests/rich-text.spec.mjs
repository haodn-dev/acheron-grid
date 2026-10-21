import { test, expect } from '@playwright/test';

test('rich parsing preserves supported text and bounds hostile nesting and source size', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { readHtml, richTextHtml, richTextSource } = await import('/canvas/rich-text.js');
    const { markdownToHtml } = await import('/markdown/index.js');
    const list = readHtml('<ol start="3">\n<li>One</li>\n<li><b>Two</b></li>\n</ol><img alt="Photo">', document);
    const edited = readHtml(
      '<span style="font-weight:700;font-style:italic;text-decoration-line:underline">  A  B </span><pre>x\n y</pre>',
      document,
      true,
    );
    const rich = {
      text: '<unsafe>\nnext',
      runs: [{ text: '<unsafe>\nnext', bold: true, href: 'javascript:alert(1)' }],
    };
    const safe = richTextHtml(rich, document);
    const markdown = richTextSource(
      {
        text: 'A*B and `code`',
        runs: [
          { text: 'A*', bold: true },
          { text: 'B', bold: true },
          { text: ' and ' },
          { text: '`code`', code: true },
        ],
      },
      'markdown',
      document,
    );
    const errors = [];
    for (const parse of [(value) => readHtml(value, document), markdownToHtml]) {
      try {
        parse('x'.repeat(100001));
      } catch (error) {
        errors.push(error instanceof RangeError);
      }
    }
    return {
      list: list.text,
      edited,
      safe,
      safeRoundTrip: readHtml(safe, document).text,
      markdownRoundTrip: readHtml(markdownToHtml(markdown), document).text,
      exactLimit: readHtml('x'.repeat(100000), document).text.length,
      errors,
      deep: readHtml('<span>'.repeat(130) + 'hidden' + '</span>'.repeat(130) + '<b>Visible</b>', document).text,
    };
  });
  expect(result.list).toBe('3. One\n4. Two\nPhoto');
  expect(result.edited.runs[0]).toMatchObject({ text: '  A  B ', bold: true, italic: true, underline: true });
  expect(result.edited.text).toContain('x\n y');
  expect(result.safe).toContain('&lt;unsafe&gt;');
  expect(result.safe).not.toContain('href');
  expect(result.safeRoundTrip).toBe('<unsafe>\nnext');
  expect(result.markdownRoundTrip).toBe('A*B and `code`');
  expect(result.exactLimit).toBe(100000);
  expect(result.errors).toEqual([true, true]);
  expect(result.deep).toBe('Visible');
});

test('rich layout keeps Unicode, mixed marks and bounded wrapping consistent', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { layoutRichText } = await import('/canvas/rich-text.js');
    const context = document.createElement('canvas').getContext('2d');
    const runs = [
      { text: 'A'.repeat(300) },
      { text: ' Việt 😀', bold: true, italic: true },
      { text: ' code', code: true },
    ];
    const rich = { text: runs.map((run) => run.text).join(''), runs };
    const unwrapped = layoutRichText(context, rich, '400 16px monospace', Infinity, false);
    const wrapped = layoutRichText(context, rich, '400 16px monospace', 80, true, 3);
    const newline = layoutRichText(
      context,
      { text: 'a\nb\nc', runs: [{ text: 'a\nb\nc' }] },
      '16px monospace',
      80,
      false,
      2,
    );
    return {
      text: rich.text,
      unwrapped,
      wrapped,
      newline,
      empty: layoutRichText(context, { text: '', runs: [] }, '16px monospace', 80, true),
    };
  });
  expect(result.unwrapped.pieces.map((piece) => piece.text).join('')).toBe(result.text);
  expect(result.unwrapped.lines).toBe(1);
  expect(result.unwrapped.pieces.some((piece) => /italic.*700/.test(piece.font))).toBe(true);
  expect(result.unwrapped.pieces.at(-1).font).toContain('monospace');
  expect(result.unwrapped.width).toBeCloseTo(
    result.unwrapped.pieces.reduce((sum, piece) => sum + piece.width, 0),
    3,
  );
  expect(result.wrapped.lines).toBe(3);
  expect(result.wrapped.pieces.every((piece) => piece.line < 3 && piece.x + piece.width <= 80)).toBe(true);
  expect(result.newline.pieces.map((piece) => piece.text).join('')).toBe('ab');
  expect(result.newline.lines).toBe(2);
  expect(result.empty).toMatchObject({ pieces: [], lines: 1, width: 0 });
  expect(result.empty.lineHeight).toBeGreaterThan(0);
});

test('rich text paints partial styles, wraps, searches visible text and visually edits with history', async ({
  page,
}) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const { createGrid } = await import('/canvas/index.js');
    const { LocalDataSource } = await import('/core/index.js');
    const { markdownToHtml } = await import('/markdown/index.js');
    window.drawn = [];
    const original = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function (text, ...args) {
      window.drawn.push({ text, font: this.font });
      return original.call(this, text, ...args);
    };
    window.raw = '**Bold** and *italic* with [reference](https://example.com/page)\n\nNext paragraph';
    window.source = new LocalDataSource(
      [{ id: 1, notes: window.raw, description: '<b>Strong</b> <i>slanted</i> <u>underlined</u><br>Next &amp; last' }],
      (row) => row.id,
    );
    window.grid = createGrid({
      container: document.querySelector('#grid'),
      dataSource: window.source,
      columns: [
        { key: 'notes', title: 'Notes', editable: true },
        { key: 'description', title: 'Description', editable: true },
      ],
      richTextColumns: { notes: 'markdown', description: 'html' },
      markdownToHtml,
      wrapText: true,
      autoRowHeight: true,
      multilineEditor: true,
      accessibility: 'viewport',
      columnWidth: 200,
    });
  });
  await expect(page.getByRole('gridcell', { name: /Notes: Bold and italic with reference/ })).toBeAttached();
  await expect(page.getByRole('gridcell', { name: /Description: Strong slanted underlined/ })).toHaveText(
    'Description: Strong slanted underlined\nNext & last',
  );
  expect(await page.evaluate(() => window.drawn.some((run) => run.text === 'Bold' && /bold|700/.test(run.font)))).toBe(
    true,
  );
  expect(
    await page.evaluate(() => window.drawn.some((run) => run.text === 'italic' && run.font.includes('italic'))),
  ).toBe(true);
  const row = page.getByRole('button', { name: 'Select row 1', exact: true });
  const originalHeight = await row.evaluate((el) => el.offsetHeight);
  expect(originalHeight).toBeGreaterThan(24);
  const viewport = page.getByLabel(/^Data grid viewport/);
  await viewport.press('Control+Home');
  await viewport.press('F2');
  const editor = page.getByRole('textbox', { name: 'Edit row 1, Notes', exact: true });
  await expect(editor).toHaveAttribute('contenteditable', 'true');
  await expect(editor.locator('strong')).toHaveText('Bold');
  expect(await editor.textContent()).not.toContain('**');
  await editor.fill('Changed and part');
  await editor.press('Enter');
  expect(await page.evaluate(() => window.source.getValue(0, 'notes'))).toBe('**Changed and part**');
  await expect(page.getByRole('gridcell', { name: 'Notes: Changed and part', exact: true })).toBeAttached();
  expect(await page.evaluate(() => window.grid.copySelection())).toBe('Changed and part');
  await page.evaluate(() => window.grid.undo());
  expect(await page.evaluate(() => window.source.getValue(0, 'notes') === window.raw)).toBe(true);
  await expect(page.getByRole('gridcell', { name: /Notes: Bold and italic with reference/ })).toBeAttached();
  await expect.poll(() => row.evaluate((el) => el.offsetHeight)).toBe(originalHeight);
  await viewport.press('Alt+Enter');
  await expect(
    page.getByRole('dialog', { name: 'Cell links' }).getByRole('link', { name: 'reference' }),
  ).toHaveAttribute('href', 'https://example.com/page');
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.evaluate(() => window.grid.openSearch());
  const search = page.getByRole('searchbox', { name: 'Find in grid' });
  await search.fill('Bold and italic');
  await expect(page.getByRole('search').getByRole('status')).toHaveText('1 of 1');
  await search.fill('**Bold**');
  await expect(page.getByRole('search').getByRole('status')).toHaveText('No matches');
  await page.getByRole('button', { name: 'Close search' }).click();
  await page.evaluate(() => {
    window.grid.autoFitColumn(0);
    window.grid.setTheme({ font: '400 16px system-ui' });
  });
  await expect(page.getByRole('gridcell', { name: /Notes: Bold/ })).toBeAttached();
});

test('HTML and Markdown remain inert, unsafe links are plain text and optional adapter is required', async ({
  page,
}) => {
  const external = [];
  page.on('request', (request) => {
    if (request.url().includes('attacker.invalid')) external.push(request.url());
  });
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { readHtml } = await import('/canvas/rich-text.js');
    const { markdownToHtml } = await import('/markdown/index.js');
    const { createGrid } = await import('/canvas/index.js');
    const { LocalDataSource } = await import('/core/index.js');
    const payload =
      '<script>window.compromised=1</script><style>body{display:none}</style><img src="https://attacker.invalid/a" onerror="window.compromised=1"><iframe src="https://attacker.invalid/b"></iframe><svg onload="window.compromised=1"><text>hidden</text></svg><b onclick="window.compromised=1">Visible</b> <a href="jav&#97;script:alert(1)">unsafe</a> <a href="https://user:password@example.com">credentials</a> <a href="https://example.com/path.">safe</a>';
    const html = readHtml(payload, document);
    const md = readHtml(
      markdownToHtml(
        '**Strong** *italic* __bold__ <u>plain</u> [bad](javascript:alert%281%29)\n\n<script>window.compromised=1</script>',
      ),
      document,
    );
    let missing;
    try {
      createGrid({
        container: document.querySelector('#grid'),
        columns: [{ key: 'x', title: 'X' }],
        dataSource: new LocalDataSource([], (row) => row.id),
        richTextColumns: { x: 'markdown' },
      });
    } catch (error) {
      missing = error.message;
    }
    return {
      html,
      md,
      missing,
      compromised: window.compromised ?? false,
      mounted: document.querySelectorAll('img,iframe,svg,style').length,
    };
  });
  expect(result.html.text).toBe('Visible unsafe credentials safe');
  expect(result.html.runs.filter((run) => run.href).map((run) => run.href)).toEqual(['https://example.com/path.']);
  expect(result.md.text).toBe('Strong italic bold plain bad');
  expect(result.md.runs.some((run) => run.underline || run.href)).toBe(false);
  expect(result.compromised).toBe(false);
  expect(result.mounted).toBe(0);
  expect(external).toEqual([]);
  expect(result.missing).toContain('adapter');
});
