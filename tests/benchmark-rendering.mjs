import { test, expect } from '@playwright/test';

for (const dpr of [1, 2, 3])
  test(`Canvas frame cadence and memory trace at DPR ${dpr}`, async ({ browser, browserName }) => {
    test.skip(browserName !== 'chromium', 'Memory tracing uses Chromium CDP.');
    const context = await browser.newContext({ viewport: { width: 1000, height: 800 }, deviceScaleFactor: dpr });
    const page = await context.newPage();
    await page.goto('/');
    const cdp = await context.newCDPSession(page);
    const events = [];
    cdp.on('Tracing.dataCollected', ({ value }) => events.push(...value));
    await cdp.send('Tracing.start', {
      categories: 'disabled-by-default-memory-infra',
      options: 'record-as-much-as-possible',
      transferMode: 'ReportEvents',
    });
    const dumps = [];
    const capture = async (label) => {
      const heap = await cdp.send('Runtime.getHeapUsage');
      const dom = await cdp.send('Memory.getDOMCounters');
      const dump = await cdp.send('Tracing.requestMemoryDump', { levelOfDetail: 'light' });
      dumps.push({ label, heap, dom, dump });
    };
    await capture('baseline');
    const result = await page.evaluate(async () => {
      const { createGrid } = await import('/canvas/index.js');
      const { LocalDataSource } = await import('/core/index.js');
      const source = new LocalDataSource(
        Array.from({ length: 10_000 }, (_, id) => ({ id, text: `Row ${id}\nwrapped text`, score: id })),
        (row) => row.id,
      );
      let reads = 0;
      const read = source.getValue.bind(source);
      source.getValue = (row, key) => {
        reads++;
        return read(row, key);
      };
      const grid = createGrid({
        container: document.querySelector('#grid'),
        dataSource: source,
        wrapText: true,
        frozenRows: 2,
        frozenColumns: 1,
        accessibility: 'viewport',
        columns: [
          { key: 'text', title: 'Text', editable: true },
          { key: 'score', title: 'Score', editable: true },
        ],
      });
      window.renderGrid = grid;
      window.renderSource = source;
      const next = () => new Promise((resolve) => requestAnimationFrame(resolve));
      await document.fonts.ready;
      await next();
      await next();
      const viewport = document.querySelector('[role=grid]'),
        intervals = [],
        readCounts = [];
      let previous = await next();
      for (let i = 0; i < 60; i++) {
        const before = reads;
        viewport.scrollTop = 1000 + i * 24;
        grid.render();
        const time = await next();
        intervals.push(time - previous);
        previous = time;
        readCounts.push(reads - before);
      }
      viewport.scrollTop = 0;
      grid.render();
      await next();
      await next();
      grid.updateCells([{ rowIndex: 0, columnKey: 'score', value: -1 }]);
      await next();
      await next();
      if (source.getValue(0, 'score') !== -1 || !grid.undo() || source.getValue(0, 'score') !== 0)
        throw new Error('Update/undo mismatch.');
      const canvases = [...document.querySelectorAll('#grid canvas')].map((canvas) => ({
        width: canvas.width,
        height: canvas.height,
        cssWidth: canvas.clientWidth,
        cssHeight: canvas.clientHeight,
        estimatedRgbaBytes: canvas.width * canvas.height * 4,
      }));
      return { dpr: devicePixelRatio, intervals, readCounts, canvases, rows: 10_000, columns: 2 };
    });
    await capture('mountedAfterScrollAndHistory');
    await page.evaluate(() => {
      window.renderGrid.destroy();
      delete window.renderGrid;
      delete window.renderSource;
    });
    await cdp.send('HeapProfiler.collectGarbage');
    await capture('afterDestroyGC');
    const completed = new Promise((resolve) => cdp.once('Tracing.tracingComplete', resolve));
    await cdp.send('Tracing.end');
    await completed;
    const memoryEvents = events
      .filter((event) => event.cat?.includes('memory-infra'))
      .map((event) => ({ name: event.name, pid: event.pid, ts: event.ts, args: event.args }));
    const processSamples = memoryEvents
      .filter((event) => event.args?.dumps?.process_totals)
      .map((event) => ({ pid: event.pid, ts: event.ts, ...event.args.dumps.process_totals }));
    expect(result.dpr).toBe(dpr);
    expect(result.intervals).toHaveLength(60);
    expect(Math.max(...result.readCounts)).toBeLessThan(200);
    for (const canvas of result.canvases)
      if (canvas.cssWidth && canvas.cssHeight) {
        expect(canvas.width).toBe(Math.round(canvas.cssWidth * dpr));
        expect(canvas.height).toBe(Math.round(canvas.cssHeight * dpr));
      }
    expect(await page.locator('#grid canvas,[role=grid]').count()).toBe(0);
    expect(await page.locator('#existing').count()).toBe(1);
    await test.info().attach('rendering-cost.json', {
      body: Buffer.from(
        JSON.stringify(
          {
            ...result,
            dumps,
            processSamples,
            memoryEvents,
            limitations:
              'Headless animation-frame intervals are scheduling cadence, not presented FPS. Heap/process totals are explicit sampled checkpoints, not true transient peak. Trace fields use hexadecimal byte strings; private footprint is not RSS and zero peak RSS does not establish zero usage. Canvas RGBA bytes are a dimension-based estimate, not measured GPU allocation. Explicit GC differs from production. No timing threshold.',
          },
          null,
          2,
        ),
      ),
      contentType: 'application/json',
    });
    await context.close();
  });
