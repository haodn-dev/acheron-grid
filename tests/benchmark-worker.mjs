import { test, expect } from '@playwright/test';

test('TSV worker comparison preserves output and records main-thread timer delay', async ({ page }, testInfo) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { decodeTsv } = await import('/core/tsv.js');
    const { createTsvWorker } = await import('/core/worker.js');
    const decoder = createTsvWorker(() => new Worker('/core/worker-entry.js', { type: 'module' }));
    const text = Array(10000)
      .fill('"' + 'sample\t'.repeat(20) + '"')
      .join('\n');
    const samples = { sync: [], worker: [] };
    for (let pass = -2; pass < 6; pass++) {
      for (const mode of pass % 2 === 0 ? ['sync', 'worker'] : ['worker', 'sync']) {
        let delay;
        const start = performance.now();
        const timer = new Promise((resolve) =>
          setTimeout(() => {
            delay = performance.now() - start;
            resolve();
          }, 0),
        );
        const rows = mode === 'sync' ? decodeTsv(text) : await decoder.decodeTsv(text);
        const duration = performance.now() - start;
        if (rows.length !== 10000 || rows[0][0] !== 'sample\t'.repeat(20) || rows[9999][0] !== rows[0][0])
          throw new Error('Decode mismatch');
        await timer;
        if (pass >= 0) samples[mode].push({ duration, timerDelay: delay });
      }
    }
    decoder.destroy();
    return {
      samples,
      bytesUtf16: text.length,
      cells: 10000,
      warmups: 2,
      browser: navigator.userAgent,
      limitation:
        'Includes worker startup and structured clone; parser only, excludes validation and final atomic grid commit.',
    };
  });
  expect(result.samples.sync).toHaveLength(6);
  expect(result.samples.worker).toHaveLength(6);
  console.log('Worker comparison', JSON.stringify(result));
  await testInfo.attach('worker-comparison.json', {
    body: JSON.stringify(result, null, 2),
    contentType: 'application/json',
  });
});
