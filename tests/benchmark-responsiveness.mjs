import { test, expect } from '@playwright/test';

test('cooperative bulk elapsed time and longest synchronous slices', async ({ browser, browserName }, info) => {
  test.skip(
    process.env.ACHERON_RESPONSIVENESS !== '1' || browserName !== 'chromium',
    'Opt-in Chromium CPU profiles; no timing acceptance gate.',
  );
  test.setTimeout(180_000);
  const profiles = [];
  for (const cpu of [1, 4]) {
    const context = await browser.newContext({
      viewport: { width: cpu === 1 ? 1280 : 390, height: 844 },
      isMobile: cpu === 4,
      hasTouch: cpu === 4,
    });
    try {
      const page = await context.newPage();
      await page.goto('http://127.0.0.1:4179/');
      const cdp = await context.newCDPSession(page);
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu });
      const results = await page.evaluate(async () => {
        const { createGridEngine, LocalDataSource } = await import('/core/index.js');
        const results = [];
        for (const mode of ['sync', 'async', 'revision-guarded']) {
          const samples = [];
          for (let trial = -2; trial < 4; trial++) {
            const count = 100000;
            const source = new LocalDataSource(
              Array.from({ length: count }, (_, id) => ({ id, value: id })),
              (row) => row.id,
            );
            const engine = createGridEngine({
              dataSource: source,
              columns: [{ key: 'value', title: 'Value', editable: true, parse: Number }],
            });
            engine.select(0, 0);
            const text = Array.from({ length: count }, (_, id) => String(id + count)).join('\n');
            const times = {};
            for (const operation of ['paste', 'undo', 'redo', 'sort']) {
              const channel = new MessageChannel();
              let wake,
                longest = 0,
                slices = 0;
              const start = performance.now();
              let resumed = start;
              channel.port1.onmessage = () => {
                resumed = performance.now();
                wake();
              };
              const options = {
                ...(mode === 'revision-guarded' ? { getRevision: () => 'unchanged-fixture' } : {}),
                yieldControl: () => {
                  longest = Math.max(longest, performance.now() - resumed);
                  slices++;
                  return new Promise((resolve) => {
                    wake = resolve;
                    channel.port2.postMessage(0);
                  });
                },
              };
              if (operation === 'paste') mode === 'sync' ? engine.paste(text) : await engine.pasteAsync(text, options);
              if (operation === 'undo' && !(mode === 'sync' ? engine.undo() : await engine.undoAsync(options)))
                throw Error('Undo oracle');
              if (operation === 'redo' && !(mode === 'sync' ? engine.redo() : await engine.redoAsync(options)))
                throw Error('Redo oracle');
              if (operation === 'sort')
                mode === 'sync'
                  ? engine.setView({ sort: { columnKey: 'value', direction: 'desc' } })
                  : await engine.setViewAsync({ sort: { columnKey: 'value', direction: 'desc' } }, options);
              const end = performance.now();
              longest = Math.max(longest, end - resumed);
              channel.port1.close();
              channel.port2.close();
              times[operation] = { totalMs: end - start, longestSliceMs: longest, slices };
              if (source.getValue(count - 1, 'value') !== (operation === 'undo' ? count - 1 : count * 2 - 1))
                throw Error('Value oracle');
              if (operation === 'sort' && engine.getRowId(0) !== count - 1) throw Error('Sort oracle');
            }
            engine.destroy();
            if (trial >= 0) samples.push(times);
          }
          results.push({ mode, samples });
        }
        return results;
      });
      expect(results).toHaveLength(3);
      profiles.push({ cpuThrottle: cpu, emulatedMobile: cpu === 4, results });
    } finally {
      await context.close();
    }
  }
  await info.attach('cooperative-bulk-profile', {
    body: JSON.stringify(
      {
        browser: browser.version(),
        warmups: 2,
        trials: 4,
        count: 100000,
        profiles,
        note: 'Emulation is not physical hardware. Monotonic sort is favorable. Longest JS slice includes final atomic commit, not presented frame time. No peak-memory or timing acceptance claim.',
      },
      null,
      2,
    ),
    contentType: 'application/json',
  });
});

