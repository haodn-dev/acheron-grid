import { test, expect } from '@playwright/test';

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
