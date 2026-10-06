import { test, expect } from './browser-fixtures.mjs';

async function setup(page, motion = true) {
  await page.goto('/');
  await page.evaluate(async (motion) => {
    const { createGrid } = await import('/canvas/index.js');
    const { LocalDataSource } = await import('/core/index.js');
    window.grid = createGrid({
      container: document.querySelector('#grid'),
      columns: [
        { key: 'a', title: 'A', editable: true },
        { key: 'b', title: 'B' },
      ],
      dataSource: new LocalDataSource(
        Array.from({ length: 100 }, (_, id) => ({ id, a: 'Alpha ' + id, b: 'Beta' })),
        (row) => row.id,
      ),
      motion,
    });
  }, motion);
  await page.getByRole('grid').click({ position: { x: 10, y: 10 } });
}

test('single-cell copy feedback is bounded, unobtrusive and persists across navigation and scroll until cancelled or changed', async ({
  page,
}) => {
  await setup(page);
  const feedback = page.locator('[data-grid-copy-feedback]');
  expect(await page.evaluate(() => window.grid.copySelection())).toBe('Alpha 0');
  await expect(feedback.locator(':scope > div')).toHaveCount(1);
  expect(await feedback.locator('rect').evaluate((el) => el.getAnimations()[0].effect.getTiming().iterations)).toBe(
    Infinity,
  );
  expect(
    await feedback.evaluate((el) => ({
      pointer: getComputedStyle(el).pointerEvents,
      hidden: el.getAttribute('aria-hidden'),
      width: el.firstElementChild.firstElementChild.style.width,
    })),
  ).toEqual({ pointer: 'none', hidden: 'true', width: '160px' });
  await page.getByRole('grid').press('ArrowDown');
  await expect(feedback.locator(':scope > div')).toHaveCount(1);
  expect(await feedback.evaluate((el) => el.firstElementChild.firstElementChild.style.top)).toBe('0px');
  await page.evaluate(() => window.grid.copySelectionBlocks());
  await expect(feedback.locator(':scope > div')).toHaveCount(1);
  await page.getByRole('grid').evaluate((el) => {
    el.scrollTop = 10;
  });
  await expect(feedback.locator(':scope > div')).toHaveCount(1);
  await expect.poll(() => feedback.evaluate((el) => el.firstElementChild.firstElementChild.style.top)).not.toBe('0px');
  await page.evaluate(() => {
    window.grid.copySelection();
    window.grid.updateCells([{ rowIndex: 1, columnKey: 'a', value: 'Changed' }]);
  });
  await expect(feedback.locator(':scope > div')).toHaveCount(0);
  await page.evaluate(() => window.grid.copySelection());
  await page.waitForTimeout(1900);
  await expect(feedback.locator(':scope > div')).toHaveCount(1);
  await page.getByRole('grid').press('Escape');
  await expect(feedback.locator(':scope > div')).toHaveCount(0);
  await page.evaluate(() => {
    window.grid.copySelection();
    window.grid.destroy();
  });
  await expect(feedback).toHaveCount(0);
});

test('copy event, frozen ranges and reduced motion retain feedback without animation or stale overlays', async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await setup(page);
  const feedback = page.locator('[data-grid-copy-feedback]');
  const text = await page.getByRole('grid').evaluate((el) => {
    const clipboardData = new DataTransfer();
    el.dispatchEvent(new ClipboardEvent('copy', { bubbles: true, cancelable: true, clipboardData }));
    return clipboardData.getData('text/plain');
  });
  expect(text).toBe('Alpha 0');
  await expect(feedback.locator(':scope > div')).toHaveCount(1);
  expect(await feedback.evaluate((el) => el.getAnimations({ subtree: true }).length)).toBe(0);
  await page.evaluate(() => {
    window.grid.setFrozen(1, 1);
    window.grid.selectAll();
    window.grid.copySelection();
  });
  await expect(feedback.locator(':scope > div')).toHaveCount(4);
  await page.getByRole('grid').press('Escape');
  await expect(feedback.locator(':scope > div')).toHaveCount(0);
  await page.evaluate(() => {
    window.grid.copySelection();
    window.grid.setTheme({ selectionColor: '#ff6600' });
  });
  await expect(feedback.locator(':scope > div')).toHaveCount(0);
});

test('motion disabled keeps a static copy marker and resizing removes stale geometry', async ({ page }) => {
  await setup(page, false);
  const feedback = page.locator('[data-grid-copy-feedback]');
  await page.evaluate(() => window.grid.copySelection());
  await expect(feedback.locator(':scope > div')).toHaveCount(1);
  expect(await feedback.evaluate((el) => el.getAnimations({ subtree: true }).length)).toBe(0);
  await page.locator('#grid').evaluate((el) => {
    el.style.width = '480px';
  });
  await expect(feedback.locator(':scope > div')).toHaveCount(0);
});
