import {test,expect} from './browser-fixtures.mjs';

test('hidden axes skip paint/ARIA and keyboard, retain data and recover when all columns are hidden',async({page})=>{
 await page.goto('/');await page.evaluate(async()=>{
  const {createGrid}=await import('/canvas/index.js');const {LocalDataSource}=await import('/core/index.js');
  window.source=new LocalDataSource([{id:0,a:'A',b:'B',c:'C'},{id:1,a:'D',b:'E',c:'F'},{id:2,a:'G',b:'H',c:'I'}],row=>row.id);
  window.grid=createGrid({container:document.querySelector('#grid'),dataSource:source,columns:['a','b','c'].map(key=>({key,title:key,editable:true})),accessibility:'viewport',contextMenuSuggestions:false});
  grid.setRowsHidden([1],true);grid.setColumnsHidden([1],true);grid.selectRow(0);
 });
 await expect(page.locator('[data-grid-header-cell="1"]')).toHaveCount(0);
 await expect(page.getByRole('gridcell').filter({hasText:'B'})).toHaveCount(0);
 await page.locator('[role=grid]').focus();await page.keyboard.press('ArrowRight');expect(await page.evaluate(()=>grid.getSelection().columnIndex)).toBe(2);
 await page.keyboard.press('ArrowDown');expect(await page.evaluate(()=>grid.getSelection().rowIndex)).toBe(2);
 expect(await page.evaluate(()=>grid.getValue(1,'b'))).toBe('E');
 await page.evaluate(()=>grid.setColumnsHidden([0,2],true));await page.locator('[role=grid]').focus();await page.keyboard.press('Shift+F10');
 await page.getByRole('menuitem',{name:'Show all hidden columns',exact:true}).click();
 await expect(page.locator('[data-grid-header-cell="1"]')).toHaveCount(1);await page.evaluate(()=>grid.destroy());
});

test('locale and number formats cover menu, editor, numeric ARIA without translating user data',async({page})=>{
 await page.goto('/');await page.evaluate(async()=>{
  const {createGrid}=await import('/canvas/index.js');const {LocalDataSource}=await import('/core/index.js');
  window.grid=createGrid({container:document.querySelector('#grid'),locale:'vi-VN',currency:'VND',messages:{'Copy':'Chép dữ liệu'},contextMenuSuggestions:false,dataSource:new LocalDataSource([{id:0,amount:1234.5,label:'Copy'}],row=>row.id),columns:[{key:'amount',title:'Amount',editable:true,parse:Number},{key:'label',title:'Label'}],accessibility:'viewport'});
  grid.format([{scope:'column',columnIndex:0}],{numberFormat:'decimal'});grid.selectRow(0);
 });
 await expect(page.locator('[role=grid]')).toHaveAttribute('aria-label',/hàng 1/);
 await expect(page.getByRole('gridcell').filter({hasText:'Amount: 1.234,5'})).toHaveCount(1);
 await expect(page.getByRole('gridcell').filter({hasText:'Label: Copy'})).toHaveCount(1);
 await page.locator('[role=grid]').focus();await page.keyboard.press('Shift+F10');
 await expect(page.getByRole('menuitem',{name:'Chép dữ liệu',exact:true})).toBeVisible();await expect(page.getByRole('menuitem',{name:'Ẩn các hàng đã chọn',exact:true})).toBeVisible();
 await page.getByRole('menuitem',{name:'Định dạng ô…',exact:true}).click();await expect(page.getByRole('dialog',{name:'Định dạng ô'})).toBeVisible();await expect(page.getByLabel('Định dạng số',{exact:true})).toBeVisible();
 await expect(page.getByRole('dialog')).toContainText('Đổi định dạng số');await page.screenshot({path:'../.verification/canvas-localized-format.png'});
 await page.setViewportSize({width:390,height:844});await page.screenshot({path:'../.verification/canvas-localized-format-mobile.png'});expect(await page.getByRole('dialog').evaluate(el=>{const box=el.getBoundingClientRect();return box.left>=0&&box.right<=innerWidth;})).toBe(true);
 await page.getByRole('button',{name:'Hủy',exact:true}).click();
 await page.keyboard.press('F2');await expect(page.getByRole('textbox')).toHaveValue('1234.5');await page.keyboard.press('Escape');
 expect(await page.evaluate(()=>grid.getValue(0,'amount'))).toBe(1234.5);await page.evaluate(()=>grid.destroy());
});

test('Canvas paste special transposes structured numeric clipboard and format-only preserves values',async({page})=>{
 await page.goto('/');const result=await page.evaluate(async()=>{
  const {createGrid}=await import('/canvas/index.js');const {LocalDataSource,encodeBlocks}=await import('/core/index.js');
  const grid=createGrid({container:document.querySelector('#grid'),dataSource:new LocalDataSource([{id:0,a:1,b:2},{id:1,a:3,b:4}],row=>row.id),columns:['a','b'].map(key=>({key,title:key,editable:true,parse:Number}))});
  grid.selectRow(0);const payload=encodeBlocks([{row:0,column:0,values:[['10','20'],['30','40']],formats:[[{numberFormat:'currency'},{}],[{},{}]]}]);
  grid.pasteSelectionBlocks(payload,{transpose:true,mode:'values'});const values=[grid.getValue(0,'a'),grid.getValue(0,'b'),grid.getValue(1,'a'),grid.getValue(1,'b')];grid.undo();
  grid.selectRow(0);grid.pasteSelectionBlocks(payload,{mode:'formats'});const formatted=grid.getFormat(0,0),value=grid.getValue(0,'a');grid.destroy();return {values,formatted,value};
 });expect(result).toEqual({values:[10,30,20,40],formatted:{numberFormat:'currency'},value:1});
});
