import {test,expect} from '@playwright/test';
async function setup(page){
 await page.goto('/');await page.evaluate(async()=>{
  const {createGrid}=await import('/canvas/index.js'),{LocalDataSource}=await import('/core/index.js');
  const image=color=>'data:image/svg+xml,'+encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="${color}"/></svg>`);
  window.photos=[{src:image('#ff0000'),alt:'Front'},{src:image('#0000ff'),alt:'Back'},{src:image('#00aa00'),alt:'Detail'},{src:image('#ffaa00'),alt:'Extra'},{src:image('#9933aa'),alt:'Last'}];
  window.people=[{id:'ada',name:'Ada Lovelace',src:image('#ff0000')},{id:'lin',name:'Lin Chen'},{id:'grace',name:'Grace Hopper',src:image('#0000ff')}];
  window.source=new LocalDataSource([{id:1,photos:window.photos,people:window.people},{id:2,photos:[],people:[]}],row=>row.id);
  window.options={container:document.querySelector('#grid'),dataSource:window.source,columns:[{key:'photos',title:'Photos',editable:true},{key:'people',title:'People',editable:true}],imageColumns:['photos'],avatarColumns:['people'],accessibility:'viewport',rowHeight:52,columnWidth:180};
  window.grid=createGrid(window.options);window.selectCell=(row,col)=>{const viewport=document.querySelector('[role=grid]');for(const key of ['Home',...Array(row).fill('ArrowDown'),...Array(col).fill('ArrowRight')])viewport.dispatchEvent(new KeyboardEvent('keydown',{key,ctrlKey:key==='Home',bubbles:true,cancelable:true}));};
 });
}
test('gallery thumbnails and avatar stacks describe values, open details and preserve structured clipboard/history',async({page})=>{
 await setup(page);const viewport=page.getByRole('grid');await viewport.press('Control+Home');
 await expect(page.getByRole('gridcell',{name:/Photos: 5 images/})).toBeAttached();
 await viewport.press('Alt+Enter');const gallery=page.getByRole('dialog',{name:'Cell images'});await expect(gallery.getByRole('img')).toHaveCount(5);await expect(gallery.getByRole('img',{name:'Front'})).toBeVisible();await gallery.getByRole('button',{name:'Close',exact:true}).click();
 const result=await page.evaluate(()=>{window.copy=window.grid.copySelectionBlocks();window.selectCell(1,0);window.grid.pasteSelectionBlocks(window.copy);return window.source.getValue(1,'photos');});expect(result).toEqual(await page.evaluate(()=>window.photos));
 await page.evaluate(()=>window.grid.undo());expect(await page.evaluate(()=>window.source.getValue(1,'photos'))).toEqual([]);await page.evaluate(()=>window.grid.redo());
 await viewport.press('Control+Home');await viewport.press('ArrowRight');await viewport.press('Alt+Enter');const people=page.getByRole('dialog',{name:'Cell people'});await expect(people.getByText('Lin Chen',{exact:true})).toBeVisible();await expect(people.getByRole('img')).toHaveCount(2);await page.keyboard.press('Escape');
 await page.evaluate(()=>{window.peopleCopy=window.grid.copySelectionBlocks();window.selectCell(1,1);window.grid.pasteSelectionBlocks(window.peopleCopy);});expect(await page.evaluate(()=>window.source.getValue(1,'people'))).toEqual(await page.evaluate(()=>window.people));
 await page.evaluate(()=>window.grid.setTheme({background:'#171915',textColor:'#eeefe5',headerBackground:'#292d25',headerTextColor:'#aaaea1'}));await page.screenshot({path:'test-results/media-dark.png'});
});
test('pasted image files create owned temporary URLs and upload callbacks cancel when destination changes',async({page})=>{
 await setup(page);await page.getByRole('grid').press('Control+Home');
 await page.evaluate(()=>{window.revoked=[];const revoke=URL.revokeObjectURL.bind(URL);URL.revokeObjectURL=url=>{window.revoked.push(url);revoke(url);};const data=new DataTransfer();data.items.add(new File([new Uint8Array([1,2,3])],'capture.png',{type:'image/png'}));document.querySelector('[role=grid]').dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));});
 await expect.poll(()=>page.evaluate(()=>window.source.getValue(0,'photos')[0]?.src)).toMatch(/^blob:/);
 const blob=await page.evaluate(()=>window.source.getValue(0,'photos')[0].src);await page.evaluate(()=>window.grid.undo());expect(await page.evaluate(()=>window.source.getValue(0,'photos'))).toEqual(await page.evaluate(()=>window.photos));await page.evaluate(()=>window.grid.redo());expect(await page.evaluate(()=>window.source.getValue(0,'photos')[0].src)).toBe(blob);
 await page.evaluate(async()=>{window.grid.destroy();const {createGrid}=await import('/canvas/index.js');window.alerts=[];window.alert=text=>window.alerts.push(text);window.grid=createGrid({...window.options,mediaOptions:{upload:(file,{signal})=>new Promise(resolve=>{window.resolveUpload=resolve;window.uploadSignal=signal;})}});window.selectCell(0,0);const data=new DataTransfer();data.items.add(new File(['image'],'avatar.png',{type:'image/png'}));document.querySelector('[role=grid]').dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}));});
 expect(await page.evaluate(()=>window.revoked)).toContain(blob);await page.evaluate(()=>{window.selectCell(1,0);window.resolveUpload({src:'https://example.com/avatar.png',alt:'Avatar'});});await expect.poll(()=>page.evaluate(()=>window.alerts.length)).toBe(1);expect(await page.evaluate(()=>window.source.getValue(1,'photos'))).toEqual([]);
});

test('native clipboard cut moves structured media and a locked destination never clears the source',async({page})=>{
 await setup(page);const viewport=page.getByRole('grid');await viewport.press('Control+Home');
 await viewport.evaluate(el=>{window.clipboard=new DataTransfer();el.dispatchEvent(new ClipboardEvent('cut',{clipboardData:window.clipboard,bubbles:true,cancelable:true}));});
 await viewport.press('ArrowDown');await page.evaluate(()=>{window.alerts=[];window.alert=text=>window.alerts.push(text);window.grid.setLocked({scope:'row',rowIndex:1},true);document.querySelector('[role=grid]').dispatchEvent(new ClipboardEvent('paste',{clipboardData:window.clipboard,bubbles:true,cancelable:true}));});
 expect(await page.evaluate(()=>window.alerts.length)).toBe(1);expect(await page.evaluate(()=>window.source.getValue(0,'photos'))).toEqual(await page.evaluate(()=>window.photos));
 await page.evaluate(()=>{window.grid.setLocked({scope:'row',rowIndex:1},false);document.querySelector('[role=grid]').dispatchEvent(new ClipboardEvent('paste',{clipboardData:window.clipboard,bubbles:true,cancelable:true}));});
 expect(await page.evaluate(()=>window.source.getValue(1,'photos'))).toEqual(await page.evaluate(()=>window.photos));expect(await page.evaluate(()=>window.source.getValue(0,'photos'))).toBeNull();
 await page.evaluate(()=>window.grid.undo());expect(await page.evaluate(()=>window.source.getValue(0,'photos'))).toEqual(await page.evaluate(()=>window.photos));expect(await page.evaluate(()=>window.source.getValue(1,'photos'))).toEqual([]);
});
