import { test, expect } from '@playwright/test';

test('headless tree module serves in browsers and keeps filtered/collapsed record identity', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const { createGridEngine, LocalDataSource } = await import('/core/index.js');
    const engine = createGridEngine({
      dataSource: new LocalDataSource(
        [
          { id: 0, parent: null, name: 'root' },
          { id: '', parent: 0, name: 'match' },
        ],
        (row) => row.id,
      ),
      columns: ['parent', 'name'].map((key) => ({ key, title: key, editable: true })),
      tree: { parentColumnKey: 'parent' },
    });
    engine.setView({ filters: [{ columnKey: 'name', operator: 'equals', query: 'match' }] });
    engine.select(1, 1);
    engine.setTreeExpanded(0, false);
    const result = {
      count: engine.rowCount,
      selection: engine.getSelection().rowId,
      metadata: engine.getTreeRowMetadata(0),
      text: engine.copySelection(),
      parentWritable: engine.getCellPermission(0, 0).writable,
    };
    engine.destroy();
    return result;
  });
  expect(result).toEqual({
    count: 1,
    selection: 0,
    metadata: { sourceIndex: 0, rowId: 0, parentId: null, level: 1, hasChildren: true, expanded: false },
    text: 'root',
    parentWritable: false,
  });
});
