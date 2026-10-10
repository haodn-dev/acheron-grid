import { test, expect } from '@playwright/test';

test('rich display bounds its cache, bypasses large values and clears cached conversions', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { createRichDisplay, createNumberDisplay } = await import('/canvas/internal/display.js');
    let calls = 0;
    const display = createRichDisplay({
      options: {
        richTextColumns: { note: 'markdown' },
        markdownToHtml: (value) => {
          calls++;
          return `<b>${value}</b>`;
        },
      },
      doc: document,
      t: (key) => key,
      numberText: createNumberDisplay({}),
    });
    const first = display.richText('first', 'note');
    const cached = display.richText('first', 'note') === first;
    const cachedCalls = calls;
    display.clearDisplayCache();
    display.richText('first', 'note');
    const clearedCalls = calls;
    for (let i = 0; i < 256; i++) display.richText(String(i), 'note');
    const before = calls;
    display.richText('first', 'note');
    const evicted = calls === before + 1;
    const large = 'a'.repeat(4097);
    const largeBefore = calls;
    display.richText(large, 'note');
    display.richText(large, 'note');
    const uncached = calls === largeBefore + 2;
    const oversizeBefore = calls;
    const oversize = display.richText('a'.repeat(100001), 'note');
    return {
      cached,
      cachedCalls,
      clearedCalls,
      evicted,
      uncached,
      oversize: oversize.unavailable,
      bypassed:
        calls === oversizeBefore &&
        display.richText('x', 'note', 'plain') === undefined &&
        display.richText(1, 'note') === undefined,
      numeric: display.displayedText(12.34, 'note', 'plain', 'integer'),
    };
  });
  expect(result).toEqual({
    cached: true,
    cachedCalls: 1,
    clearedCalls: 2,
    evicted: true,
    uncached: true,
    oversize: true,
    bypassed: true,
    numeric: '12',
  });
});

test('rich display rejects unsupported configuration and contains adapter failures', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { createRichDisplay, createNumberDisplay } = await import('/canvas/internal/display.js');
    const create = (options) =>
      createRichDisplay({
        options,
        doc: document,
        t: (key) => `localized:${key}`,
        numberText: createNumberDisplay({}),
      });
    const errors = [{ richTextColumns: { note: 'unknown' } }, { richTextColumns: { note: 'markdown' } }].map(
      (options) => {
        try {
          create(options);
          return false;
        } catch (error) {
          return error instanceof TypeError;
        }
      },
    );
    const display = create({
      richTextColumns: { note: 'markdown' },
      markdownToHtml: () => {
        throw new Error('adapter failed');
      },
    });
    const rich = display.richText('hello', 'note');
    return { errors, unavailable: rich.unavailable, text: rich.text, fallback: display.displayedText(null, 'unknown') };
  });
  expect(result).toEqual({
    errors: [true, true],
    unavailable: true,
    text: 'localized:Rich text unavailable',
    fallback: '',
  });
});
