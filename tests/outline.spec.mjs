import { test, expect } from '@playwright/test';

async function setup(page) {
  await page.goto('/');
  await page.evaluate(async()=>{
    const {createGrid}=await import('/canvas/index.js');
    const {LocalDataSource}=await import('/core/index.js');
    window.source=new LocalDataSource(Array.from({length:100},(_,id)=>({id,a:'Alpha '+id,b:'Beta '+id,c:'Gamma '+id})),row=>row.id);
    window.grid=createGrid({container:document.querySelector('#grid'),dataSource:window.source,accessibility:'viewport',columns:['a','b','c'].map(key=>({key,title:key,editable:true})),editorOptions:{pinned:false},rowHeight:32,columnWidth:160});
  });
}

test('merged cells render one span, hit the anchor, edit, resize, scroll and unmerge from menu',async({page})=>{
  await setup(page);
  await page.evaluate(()=>window.grid.mergeCells({startRow:1,endRow:3,startColumn:0,endColumn:1}));
  await expect(page.locator('[role=gridcell][aria-rowspan="3"][aria-colspan="2"]')).toHaveText('a: Alpha 1');
  const viewport=page.getByLabel(/^Data grid viewport/);
  await viewport.click({position:{x:220,y:80}});
  expect(await page.evaluate(()=>window.grid.getSelection())).toMatchObject({rowIndex:1,columnIndex:0});
  await viewport.press('F2');
  const editor=page.getByRole('textbox');await expect(editor).toHaveValue('Alpha 1');
  expect(await editor.evaluate(el=>({width:el.offsetWidth,height:el.offsetHeight}))).toEqual({width:320,height:96});
  await editor.fill('Merged edit');await editor.press('Enter');
  expect(await page.evaluate(()=>[window.source.getValue(1,'a'),window.source.getValue(2,'b')])).toEqual(['Merged edit','Beta 2']);
  await viewport.press('ArrowRight');expect(await page.evaluate(()=>window.grid.getSelection().columnIndex)).toBe(2);
  await page.evaluate(()=>{window.grid.setColumnWidth(0,200);window.grid.setRowHeight(2,64);});
  await viewport.evaluate(el=>{el.scrollTop=70;});
  await viewport.click({position:{x:250,y:12}});
  expect(await page.evaluate(()=>window.grid.getSelection())).toMatchObject({rowIndex:1,columnIndex:0});
  await viewport.click({button:'right',position:{x:250,y:12}});
  await page.getByRole('menuitem',{name:'Unmerge cells',exact:true}).click();
  expect(await page.evaluate(()=>window.grid.getMergedCells())).toEqual([]);
  await page.evaluate(()=>window.grid.undo());
  expect(await page.evaluate(()=>window.grid.getMergedCells().length)).toBe(1);
});

test('row group controls collapse nested groups and keep visible edits tied to source records',async({page})=>{
  await setup(page);
  await page.evaluate(()=>{window.parent=window.grid.groupRows(1,6);window.child=window.grid.groupRows(2,4);});
  const child=page.getByRole('button',{name:'Collapse rows 3–5',exact:true});
  await child.click();
  await expect(page.getByRole('button',{name:'Expand rows 3–5',exact:true})).toHaveAttribute('aria-expanded','false');
  expect(await page.evaluate(()=>window.grid.rowCount)).toBe(98);
  await page.getByRole('button',{name:'Collapse rows 2–7',exact:true}).click();
  expect(await page.evaluate(()=>window.grid.rowCount)).toBe(95);
  const viewport=page.getByLabel(/^Data grid viewport/);
  await viewport.click({position:{x:50,y:80}});await viewport.press('F2');
  await expect(page.getByRole('textbox')).toHaveValue('Alpha 7');
  await page.getByRole('textbox').fill('Visible source 7');await page.getByRole('textbox').press('Enter');
  expect(await page.evaluate(()=>window.source.getValue(7,'a'))).toBe('Visible source 7');
  await page.getByRole('button',{name:'Expand rows 2–7',exact:true}).click();
  expect(await page.evaluate(()=>window.grid.rowCount)).toBe(98);
  await page.getByRole('button',{name:'Expand rows 3–5',exact:true}).click();
  expect(await page.evaluate(()=>window.grid.rowCount)).toBe(100);
  await page.evaluate(()=>window.grid.undo());expect(await page.evaluate(()=>window.grid.rowCount)).toBe(98);
});


test('table lock notice follows locks, can be customized or disabled, and preserves selection', async ({ page }) => {
  await setup(page);
  await page.evaluate(() => window.grid.setLocked({ scope: 'table' }, true));
  await expect(page.locator('[data-grid-lock-notice]')).toContainText('Table locked');
  await expect(page.locator('[data-grid-lock-notice]')).toBeVisible();
  await page.evaluate(() => window.grid.selectRow(2));
  expect(await page.evaluate(() => window.grid.getSelection().rowIndex)).toBe(2);
  await page.evaluate(() => window.grid.setLocked({ scope: 'table' }, false));
  await expect(page.locator('[data-grid-lock-notice]')).toBeHidden();
  for (const notice of [false, { title: 'Read only', description: 'Custom message' }]) {
    await page.evaluate(async value => {
      window.grid.destroy();
      const { createGrid } = await import('/canvas/index.js');
      window.grid = createGrid({ container: document.querySelector('#grid'), dataSource: window.source, columns: [{ key: 'a', title: 'A', editable: true }], tableLockNotice: value, motion: false });
      window.grid.setLocked({ scope: 'table' }, true);
    }, notice);
    if (notice === false) await expect(page.locator('[data-grid-lock-notice]')).toBeHidden();
    else await expect(page.locator('[data-grid-lock-notice]')).toHaveText('Read onlyCustom message');
  }
});
