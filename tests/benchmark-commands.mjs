import { test, expect } from '@playwright/test';

test('allocated local commands: 100k rows, browser task delay and correctness', async ({ page, browserName }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { createGridEngine, LocalDataSource, LocalDataView } = await import('/core/index.js');
    const samples = [];
    const tasks = [];
    const supportsLongTasks = PerformanceObserver.supportedEntryTypes.includes('longtask');
    const observer = supportsLongTasks
      ? new PerformanceObserver((list) =>
          tasks.push(...list.getEntries().map((entry) => ({ start: entry.startTime, ms: entry.duration }))),
        )
      : null;
    observer?.observe({ type: 'longtask', buffered: false });
    const measure = async (name, run) => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      const start = performance.now();
      const timer = new Promise((resolve) => setTimeout(() => resolve(performance.now() - start), 0));
      const value = run();
      const end = performance.now();
      const timerDelayMs = await timer;
      samples.push({ name, start, end, ms: end - start, timerDelayMs });
      return value;
    };
    for (let trial = 0; trial < 3; trial++) {
      const rows = Array.from({ length: 100_000 }, (_, id) => ({
        id,
        score: (id * 48271) % 997,
        team: `team-${id % 10}`,
      }));
      const source = new LocalDataSource(rows, (row) => row.id);
      const criteria = {
        sorts: [
          { columnKey: 'team', direction: 'asc' },
          { columnKey: 'score', direction: 'desc' },
        ],
      };
      const view = await measure('multiSort100k', () => new LocalDataView(source, criteria));
      const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
      const expected = rows
        .slice()
        .sort((a, b) => collator.compare(a.team, b.team) || b.score - a.score || a.id - b.id);
      if (expected.some((row, index) => view.getRowId(index) !== row.id))
        throw new Error('Incorrect sorted identities.');
      const engine = createGridEngine({
        dataSource: source,
        columns: [{ key: 'score', title: 'Score', editable: true, parse: Number }],
      });
      engine.select(0, 0);
      const text = rows.map((row) => String(row.id + 1000)).join('\r\n');
      await measure('paste100k', () => engine.paste(text));
      if (rows.some((row, index) => source.getValue(index, 'score') !== row.id + 1000))
        throw new Error('Incorrect paste.');
      const undone = await measure('undoPaste100k', () => engine.undo());
      if (!undone || rows.some((row, index) => source.getValue(index, 'score') !== row.score))
        throw new Error('Incorrect undo.');
      engine.destroy();
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
    observer?.disconnect();
    return {
      userAgent: navigator.userAgent,
      devicePixelRatio,
      rows: 100_000,
      trials: 3,
      supportsLongTasks,
      samples,
      operationLongTasks: tasks.filter((task) =>
        samples.some((sample) => task.start <= sample.end && task.start + task.ms >= sample.start),
      ),
      limitations:
        'Headless CPU wall time and zero-delay timer latency, including scheduling overhead. Long-task entries may include work outside an operation. No Canvas, FPS, GPU or peak memory; no warmup or timing threshold.',
    };
  });
  expect(result.samples).toHaveLength(9);
  for (const sample of result.samples) {
    expect(Number.isFinite(sample.ms)).toBe(true);
    expect(sample.timerDelayMs).toBeGreaterThanOrEqual(sample.ms);
  }
  await test.info().attach('command-cost.json', {
    body: Buffer.from(JSON.stringify({ browserName, ...result }, null, 2)),
    contentType: 'application/json',
  });
});
