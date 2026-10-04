import {test,expect} from '@playwright/test';
async function setup(page) {
 await page.goto('/');await page.evaluate(async()=>{
  const {createGrid}=await import('/canvas/index.js');const {LocalDataSource}=await import('/core/index.js');
  window.source=new LocalDataSource([{id:1,a:'First',b:'One'},{id:2,a:'Second',b:'Two'},{id:3,a:'Third',b:'Three'}],row=>row.id);
  window.grid=createGrid({container:document.querySelector('#grid'),dataSource:window.source,columns:[{key:'a',title:'A',editable:true},{key:'b',title:'B',editable:true}],motion:false,rowHeight:32,columnWidth:160});
 });await page.getByRole('grid').click({position:{x:10,y:10}});
}
test('native cut moves one cell atomically and a later paste copies without clearing again',async({page})=>{
 await setup(page);const viewport=page.getByRole('grid');
 await viewport.evaluate(el=>{window.clipboard=new DataTransfer();el.dispatchEvent(new ClipboardEvent('cut',{bubbles:true,cancelable:true,clipboardData:window.clipboard}));});
 expect(await page.evaluate(()=>window.source.getValue(0,'a'))).toBe('First');
 await viewport.click({position:{x:170,y:45}});
 await viewport.evaluate(el=>el.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:window.clipboard})));
 expect(await page.evaluate(()=>[window.source.getValue(0,'a'),window.source.getValue(1,'b')])).toEqual([null,'First']);
 await viewport.press('Control+z');expect(await page.evaluate(()=>[window.source.getValue(0,'a'),window.source.getValue(1,'b')])).toEqual(['First','Two']);
 await viewport.click({position:{x:170,y:75}});await viewport.evaluate(el=>el.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:window.clipboard})));
 expect(await page.evaluate(()=>[window.source.getValue(0,'a'),window.source.getValue(2,'b')])).toEqual(['First','First']);
});
test('one-cell rich copy fills a range and Cut is available in the searchable menu',async({page})=>{
 await setup(page);const viewport=page.getByRole('grid');
 await page.evaluate(()=>{window.grid.format([{scope:'cell',rowIndex:0,columnIndex:0}],{fontWeight:'bold'});window.payload=window.grid.copySelectionBlocks();});
 await viewport.click({position:{x:170,y:45}});await viewport.press('Shift+ArrowDown');await page.evaluate(()=>window.grid.pasteSelectionBlocks(window.payload));
 expect(await page.evaluate(()=>[window.source.getValue(1,'b'),window.source.getValue(2,'b'),window.grid.getFormat(2,1).fontWeight])).toEqual(['First','First','bold']);
 await viewport.click({button:'right',position:{x:170,y:45}});await expect(page.getByRole('menuitem',{name:'Cut',exact:true})).toBeEnabled();
});
test('Escape cancels pending cut and blocked paste never deletes the source',async({page})=>{
 await setup(page);const viewport=page.getByRole('grid');await page.evaluate(()=>{window.payload=window.grid.cutSelectionBlocks();window.grid.setLocked({scope:'cell',rowIndex:1,columnIndex:1},true);});
 await viewport.click({position:{x:170,y:45}});expect(await page.evaluate(()=>{try{window.grid.pasteSelectionBlocks(window.payload);return false;}catch{return true;}})).toBe(true);
 expect(await page.evaluate(()=>window.source.getValue(0,'a'))).toBe('First');await viewport.press('Escape');
 await page.evaluate(()=>{window.grid.setLocked({scope:'cell',rowIndex:1,columnIndex:1},false);window.grid.pasteSelectionBlocks(window.payload);});
 expect(await page.evaluate(()=>window.source.getValue(0,'a'))).toBe('First');
});

test('Ctrl+X and Ctrl+V move through the browser clipboard',async({page,context})=>{
 await context.grantPermissions(['clipboard-read','clipboard-write']);await setup(page);const viewport=page.getByRole('grid');
 await viewport.press('Control+x');await expect.poll(()=>page.evaluate(()=>navigator.clipboard.readText())).toBe('First');
 await viewport.click({position:{x:170,y:45}});await viewport.press('Control+v');
 await expect.poll(()=>page.evaluate(()=>[window.source.getValue(0,'a'),window.source.getValue(1,'b')])).toEqual([null,'First']);
});

test('pasting a multiline block selects the entire destination and rejected paste preserves selection',async({page})=>{
 await setup(page);const viewport=page.getByRole('grid');await viewport.press('Shift+ArrowDown');await viewport.press('Shift+ArrowDown');
 await page.evaluate(()=>{window.payload=window.grid.copySelectionBlocks();});await viewport.click({position:{x:170,y:10}});await page.evaluate(()=>window.grid.pasteSelectionBlocks(window.payload));
 expect(await page.evaluate(()=>window.grid.getSelectionRange())).toEqual({startRow:0,endRow:2,startColumn:1,endColumn:1});
 await viewport.click({position:{x:170,y:75}});await page.evaluate(()=>{try{window.grid.pasteSelectionBlocks(window.payload);}catch{}});
 expect(await page.evaluate(()=>window.grid.getSelectionRange())).toEqual({startRow:2,endRow:2,startColumn:1,endColumn:1});
});
