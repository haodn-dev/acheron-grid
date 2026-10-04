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
  await page.screenshot({path:'test-results/group-ui.png'});
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


test('layout motion updates state immediately and cancels on scroll or reduced motion', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await setup(page);
  const count = await page.evaluate(() => { window.grid.moveColumns([0], 3); return { keys: window.grid.columns.map(column => column.key), layers: document.querySelectorAll('[data-grid-motion]').length }; });
  expect(count.keys).toEqual(['b', 'c', 'a']); expect(count.layers).toBeGreaterThan(0);
  await expect(page.locator('[data-grid-motion]')).toHaveCount(0);
  await page.evaluate(() => { window.grid.moveRows([0], 4); document.querySelector('[role=grid]').dispatchEvent(new Event('scroll')); });
  await expect(page.locator('[data-grid-motion]')).toHaveCount(0);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  expect(await page.evaluate(() => { window.grid.moveColumns([0], 3); return document.querySelectorAll('[data-grid-motion]').length; })).toBe(0);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.evaluate(() => { window.grid.moveColumns([0], 3); window.grid.destroy(); });
  await expect(page.locator('[data-grid-motion]')).toHaveCount(0);
});

test('copy and cut have distinct persistent outlines',async({page})=>{
 await setup(page);
 await page.getByLabel(/^Data grid viewport/).click({position:{x:80,y:45}});
 await page.evaluate(()=>window.grid.copySelectionBlocks());
 await expect(page.locator('[data-operation=copy] rect')).toHaveCSS('stroke-dasharray','4px, 3px');
 await page.evaluate(()=>window.grid.cutSelectionBlocks());
 await expect(page.locator('[data-operation=cut] rect')).toHaveCSS('stroke-dasharray','8px, 6px');
 await page.getByLabel(/^Data grid viewport/).click({position:{x:220,y:80}});
 await expect(page.locator('[data-operation=cut] rect')).toBeVisible();
});



test('context locks the selected rows and columns together',async({page})=>{
 await setup(page);
 await page.evaluate(()=>{window.grid.selectRow(1);});
 const viewport=page.getByLabel(/^Data grid viewport/);
 await viewport.press('Shift+ArrowDown');
 await viewport.click({button:'right',position:{x:80,y:80}});
 await page.getByRole('menuitem',{name:'Lock 2 selected rows',exact:true}).click();
 expect(await page.evaluate(()=>[1,2].map(rowIndex=>window.grid.isLocked({scope:'row',rowIndex})))).toEqual([true,true]);
 await viewport.click({button:'right',position:{x:80,y:80}});
 await page.getByRole('menuitem',{name:'Unlock 2 selected rows',exact:true}).click();
 expect(await page.evaluate(()=>[1,2].map(rowIndex=>window.grid.isLocked({scope:'row',rowIndex})))).toEqual([false,false]);
 await page.evaluate(()=>window.grid.selectColumn(0));await viewport.press('Shift+ArrowRight');
 await viewport.click({button:'right',position:{x:80,y:80}});await page.getByRole('menuitem',{name:'Lock 2 selected columns',exact:true}).click();
 expect(await page.evaluate(()=>[0,1].map(columnIndex=>window.grid.isLocked({scope:'column',columnIndex})))).toEqual([true,true]);
});
test('validation distinguishes reject from allowed warnings',async({page})=>{
 await setup(page);
 await page.evaluate(async()=>{
  window.grid.destroy();const {createGrid}=await import('/canvas/index.js');
  window.grid=createGrid({container:document.querySelector('#grid'),dataSource:window.source,accessibility:'viewport',columns:[{key:'a',title:'Reject',editable:true,validate:v=>v==='bad'?'Use another value.':undefined},{key:'b',title:'Allow',editable:true,invalidInput:'allow',validate:v=>v==='bad'?'Use another value.':undefined}],rowHeight:32,columnWidth:160});
 });
 const viewport=page.getByLabel(/^Data grid viewport/);
 await viewport.click({position:{x:80,y:45}});await viewport.press('F2');
 const editor=page.getByRole('textbox');await editor.fill('bad');await expect(editor).toHaveAttribute('aria-invalid','true');
 await editor.press('Enter');await expect(editor).toBeVisible();expect(await page.evaluate(()=>window.source.getValue(0,'a'))).toBe('Alpha 0');
 await editor.press('Escape');await viewport.click({position:{x:220,y:45}});await viewport.press('F2');await editor.fill('bad');
 await expect(page.getByText('Use another value. � You can save this value.',{exact:true})).toBeVisible();await editor.press('Enter');
 expect(await page.evaluate(()=>window.source.getValue(1,'b'))).toBe('bad');
 await expect(page.getByRole('gridcell',{name:'Allow: bad',exact:true})).toHaveAttribute('aria-invalid','true');
 await page.screenshot({path:'test-results/validation-ui.png'});
});
