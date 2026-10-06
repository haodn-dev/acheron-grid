import { test, expect } from '@playwright/test';

test('Canvas allocated lifecycle: heap checkpoints and teardown counters', async ({ page, context, browserName }) => {
  test.skip(browserName !== 'chromium', 'Heap/DOM counters use Chromium CDP.');
  test.setTimeout(60_000);
  await page.goto('/');
  const session = await context.newCDPSession(page);
  const snapshots = [];
  const capture = async (label, collect = false) => {
    if (collect) await session.send('HeapProfiler.collectGarbage');
    const heap = await session.send('Runtime.getHeapUsage');
    const dom = await session.send('Memory.getDOMCounters');
    snapshots.push({ label, collected: collect, ...heap, ...dom });
    return snapshots.at(-1);
  };
  const mount = () => page.evaluate(async () => {
    const { createGrid } = await import('/canvas/index.js');
    const { LocalDataSource } = await import('/core/index.js');
    window.memorySource = new LocalDataSource(Array.from({ length: 100_000 }, (_, id) => ({ id, score: id })), row => row.id);
    window.memoryGrid = createGrid({ container: document.querySelector('#grid'), accessibility: 'viewport',
      columns: [{ key: 'score', title: 'Score', editable: true, parse: Number }], dataSource: window.memorySource });
    document.querySelector('[role=grid]').dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', ctrlKey: true, bubbles: true }));
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  });
  const destroy = () => page.evaluate(async () => {
    window.memoryGrid.destroy(); window.memoryGrid.destroy();
    delete window.memoryGrid; delete window.memorySource;
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    if (document.querySelector('#grid canvas,[role=grid],[data-grid-dialog]')) throw new Error('Teardown left grid DOM.');
    if (!document.querySelector('#existing')) throw new Error('Host content was removed.');
  });
  // Warm module/image/font caches before comparing retained state across cycles.
  for (let i = 0; i < 2; i++) { await mount(); await destroy(); }
  const baseline = await capture('warmBaseline', true);
  await mount(); await capture('mounted100k');
  await page.evaluate(() => {
    window.memoryGrid.paste(Array.from({ length: 100_000 }, (_, id) => String(id + 1000)).join('\r\n'));
    if (window.memorySource.getValue(0, 'score') !== 1000 || window.memorySource.getValue(99_999, 'score') !== 100_999) throw new Error('Paste incorrect.');
  });
  await capture('paste100kWithHistory');
  await page.evaluate(() => {
    if (!window.memoryGrid.undo() || window.memorySource.getValue(0, 'score') !== 0 || window.memorySource.getValue(99_999, 'score') !== 99_999) throw new Error('Undo incorrect.');
  });
  await capture('afterUndo'); await destroy(); await capture('afterLargeCommandDestroy', true);
  for (let cycle = 0; cycle < 20; cycle++) {
    await mount();
    await page.evaluate(() => { window.memoryGrid.updateCells([{ rowIndex: 0, columnKey: 'score', value: -1 }]); window.memoryGrid.undo(); });
    await destroy();
    await capture(`destroyCycle${cycle + 1}`, true);
  }
  const end = snapshots.at(-1);
  expect(end.documents).toBe(baseline.documents);
  expect(end.nodes).toBeLessThanOrEqual(baseline.nodes);
  expect(end.jsEventListeners).toBeLessThanOrEqual(baseline.jsEventListeners);
  const result = { userAgent: await page.evaluate(() => navigator.userAgent), rows: 100_000, cycles: 20, warmupCycles: 2,
    snapshots, maximumCheckpointUsedSize: Math.max(...snapshots.map(sample => sample.usedSize)),
    retainedHeapDeltaBytes: end.usedSize - baseline.usedSize,
    limitations: 'Chromium isolate heap checkpoints, not true transient peak, browser RSS, GPU/Canvas memory or leak proof. Explicit GC alters production behavior. Heap delta has no threshold; exact DOM/listener cleanup and data/history assertions gate correctness.' };
  await test.info().attach('lifecycle-memory.json', { body: Buffer.from(JSON.stringify(result, null, 2)), contentType: 'application/json' });
  await session.detach();
});
