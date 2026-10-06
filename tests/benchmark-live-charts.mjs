import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { execFileSync } from 'node:child_process';
import { createLiveDataSource } from '@acheron-grid/core';
import { chartGeometry } from '@acheron-grid/charts';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('../',import.meta.url)).replace(/[\\/]$/,'');
const revision=execFileSync('git',['-c',`safe.directory=${root.replace(/\\/g,'/')}`, 'rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
const samples=[];
for(const count of [1000,10000])for(let trial=0;trial<3;trial++) {
  const live=createLiveDataSource({streamId:'bench',columnKeys:['value'],maxRows:count,maxPendingCells:count});
  live.replaceSnapshot({streamId:'bench',sequence:0,rows:Array.from({length:count},(_,id)=>({id,values:{value:0}}))});
  let start=performance.now();
  for(let i=0;i<count;i++)assert.equal(live.receive({streamId:'bench',sequence:i+1,changes:[{rowId:i,columnKey:'value',value:i+1}]}),true);
  const receiveMs=performance.now()-start;assert.equal(live.pendingCellCount,count);
  start=performance.now();assert.equal(live.flush(),count);const flushMs=performance.now()-start;
  for(let i=0;i<count;i++)assert.equal(live.getValue(i,'value'),i+1);
  assert.equal(live.receive({streamId:'bench',sequence:count+2,changes:[]}),false);assert.equal(live.stale,true);live.destroy();
  start=performance.now();let points=0;
  for(let i=0;i<count;i++){const result=chartGeometry([0,1,null,3,-1,2],180,40,'column');assert.equal(result.baseline,30);points+=result.count;}
  samples.push({count,trial,receiveMs,flushMs,chartGeometryMs:performance.now()-start,points,peakPendingCells:count});
}
console.log(JSON.stringify({revision,node:process.version,platform:process.platform,arch:process.arch,workload:'bounded live batches and inline chart geometry',limitations:'CPU wall time including assertions; no Canvas, DPR, FPS, GPU, peak memory or warmup. Compare only identical environments/workloads.',samples},null,2));
