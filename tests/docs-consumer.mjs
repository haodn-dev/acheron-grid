import ts from 'typescript';
import assert from 'node:assert/strict';
import {readFile,mkdir,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {resolve,sep} from 'node:path';
import {spawnSync} from 'node:child_process';
const manifest=JSON.parse(await readFile('documentation.json','utf8'));
for(const doc of manifest.documents){const text=(await readFile(doc.path,'utf8')).replaceAll('\r\n','\n');assert.equal(createHash('sha256').update(text).digest('hex'),doc.sha256,`Stale docs manifest: ${doc.id}`);}
const synced=spawnSync(process.execPath,['scripts/sync-docs.mjs'],{encoding:'utf8'});
assert.equal(synced.status,0,synced.stderr);
assert.deepEqual(JSON.parse(await readFile('documentation.json','utf8')).documents,manifest.documents,'Unchanged documents must retain revision/date/history.');
await mkdir('test-results',{recursive:true});const directory=await mkdtemp('test-results/docs-consumer-');
try{
 const files=[];
 for(const path of ['guides/getting-started.md','packages/export/README.md','packages/charts/README.md']){
  const text=await readFile(path,'utf8');const code=[...text.matchAll(/```ts\n([\s\S]*?)```/g)][0][1];
  const file=directory+'/'+path.replaceAll('/','-')+'.ts';await writeFile(file,code);files.push(file);
 }
 const core=await readFile('packages/core/README.md','utf8');
 const lifecycle=[...core.matchAll(/```ts\n([\s\S]*?)```/g)].find(([,code])=>code.includes('source.spliceRows'))?.[1];
 assert.ok(lifecycle,'Missing complete lifecycle example.');
 const example=directory+'/core-lifecycle.ts';await writeFile(example,lifecycle);files.push(example);
 const runtime=directory+'/core-lifecycle.mjs';await writeFile(runtime,lifecycle);
 const executed=spawnSync(process.execPath,[runtime],{encoding:'utf8'});assert.equal(executed.status,0,executed.stderr);
 const program=ts.createProgram(files,{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.NodeNext,moduleResolution:ts.ModuleResolutionKind.NodeNext,strict:true,noEmit:true,skipLibCheck:true});
 const diagnostics=ts.getPreEmitDiagnostics(program);assert.equal(diagnostics.length,0,ts.formatDiagnosticsWithColorAndContext(diagnostics,{getCanonicalFileName:path=>path,getCurrentDirectory:()=>process.cwd(),getNewLine:()=> '\n'}));
 for(const name of ['core','canvas']){const catalog=await readFile(`guides/${name}-api.md`,'utf8');for(const method of ['updateCells','refreshData','exportState','destroy'])assert.ok(catalog.includes('### '+method));}
 console.log('PASS: document hashes, four complete TypeScript examples, executable core lifecycle and core/Canvas API catalogs.');
}finally{assert.ok(resolve(directory).startsWith(resolve('test-results')+sep));await rm(directory,{recursive:true,force:true});}
