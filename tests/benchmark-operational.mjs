import assert from 'node:assert/strict';
import {performance} from 'node:perf_hooks';
import {execFileSync} from 'node:child_process';
import {createGridEngine,LocalDataSource,createAsyncDataSource,createLiveDataSource} from '@acheron-grid/core';

const runs=[];
for(let trial=0;trial<3;trial++){
 const timings={};const measure=(name,run)=>{const start=performance.now();const value=run();timings[name]=performance.now()-start;return value;};
 const count=10_000,rows=Array.from({length:count},(_,id)=>({id,score:(id*7919)%count,text:`row-${id}`}));
 const source=new LocalDataSource(rows,row=>row.id);
 const engine=createGridEngine({dataSource:source,columns:[{key:'score',title:'Score',editable:true},{key:'text',title:'Text',editable:true}]});
 measure('groupAndMerge',()=>{for(let i=0;i<50;i++){engine.groupRows(i*100,i*100+9);engine.mergeCells({startRow:5000+i*4,endRow:5001+i*4,startColumn:0,endColumn:0});}});
 measure('outlineSort',()=>engine.setView({sort:{columnKey:'score',direction:'asc'}}));
 const blocks=[];for(let i=0;i<count;){const end=i<5000&&i%100===0?i+9:i>=5000&&i<5200&&(i-5000)%4===0?i+1:i;blocks.push(Array.from({length:end-i+1},(_,n)=>i+n));i=end+1;}
 const expected=blocks.sort((a,b)=>rows[a[0]].score-rows[b[0]].score||a[0]-b[0]).flat();
 assert.deepEqual(Array.from({length:count},(_,i)=>engine.getRowId(i)),expected);
 measure('outlineUpdate',()=>engine.updateCells([{rowIndex:0,columnKey:'score',value:-1}]));
 assert.equal(source.getValue(expected[0],'score'),-1);assert.equal(engine.undo(),true);
 measure('outlineFilter',()=>engine.setView({filters:[{columnKey:'text',query:'row-7',operator:'contains'}]}));
 const wanted=blocks.filter(block=>block.some(id=>rows[id].text.includes('row-7'))).flat().sort((a,b)=>a-b);
 assert.deepEqual(Array.from({length:engine.rowCount},(_,i)=>engine.getRowId(i)),wanted);engine.destroy();
 const fragmented=createGridEngine({dataSource:source,columns:[{key:'score',title:'Score'},{key:'text',title:'Text'}]});
 fragmented.selectRange({startRow:0,endRow:4999,startColumn:0,endColumn:0});
 measure('selectionSort',()=>fragmented.setView({sort:{columnKey:'score',direction:'asc'}}));
 const ranges=measure('fragmentedRanges',()=>fragmented.getSelectionRanges());
 assert.equal(ranges.reduce((n,r)=>n+r.endRow-r.startRow+1,0),5000);
 for(const range of ranges)for(let row=range.startRow;row<=range.endRow;row++)assert.ok(fragmented.getRowId(row)<5000);
 const fragmentCount=ranges.length;fragmented.destroy();
 let active=0,maxActive=0,loads=0;const remote=createAsyncDataSource({rowCount:100_000,pageSize:100,maxPages:4,maxConcurrentLoads:2,maxPendingLoads:4,createAbortController:()=>new AbortController(),load:async({offset,limit,signal})=>{
  active++;maxActive=Math.max(maxActive,active);loads++;await Promise.resolve();active--;if(signal.aborted)throw new Error('Aborted');return {total:100_000,rows:Array.from({length:limit},(_,i)=>({value:offset+i}))};
 }});
 const remoteStart=performance.now();
 for(let round=0;round<40;round++){
  const offset=round*400;await remote.loadRange(offset,offset+399);
  assert.equal(remote.getValue(offset,'value'),offset);if(round)assert.equal(remote.getValue(offset-400,'value'),undefined);
  const ready=Array.from({length:400},(_,i)=>i*100).filter(offset=>remote.getPageState(offset)?.status==='ready');assert.equal(ready.length,4);
 }
 const previousLoads=loads;await remote.loadPage(15600);assert.equal(loads,previousLoads);
 remote.setQuery({sort:{columnKey:'value',direction:'desc'}},100_000);assert.equal(remote.getValue(15600,'value'),undefined);
 await remote.loadPage(0);assert.equal(remote.getValue(0,'value'),0);assert.ok(maxActive<=2);remote.destroy();remote.destroy();
 timings.remoteCacheChurn=performance.now()-remoteStart;
 const live=createLiveDataSource({streamId:'operational',columnKeys:['value'],maxRows:1000,maxPendingCells:1000});
 live.replaceSnapshot({streamId:'operational',sequence:0,rows:Array.from({length:1000},(_,id)=>({id,values:{value:0}}))});
 measure('liveCoalescing',()=>{for(let i=1;i<=10_000;i++)assert.equal(live.receive({streamId:'operational',sequence:i,changes:[{rowId:(i-1)%1000,columnKey:'value',value:i}]}),true);});
 assert.equal(live.pendingCellCount,1000);measure('liveFlush',()=>assert.equal(live.flush(),1000));
 for(let i=0;i<1000;i++)assert.equal(live.getValue(i,'value'),9001+i);
 assert.equal(live.receive({streamId:'operational',sequence:10002,changes:[]}),false);assert.equal(live.stale,true);live.destroy();
 runs.push({trial,timings,fragmentCount,loads,maxActive});
}
console.log(JSON.stringify({schemaVersion:1,revision:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),node:process.version,platform:process.platform,runs,limitations:'Three sequential CPU trials including assertion cost where indicated. In-memory remote loader; no network latency, device, FPS, peak memory or timing threshold.'},null,2));
