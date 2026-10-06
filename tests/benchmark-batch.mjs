import { test, expect } from '@playwright/test';

test('allocated multi-column batches and paste retain atomic values and history', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { LocalDataSource, createGridEngine } = await import('/core/index.js');
    const runs = [];
    for (const columnCount of [1, 10, 100])
      for (let trial = 0; trial < 3; trial++) {
        const rowCount = 100_000 / columnCount;
        const keys = Array.from({ length: columnCount }, (_, i) => `c${i}`);
        const rows = Array.from({ length: rowCount }, (_, id) => ({
          id,
          ...Object.fromEntries(keys.map((key, c) => [key, id + c])),
        }));
        const source = new LocalDataSource(rows, (row) => row.id);
        const updates = rows.flatMap((row, rowIndex) =>
          keys.map((columnKey, c) => ({ rowIndex, columnKey, value: rowIndex + c + 1000 })),
        );
        const timings = {};
        const measure = (name, run) => {
          const start = performance.now();
          const value = run();
          timings[name] = performance.now() - start;
          return value;
        };
        const check = (offset) => {
          for (let row = 0; row < rowCount; row++)
            for (let col = 0; col < columnCount; col++)
              if (source.getValue(row, keys[col]) !== row + col + offset) throw new Error('Incorrect batch value.');
        };
        measure('setValues', () => source.setValues(updates));
        check(1000);
        source.setValues(updates.map((update) => ({ ...update, value: update.value - 1000 })));
        check(0);
        let writable = true;
        const events = [];
        const engine = createGridEngine({
          dataSource: source,
          columns: keys.map((key) => ({
            key,
            title: key,
            editable: true,
            parse: Number,
            validate: (value) => (value < 0 ? 'Negative value' : null),
          })),
          resolveCellPermission: () => ({ writable }),
          onEvent: (event) => events.push(event.type),
        });
        measure('updateCells', () => engine.updateCells(updates));
        check(1000);
        if (!measure('undoBatch', () => engine.undo())) throw new Error('Missing batch history.');
        check(0);
        if (!engine.redo()) throw new Error('Missing redo.');
        check(1000);
        engine.undo();
        check(0);
        engine.select(0, 0);
        const text = rows.map((row, i) => keys.map((_, c) => i + c + 2000).join('\t')).join('\r\n');
        measure('paste', () => engine.paste(text));
        check(2000);
        if (!measure('undoPaste', () => engine.undo())) throw new Error('Missing paste history.');
        check(0);
        if (!engine.redo()) throw new Error('Missing paste redo.');
        check(2000);
        engine.undo();
        check(0);
        const count = events.length;
        const past = engine.canUndo(),
          future = engine.canRedo();
        writable = false;
        let vetoed = false;
        try {
          engine.updateCells(updates);
        } catch {
          vetoed = true;
        }
        if (!vetoed || events.length !== count || engine.canUndo() !== past || engine.canRedo() !== future)
          throw new Error('Veto changed events/history.');
        check(0);
        writable = true;
        let invalid = false;
        try {
          engine.updateCells([...updates, { rowIndex: rowCount - 1, columnKey: keys.at(-1), value: -1 }]);
        } catch {
          invalid = true;
        }
        if (!invalid || events.length !== count || engine.canUndo() !== past || engine.canRedo() !== future)
          throw new Error('Validation changed events/history.');
        check(0);
        engine.destroy();
        runs.push({ rowCount, columnCount, cells: updates.length, trial, timings });
      }
    return {
      userAgent: navigator.userAgent,
      devicePixelRatio,
      runs,
      limitations:
        'Three sequential trials per shape, 100k cells; headless CPU wall time, no warmup, timing threshold, frame cadence or peak-memory claim. Shapes differ in row count and cannot isolate width scaling.',
    };
  });
  expect(result.runs).toHaveLength(9);
  await test
    .info()
    .attach('batch-cost.json', { body: Buffer.from(JSON.stringify(result, null, 2)), contentType: 'application/json' });
});
