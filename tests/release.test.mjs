import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {prepare,check,developVersion,packageOrder} from '../scripts/release.mjs';

test('release preparation aligns all package versions and internal dependencies',async()=>{
 const root=await mkdtemp(join(tmpdir(),'acheron-release-test-'));
 try{
  for(const directory of packageOrder){await mkdir(join(root,'packages',directory),{recursive:true});await writeFile(join(root,'packages',directory,'package.json'),JSON.stringify({name:`@acheron-grid/${directory}`,version:'0.1.0',repository:{url:'git+https://github.com/haodn-dev/acheron-grid.git'},dependencies:{'@acheron-grid/core':'0.1.0',external:'^1.0.0'},peerDependencies:{'@acheron-grid/canvas':'0.1.0'}}));}
  const version=developVersion('0.1.0','123');assert.equal(version,'0.1.1-dev.123');
  await prepare(root,version);assert.equal((await check(root,version)).length,8);
  const path=join(root,'packages/mcp/package.json'),pkg=JSON.parse(await readFile(path,'utf8'));
  assert.equal(pkg.dependencies.external,'^1.0.0');assert.equal(pkg.peerDependencies['@acheron-grid/canvas'],version);
  pkg.dependencies['@acheron-grid/core']='0.1.0';await writeFile(path,JSON.stringify(pkg));await assert.rejects(check(root,version),/must use/);
  await prepare(root,'0.2.0');await check(root,'0.2.0');
  await assert.rejects(prepare(root,'0.2.0;echo bad'),/Use X/);
  assert.throws(()=>developVersion('0.1.0-dev.1',123));assert.throws(()=>developVersion('0.1.0','0'));
 }finally{await rm(root,{recursive:true,force:true});}
});

test('publisher checks every package before writing and resumes matching releases',async()=>{
 const root=await mkdtemp(join(tmpdir(),'acheron-publish-test-'));
 try{
  for(const directory of packageOrder){await mkdir(join(root,'packages',directory),{recursive:true});await writeFile(join(root,'packages',directory,'package.json'),JSON.stringify({name:`@acheron-grid/${directory}`,version:'0.1.1-dev.2',repository:{url:'git+https://github.com/haodn-dev/acheron-grid.git'}}));}
  const mock=join(root,'npm.mjs'),calls=join(root,'calls.txt');
  await writeFile(mock,`import {appendFileSync} from 'node:fs';
const args=process.argv.slice(2);appendFileSync(process.env.CALLS,JSON.stringify(args)+'\\n');
if(args[0]==='pack')console.log(JSON.stringify([{filename:'package.tgz',integrity:'sha512-matching'}]));
else if(args[0]==='view'){
 if(process.env.MODE==='new'){console.error('E404');process.exit(1);}
 console.log(JSON.stringify(process.env.MODE==='mismatch'?'sha512-other':'sha512-matching'));
}else if(args[0]==='publish')console.log('published');else process.exit(2);
`);
  const script=fileURLToPath(new URL('../scripts/release.mjs',import.meta.url));
  function run(mode){return spawnSync(process.execPath,[script,'publish','0.1.1-dev.2','develop'],{cwd:root,encoding:'utf8',env:{...process.env,npm_execpath:mock,CALLS:calls,MODE:mode}});}
  let result=run('new');assert.equal(result.status,0,result.stderr);
  let log=(await readFile(calls,'utf8')).trim().split('\n').map(JSON.parse);
  assert.equal(log.filter(args=>args[0]==='publish').length,8);assert.equal(log.findIndex(args=>args[0]==='publish'),16);
  await writeFile(calls,'');result=run('same');assert.equal(result.status,0,result.stderr);assert.ok(!(await readFile(calls,'utf8')).includes('publish'));
  await writeFile(calls,'');result=run('mismatch');assert.notEqual(result.status,0);assert.match(result.stderr,/different contents/);assert.ok(!(await readFile(calls,'utf8')).includes('publish'));
 }finally{await rm(root,{recursive:true,force:true});}
});
