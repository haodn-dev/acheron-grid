import { test, expect } from './browser-fixtures.mjs';

test('bulk facade exposes busy state, commits once and restores viewport focus', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { LocalDataSource } = await import('/core/index.js');
    const { createGrid } = await import('/canvas/index.js');
    const container = document.createElement('div');
    container.style.cssText = 'width:600px;height:300px';
    document.body.append(container);
    const source = new LocalDataSource(
      Array.from({ length: 600 }, (_, id) => ({ id, value: 'old' })),
      (row) => row.id,
    );
    const grid = createGrid({
      container,
      dataSource: source,
      columns: [{ key: 'value', title: 'Value', editable: true }],
    });
    const viewport = container.querySelector('[role="grid"]');
    viewport.focus();
    grid.selectRow(0);
    let busy = false;
    await grid.pasteAsync(Array(600).fill('new').join('\n'), {
      yieldControl: () =>
        new Promise((resolve) => {
          busy ||= !!container.querySelector('[aria-busy="true"]')?.inert;
          if (source.getValue(0, 'value') !== 'old') throw new Error('Partial write');
          setTimeout(resolve, 0);
        }),
    });
    const focused = document.activeElement === viewport;
    const final = source.getValue(599, 'value');
    await grid.undoAsync({ yieldControl: () => Promise.resolve() });
    const original = source.getValue(599, 'value');
    const undo = grid.undo();
    grid.destroy();
    container.remove();
    return { busy, focused, final, original, undo };
  });
  expect(result).toEqual({ busy: true, focused: true, final: 'new', original: 'old', undo: false });
});
