import { test, expect } from '@playwright/test';

test('Canvas configuration restores rendered layout and local view and rejects host-owned view', async ({page}) => {
  const errors=[]; page.on('pageerror',error=>errors.push(error.message));
  await page.goto('/');
  const result=await page.evaluate(async()=>{
    const {createGrid}=await import('/canvas/index.js');
    const {LocalDataSource,restoreGridConfiguration}=await import('/core/index.js');
    const columns=[{key:'name',title:'Name'},{key:'score',title:'Score'}];
    const dataSource=new LocalDataSource([{id:1,name:'Ada',score:2},{id:2,name:'Grace',score:1}],row=>row.id);
    const container=document.querySelector('#grid');
    let grid=createGrid({container,columns,dataSource,accessibility:'viewport',motion:false});
    grid.moveColumns([1],0); grid.setColumnWidth(0,210);grid.setFrozen(1,1);
    grid.setView({filters:[{columnKey:'name',query:'Ada',operator:'equals'}]});
    const saved=JSON.parse(JSON.stringify(grid.exportConfiguration()));grid.destroy();
    grid=createGrid({container,dataSource,accessibility:'viewport',...restoreGridConfiguration(saved,columns,2)});
    window.grid=grid;
    return {saved,restored:grid.exportConfiguration()};
  });
  expect(result.restored).toEqual(result.saved);
  await expect(page.getByRole('columnheader').first()).toHaveAttribute('aria-label','Score');
  await expect(page.getByRole('gridcell',{name:'Name: Ada',exact:true})).toBeAttached();
  await expect(page.getByRole('gridcell',{name:'Name: Grace',exact:true})).toHaveCount(0);
  expect(await page.evaluate(async()=>{
    window.grid.destroy();
    let destroyed=false;try{window.grid.exportConfiguration();}catch{destroyed=true;}
    const {createGrid}=await import('/canvas/index.js');
    const host=createGrid({container:document.querySelector('#grid'),columns:[{key:'a',title:'A'}],dataSource:{getRowCount:()=>0,getRowId:()=>0,getValue:()=>''},viewMode:'host'});
    let rejected=false;try{host.exportConfiguration();}catch{rejected=true;}host.destroy();return {destroyed,rejected};
  })).toEqual({destroyed:true,rejected:true});
  expect(errors).toEqual([]);
});
