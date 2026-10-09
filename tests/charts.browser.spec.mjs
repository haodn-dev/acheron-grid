import { test, expect } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test('smooth area renders in real Canvas and preserves gaps and drawing state', async ({ page }, testInfo) => {
  const source = await readFile(new URL('../packages/charts/dist/index.js', import.meta.url), 'utf8');
  await page.goto('/');
  const result = await page.evaluate(async (source) => {
    const { createChartRenderer } = await import(`data:text/javascript;base64,${btoa(source)}`);
    document.body.innerHTML = '<canvas width="600" height="240" aria-label="Smooth area with a gap"></canvas>';
    const canvas = document.querySelector('canvas');
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 600, 240);
    ctx.globalAlpha = 0.8;
    const renderer = createChartRenderer({
      trend: {
        kind: 'area',
        curve: 'smooth',
        color: '#2563eb',
        lineWidth: 3,
        markerRadius: 3,
        fillOpacity: 0.25,
      },
    });
    renderer(ctx, { columnKey: 'trend', value: [2, 8, 4, null, 6, 3, 7], x: 0, y: 0, width: 600, height: 240 });
    return {
      alpha: ctx.globalAlpha,
      fill: ctx.fillStyle,
      gap: Array.from(ctx.getImageData(300, 10, 1, 200).data).every((n) => n === 255),
      painted: Array.from(ctx.getImageData(90, 80, 1, 120).data).some((n) => n !== 255),
    };
  }, source);
  expect(result).toEqual({ alpha: 0.8, fill: '#ffffff', gap: true, painted: true });
  await page.screenshot({ path: testInfo.outputPath('smooth-area.png') });
});

for (const dpr of [1, 2]) {
  test(`all inline chart kinds clip and restore real Canvas state at DPR ${dpr}`, async ({ page }) => {
    const source = await readFile(new URL('../packages/charts/dist/index.js', import.meta.url), 'utf8');
    await page.goto('/');
    const results = await page.evaluate(
      async ({ source, dpr }) => {
        const { createChartRenderer } = await import(`data:text/javascript;base64,${btoa(source)}`);
        return ['line', 'area', 'column', 'bar'].map((kind) => {
          const canvas = document.createElement('canvas');
          canvas.width = 200 * dpr;
          canvas.height = 100 * dpr;
          const ctx = canvas.getContext('2d');
          ctx.scale(dpr, dpr);
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, 200, 100);
          ctx.fillStyle = '#123456';
          ctx.strokeStyle = '#654321';
          ctx.globalAlpha = 0.8;
          ctx.lineWidth = 7;
          ctx.setLineDash([4, 2]);
          const renderer = createChartRenderer({
            trend: {
              kind,
              curve: 'smooth',
              domain: [-10, 10],
              threshold: 0,
              showBaseline: true,
              highlight: ['min', 'max', 'last'],
              markerRadius: 20,
            },
          });
          renderer(ctx, {
            columnKey: 'trend',
            value: [-100, 10, null, -10, 100],
            x: 20,
            y: 10,
            width: 116,
            height: 52,
          });
          const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
          let outsideWhite = true,
            painted = false;
          for (let y = 0; y < canvas.height; y++)
            for (let x = 0; x < canvas.width; x++) {
              const offset = (y * canvas.width + x) * 4;
              const white = pixels[offset] === 255 && pixels[offset + 1] === 255 && pixels[offset + 2] === 255;
              if (x < 20 * dpr || x >= 136 * dpr || y < 10 * dpr || y >= 62 * dpr) outsideWhite &&= white;
              else painted ||= !white;
            }
          const restored =
            ctx.fillStyle === '#123456' &&
            ctx.strokeStyle === '#654321' &&
            ctx.globalAlpha === 0.8 &&
            ctx.lineWidth === 7;
          const dash = ctx.getLineDash(),
            matrix = ctx.getTransform();
          ctx.fillRect(170, 70, 10, 10);
          const after = ctx.getImageData(175 * dpr, 75 * dpr, 1, 1).data;
          return {
            kind,
            outsideWhite,
            painted,
            restored,
            dash,
            scale: [matrix.a, matrix.d],
            clipRestored: after[0] < 255,
          };
        });
      },
      { source, dpr },
    );
    expect(results).toEqual(
      ['line', 'area', 'column', 'bar'].map((kind) => ({
        kind,
        outsideWhite: true,
        painted: true,
        restored: true,
        dash: [4, 2],
        scale: [dpr, dpr],
        clipRestored: true,
      })),
    );
  });

  test(`charts use grid repaint, resize and destroy lifecycle at DPR ${dpr}`, async ({ browser }) => {
    const source = await readFile(new URL('../packages/charts/dist/index.js', import.meta.url), 'utf8');
    const context = await browser.newContext({ deviceScaleFactor: dpr });
    const page = await context.newPage();
    try {
      await page.goto('http://127.0.0.1:4179/');
      await page.evaluate(async (source) => {
        const { createChartRenderer } = await import(`data:text/javascript;base64,${btoa(source)}`);
        const { createGrid } = await import('/canvas/index.js');
        const { LocalDataSource } = await import('/core/index.js');
        const renderer = createChartRenderer({
          trend: { kind: 'area', curve: 'smooth', domain: [0, 10], threshold: 5, highlight: ['last'] },
        });
        window.chartCalls = [];
        window.chartSource = new LocalDataSource(
          [{ id: 'r1', trend: [2, 8, null, 4], summary: 'Peaked at 8; one gap' }],
          (row) => row.id,
        );
        window.chartGrid = createGrid({
          container: document.querySelector('#grid'),
          dataSource: window.chartSource,
          columns: [
            { key: 'trend', title: 'Trend' },
            { key: 'summary', title: 'Summary' },
          ],
          rowHeight: 64,
          renderCell: (ctx, cell) => {
            const handled = renderer(ctx, cell);
            if (handled) window.chartCalls.push({ value: cell.value, width: cell.width, height: cell.height });
            return handled;
          },
        });
      }, source);
      await expect.poll(() => page.evaluate(() => window.chartCalls.length)).toBeGreaterThan(0);
      expect(
        await page.evaluate(() => {
          const canvas = document.querySelector('#grid canvas');
          return canvas.width / canvas.getBoundingClientRect().width;
        }),
      ).toBeCloseTo(dpr);
      await page.evaluate(() => {
        window.chartCalls.length = 0;
        window.chartGrid.updateCells([{ rowIndex: 0, columnKey: 'trend', value: [9, 1] }]);
      });
      await expect
        .poll(() => page.evaluate(() => window.chartCalls.some((call) => JSON.stringify(call.value) === '[9,1]')))
        .toBe(true);
      await page.evaluate(() => {
        window.chartCalls.length = 0;
        window.chartGrid.setColumnWidth(0, 220);
        window.chartGrid.setRowHeight(0, 80);
      });
      await expect
        .poll(() => page.evaluate(() => window.chartCalls.some((call) => call.width === 220 && call.height === 80)))
        .toBe(true);
      expect(
        await page.evaluate(async () => {
          window.chartGrid.destroy();
          window.chartGrid.destroy();
          window.chartCalls.length = 0;
          window.chartSource.setValue(0, 'trend', [5, 5]);
          await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          return { calls: window.chartCalls.length, canvases: document.querySelectorAll('#grid canvas').length };
        }),
      ).toEqual({ calls: 0, canvases: 0 });
    } finally {
      await context.close();
    }
  });
}

