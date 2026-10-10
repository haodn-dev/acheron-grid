import { test, expect } from './browser-fixtures.mjs';

test('module worker parses TSV and bulk paste remains atomic and undoable', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { createTsvWorker } = await import('/core/worker.js');
    const { createGrid } = await import('/canvas/index.js');
    const { LocalDataSource } = await import('/core/index.js');
    let started = 0;
    const decoder = createTsvWorker(() => {
      started++;
      return new Worker('/core/worker-entry.js', { type: 'module' });
    });
    const parsed = await decoder.decodeTsv('"a\tb"\t"line\nnext"\r\n"quote""x"\t');
    const source = new LocalDataSource(
      Array.from({ length: 600 }, (_, i) => ({ id: i, value: 'old' })),
      (row) => row.id,
    );
    const grid = createGrid({
      container: document.querySelector('#grid'),
      dataSource: source,
      columns: [{ key: 'value', title: 'Value', editable: true }],
    });
    grid.selectRow(0);
    let atomic = true;
    await grid.pasteAsync(Array(600).fill('new').join('\n'), {
      tsvDecoder: decoder,
      yieldControl: async () => {
        atomic &&= source.getValue(0, 'value') === 'old';
      },
    });
    const final = source.getValue(599, 'value');
    grid.undo();
    const undone = source.getValue(599, 'value');
    let malformed = false;
    try {
      await grid.pasteAsync('"unterminated', { tsvDecoder: decoder, yieldControl: async () => {} });
    } catch {
      malformed = true;
    }
    decoder.destroy();
    grid.destroy();
    return { parsed, atomic, final, undone, malformed, started };
  });
  expect(result).toEqual({
    parsed: [
      ['a\tb', 'line\nnext'],
      ['quote"x', ''],
    ],
    atomic: true,
    final: 'new',
    undone: 'old',
    malformed: true,
    started: 3,
  });
});

test('worker cancellation terminates active decode and a new operation can retry', async ({ page }) => {
  await page.goto('/');
  expect(
    await page.evaluate(async () => {
      const { createTsvWorker } = await import('/core/worker.js');
      let terminated = 0;
      const decoder = createTsvWorker(() => {
        const worker = new Worker('/core/worker-entry.js', { type: 'module' });
        const terminate = worker.terminate.bind(worker);
        worker.terminate = () => {
          terminated++;
          terminate();
        };
        return worker;
      });
      const controller = new AbortController();
      const pending = decoder.decodeTsv('x'.repeat(1000000), controller.signal);
      controller.abort();
      let canceled = false;
      try {
        await pending;
      } catch {
        canceled = true;
      }
      const retry = await decoder.decodeTsv('retry');
      decoder.destroy();
      return { canceled, terminated, retry };
    }),
  ).toEqual({ canceled: true, terminated: 2, retry: [['retry']] });
});