test('warmed local command responsiveness profiles', async ({ page, browserName }) => {
  test.skip(
    process.env.ACHERON_RESPONSIVENESS !== '1',
    'Opt-in stable-host measurement; variable CI does not enforce timing budgets.',
  );
  test.setTimeout(180_000);
  await page.goto('/');
  const profiles = await page.evaluate(async () => {
    const { createGridEngine, LocalDataSource, LocalDataView } = await import('/core/index.js');
    const profiles = [];
    for (const count of [10_000, 100_000]) {
      const samples = [];
      const rows = Array.from({ length: count }, (_, id) => ({
        id,
        score: (id * 48271) % 997,
        team: `team-${id % 10}`,
      }));
      const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
      const sorted = rows.slice().sort((a, b) => collator.compare(a.team, b.team) || b.score - a.score || a.id - b.id);
      const filtered = rows.filter((row) => row.team === 'team-3');
      const text = rows.map((row) => String(row.id + 1000)).join('\r\n');
      for (let trial = -2; trial < 30; trial++) {
        const source = new LocalDataSource(rows, (row) => row.id);
        const engine = createGridEngine({
          dataSource: source,
          columns: [{ key: 'score', title: 'Score', editable: true, parse: Number }],
        });
        const measure = async (name, run) => {
          await new Promise((resolve) => setTimeout(resolve, 0));
          const start = performance.now();
          const timer = new Promise((resolve) => setTimeout(() => resolve(performance.now() - start), 0));
          const value = run(),
            ms = performance.now() - start;
          const timerDelayMs = await timer;
          if (trial >= 0) samples.push({ trial, name, ms, timerDelayMs });
          return value;
        };
        const view = await measure(
          'multiSort',
          () =>
            new LocalDataView(source, {
              sorts: [
                { columnKey: 'team', direction: 'asc' },
                { columnKey: 'score', direction: 'desc' },
              ],
            }),
        );
        if (view.getRowCount() !== count || sorted.some((row, i) => view.getRowId(i) !== row.id))
          throw Error('Sort oracle mismatch');
        const selection = await measure(
          'filter',
          () => new LocalDataView(source, { filters: [{ columnKey: 'team', operator: 'equals', query: 'team-3' }] }),
        );
        if (selection.getRowCount() !== filtered.length || filtered.some((row, i) => selection.getRowId(i) !== row.id))
          throw Error('Filter oracle mismatch');
        engine.select(0, 0);
        await measure('paste', () => engine.paste(text));
        if (rows.some((row, i) => source.getValue(i, 'score') !== row.id + 1000)) throw Error('Paste oracle mismatch');
        const undone = await measure('undo', () => engine.undo());
        if (!undone || rows.some((row, i) => source.getValue(i, 'score') !== row.score))
          throw Error('Undo oracle mismatch');
        engine.destroy();
      }
      const summary = Object.fromEntries(
        ['multiSort', 'filter', 'paste', 'undo'].map((name) => {
          const values = samples.filter((sample) => sample.name === name);
          const percentile = (key, p) =>
            values.map((sample) => sample[key]).sort((a, b) => a - b)[
              Math.min(values.length - 1, Math.ceil(values.length * p) - 1)
            ];
          const budgetMs = count === 10_000 ? 50 : 250;
          const p95Ms = percentile('ms', 0.95),
            p95TimerDelayMs = percentile('timerDelayMs', 0.95);
          return [
            name,
            {
              samples: values.length,
              medianMs: percentile('ms', 0.5),
              p95Ms,
              p95TimerDelayMs,
              budgetMs,
              withinReferenceBudget: p95Ms <= budgetMs && p95TimerDelayMs <= budgetMs,
            },
          ];
        }),
      );
      profiles.push({ rows: count, pasteCells: count, warmupTrials: 2, measuredTrials: 30, samples, summary });
    }
    return { userAgent: navigator.userAgent, dpr: devicePixelRatio, profiles };
  });
  for (const profile of profiles.profiles) {
    expect(profile.samples).toHaveLength(120);
    for (const sample of profile.samples) {
      expect(Number.isFinite(sample.ms)).toBe(true);
      expect(sample.timerDelayMs).toBeGreaterThanOrEqual(sample.ms);
    }
  }
  await test.info().attach('responsiveness-cost.json', {
    body: Buffer.from(
      JSON.stringify(
        {
          browserName,
          ...profiles,
          limitations:
            'Reference engineering budgets, not portable guarantees. Two fixture-specific warmups and 30 sequential trials. Timer latency includes scheduling. Correctness oracles run outside measured commands. Headless core only, no Canvas/host/network/FPS/peak memory. Budget misses are reported, not correctness failures.',
        },
        null,
        2,
      ),
    ),
    contentType: 'application/json',
  });
});
