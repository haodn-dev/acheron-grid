import test from 'node:test';
import assert from 'node:assert/strict';
import { createLiveDataSource, createGridEngine } from '@acheron-grid/core';
const snapshot = (streamId='a',sequence=0) => ({streamId,sequence,rows:[{id:'x',values:{value:0}},{id:'y',values:{value:2}}]});
const update = (sequence,value=sequence,rowId='x',streamId='a') => ({streamId,sequence,changes:[{rowId,columnKey:'value',value}]});
test('live cache coalesces bounded updates, stays read-only and refreshes the engine', () => {
  const source=createLiveDataSource({streamId:'a',columnKeys:['value'],maxPendingCells:2});
  source.replaceSnapshot(snapshot());
  const engine=createGridEngine({dataSource:source,columns:[{key:'value',title:'Value'}],permissions:{writable:false}});
  for(let i=1;i<=1000;i++)assert.equal(source.receive(update(i)),true);
  assert.equal(source.pendingCellCount,1);assert.equal(source.getValue(0,'value'),0);
  assert.equal(source.receive(update(1000)),false);assert.equal(source.flush(),1);
  engine.refreshData('values');assert.equal(engine.getValue(0,'value'),1000);
  assert.equal(engine.getCellPermission(0,0).writable,false);
  engine.destroy();source.destroy();assert.throws(()=>source.flush(),/destroyed/);
});
test('gaps, unknown identities and disconnect require authoritative snapshots', () => {
  const source=createLiveDataSource({streamId:'a',columnKeys:['value']});source.replaceSnapshot(snapshot());
  source.receive(update(1));assert.equal(source.receive(update(3)),false);
  assert.equal(source.stale,true);assert.equal(source.flush(),0);assert.equal(source.getValue(0,'value'),0);
  source.replaceSnapshot(snapshot('a',3));assert.equal(source.receive(update(4,4,'missing')),false);
  source.reset('b');assert.equal(source.replaceSnapshot(snapshot('a',99)),false);
  source.replaceSnapshot(snapshot('b',5));assert.equal(source.receive(update(6,6,'x','a')),false);
  source.disconnect();assert.equal(source.receive(update(6,6,'x','b')),false);
  assert.throws(()=>source.replaceSnapshot({streamId:'b',sequence:6,rows:[{id:'x',values:{}}]}),/Invalid live row/);
  assert.equal(source.getValue(0,'value'),0);source.destroy();
});
test('capacity overflow and invalid snapshot never partially publish data', () => {
  const source=createLiveDataSource({streamId:'a',columnKeys:['value'],maxRows:2,maxPendingCells:1});source.replaceSnapshot(snapshot());
  source.receive(update(1));assert.equal(source.receive(update(2,2,'y')),false);assert.equal(source.pendingCellCount,0);
  assert.throws(()=>source.replaceSnapshot({streamId:'a',sequence:2,rows:[...snapshot().rows,{id:'z',values:{value:3}}]}),/Invalid live snapshot/);
  assert.equal(source.getRowCount(),2);assert.equal(source.getValue(0,'value'),0);source.destroy();
});
