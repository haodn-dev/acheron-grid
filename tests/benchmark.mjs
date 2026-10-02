import { test, expect } from '@playwright/test';

test('headless Canvas callback cost: one million rows and one thousand columns', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { createGrid } = await import('/index.js');
    let reads = 0;
    const samples = [];
    const values = new Map();
    const request = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = callback => request(time => {
      const before = reads;
      const start = performance.now();
      callback(time);
      if (reads > before) samples.push({ ms: performance.now() - start, reads: reads - before });
    });
    const next = () => new Promise(resolve => request(() => request(resolve)));
    const grid = createGrid({ container: document.querySelector('#grid'),
      columns: Array.from({ length: 1000 }, (_, i) => ({ key: `c${i}`, title: `Column ${i}` })),
      dataSource: { getRowCount: () => 1_000_000, getRowId: i => i,
        getValue: (row, key) => { reads++; return values.get(`${row}:${key}`) ?? `${row}:${key}`; },
        setValue: (row, key, value) => values.set(`${row}:${key}`, value) } });
    grid.setRowHeight(500_000, 64);
    grid.setColumnWidth(50, 240);
    await next();
    const viewport = document.querySelector('[tabindex]');
    samples.length = 0;
    for (let i = 0; i < 60; i++) {
      viewport.scrollTop = 16_000_000 + i * 32;
      viewport.scrollLeft = 8000;
      grid.render();
      await next();
    }
    const scroll = samples.splice(0);
    viewport.scrollTop = 0;
    viewport.scrollLeft = 0;
    grid.render();
    await next();
    samples.length = 0;
    for (let i = 0; i < 60; i++) {
      grid.updateCells([{ rowIndex: 0, columnKey: 'c0', value: `Changed ${i}` }]);
      await next();
    }
    const partial = samples.splice(0);
    const summarize = list => {
      const sorted = list.map(sample => sample.ms).sort((a, b) => a - b);
      return { samples: list.length, medianMs: sorted[Math.floor(sorted.length / 2)],
        p95Ms: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * .95))],
        maxCellReads: Math.max(...list.map(sample => sample.reads)) };
    };
    grid.destroy();
    window.requestAnimationFrame = request;
    return { userAgent: navigator.userAgent, viewport: '640x360 CSS px', devicePixelRatio,
      rows: 1_000_000, columns: 1000, scroll: summarize(scroll), partial: summarize(partial) };
  });
  expect(result.scroll.samples).toBeGreaterThanOrEqual(60);
  expect(result.scroll.maxCellReads).toBeLessThan(100);
  expect(result.partial.samples).toBe(60);
  expect(result.partial.maxCellReads).toBe(1);
  console.log(JSON.stringify(result));
});