test('inline thresholds and extrema remain visible with hidden regular markers', async ({ page }, testInfo) => {
  const source = await readFile(new URL('../packages/charts/dist/index.js', import.meta.url), 'utf8');
  await page.goto('/');
  const result = await page.evaluate(async (source) => {
    const { createChartRenderer } = await import(`data:text/javascript;base64,${btoa(source)}`);
    document.body.innerHTML =
      '<canvas width="240" height="64" aria-label="Inline chart with target and extrema"></canvas>';
    const ctx = document.querySelector('canvas').getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 240, 64);
    createChartRenderer({
      trend: {
        kind: 'area',
        curve: 'smooth',
        domain: [0, 10],
        markerRadius: 0,
        color: '#2563eb',
        threshold: 5,
        thresholdColor: '#dc2626',
        highlight: ['min', 'max', 'last'],
        highlightColor: '#059669',
      },
    })(ctx, { columnKey: 'trend', value: [2, 8, 4, 6, null], x: 0, y: 0, width: 240, height: 64 });
    const data = ctx.getImageData(0, 0, 240, 64).data;
    let red = 0,
      green = 0;
    for (let i = 0; i < data.length; i += 4) {
      // A one-pixel line blends with white at integer coordinates.
      if (data[i] > data[i + 1] + 50 && data[i] > data[i + 2] + 50) red++;
      if (data[i] < 50 && data[i + 1] > 100 && data[i + 1] < 180 && data[i + 2] < 150) green++;
    }
    return { red: red > 0, green: green > 0, dash: ctx.getLineDash(), fill: ctx.fillStyle };
  }, source);
  expect(result).toEqual({ red: true, green: true, dash: [], fill: '#ffffff' });
  await page.screenshot({ path: testInfo.outputPath('inline-target.png') });
});
