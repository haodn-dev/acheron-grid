import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { build } from 'esbuild';
import { chromium } from '@playwright/test';
import { packageOrder } from '../scripts/release.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const consumer = await mkdtemp(join(tmpdir(), 'acheron-consumer-'));
const npm = process.env.npm_execpath;
if (!npm) throw new Error('Run through npm run test:package.');
function run(args, cwd = consumer) {
  const result = spawnSync(process.execPath, args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr + '\n' + result.stdout);
  return result.stdout;
}
console.log('Independent packed consumer:', consumer);
const version = process.env.ACHERON_RELEASE_VERSION;
if (version && !/^\d+\.\d+\.\d+(?:-dev\.\d+)?$/.test(version)) throw new Error('Invalid registry release version.');
const packed = version
  ? packageOrder.map((name) => ({ filename: `@acheron-grid/${name}@${version}` }))
  : JSON.parse(run([npm, 'pack', '--workspaces', '--json', '--pack-destination', consumer], root));
await writeFile(join(consumer, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
run([
  npm,
  'install',
  '--ignore-scripts',
  version ? '--prefer-online' : '--prefer-offline',
  '--registry=https://registry.npmjs.org',
  '--no-audit',
  '--no-fund',
  ...packed.map((item) => (version ? item.filename : join(consumer, item.filename))),
  'typescript@5.9.3',
  'react@19.1.0',
  'react-dom@19.1.0',
  '@types/react@18.3.31',
  'vue@3.5.43',
]);
await writeFile(
  join(consumer, 'index.ts'),
  `
import {createGridEngine,LocalDataSource,createAsyncDataSource} from '@acheron-grid/core';
import {createTsvWorker} from '@acheron-grid/core/worker';
if (false) {
const decoder = createTsvWorker(() => new Worker(new URL('@acheron-grid/core/worker-entry', import.meta.url), {type:'module'}));
const workerBulk = {yieldControl: async () => {}, tsvDecoder: decoder, signal: new AbortController().signal};
createGridEngine({dataSource:new LocalDataSource([{value:'old'}],(_,i)=>i),columns:[{key:'value',title:'Value',editable:true}]}).pasteAsync('new',workerBulk);
decoder.destroy();
}
import {createGrid} from '@acheron-grid/canvas';
import {AcheronGrid as ReactGrid} from '@acheron-grid/react';
import {AcheronGrid as VueGrid} from '@acheron-grid/vue';
import {markdownToHtml} from '@acheron-grid/markdown';
import {createGridMcpServer} from '@acheron-grid/mcp';
import type {GridMcpOptions} from '@acheron-grid/mcp';
const revisionOptions: GridMcpOptions = {getRevision: () => 'session:1'};
createGridMcpServer(revisionOptions);
import {exportSelectionCsv,exportSelectionXlsx} from '@acheron-grid/export';
import {createChartRenderer,chartGeometry} from '@acheron-grid/charts';
import type {ChartOptions,ChartKind,ChartPoint} from '@acheron-grid/charts';
const chartKind: ChartKind = 'area';
const chartOptions: ChartOptions = {kind:chartKind,curve:'smooth',domain:[0,10],threshold:5,thresholdColor:'#64748b',highlight:['min','max','last'],highlightColor:'#059669',markerRadius:0,fillOpacity:0.2,showBaseline:true,lineWidth:2,color:'#2563eb'};
createChartRenderer({trend:chartOptions,legacy:'line'});
const chartPoint: ChartPoint = chartGeometry([0,5,10],100,40,chartKind,[0,10]).points[1]!;
// @ts-expect-error Unsupported chart kinds must remain a type error.
createChartRenderer({trend:'pie'});
// @ts-expect-error Unsupported highlight modes must remain a type error.
createChartRenderer({trend:{kind:'line',highlight:['first']}});
export {createGridEngine,LocalDataSource,createAsyncDataSource,createGrid,ReactGrid,VueGrid,markdownToHtml,createGridMcpServer,exportSelectionCsv,exportSelectionXlsx};
export {createChartRenderer,chartGeometry};
const remote=createAsyncDataSource({query:{sorts:[{columnKey:'a',direction:'asc'}]},createAbortController:()=>new AbortController(),load:async ({query})=>({total:1,rows:[{a:query.sorts?.[0]?.direction}]})});
remote.setQuery({filters:[{columnKey:'a',query:'ok'}]});
`,
);
run([
  join(consumer, 'node_modules/typescript/bin/tsc'),
  'index.ts',
  '--noEmit',
  '--strict',
  '--module',
  'NodeNext',
  '--target',
  'ES2022',
  '--skipLibCheck',
  'false',
]);
await writeFile(
  join(consumer, 'runtime.mjs'),
  `
import assert from 'node:assert/strict';
import {createGridEngine,LocalDataSource,createAsyncDataSource} from '@acheron-grid/core';
import {createElement} from 'react';import {renderToString} from 'react-dom/server';
import {createSSRApp,h} from 'vue';import {renderToString as vueRender} from 'vue/server-renderer';
import {AcheronGrid as ReactGrid} from '@acheron-grid/react';import {AcheronGrid as VueGrid} from '@acheron-grid/vue';
import {markdownToHtml} from '@acheron-grid/markdown';import {createGridMcpServer} from '@acheron-grid/mcp';
import {exportSelectionCsv,exportSelectionXlsx} from '@acheron-grid/export';
import {chartGeometry,createChartRenderer} from '@acheron-grid/charts';
assert.deepEqual(chartGeometry([0,5,10],100,40,'area',[0,10]).points,[{x:0,y:40},{x:50,y:20},{x:100,y:0}]);
assert.doesNotThrow(()=>createChartRenderer({trend:{kind:'area',curve:'smooth',domain:[0,10],threshold:5,highlight:['min','max','last']}}));
assert.throws(()=>createChartRenderer({trend:{kind:'area',domain:[1,10]}}),RangeError);
const options={columns:[{key:'a',title:'A',editable:true}],dataSource:new LocalDataSource([{a:'old'}],(_,i)=>i)};
const remote=createAsyncDataSource({createAbortController:()=>new AbortController(),load:async ({query})=>({total:1,rows:[{a:query.filters[0].query}]})});remote.setQuery({filters:[{columnKey:'a',query:'ok'}]});await remote.loadPage(0);assert.equal(remote.getValue(0,'a'),'ok');remote.destroy();
const engine=createGridEngine(options);engine.editCell(0,0,'new');assert.equal(engine.getValue(0,'a'),'new');engine.undo();assert.equal(engine.getValue(0,'a'),'old');engine.select(0,0);assert.equal(exportSelectionCsv(engine,{includeHeaders:true}),'A\\r\\nold');assert.equal(exportSelectionXlsx(engine)[0],80);engine.replaceText('old','replaced');assert.equal(engine.getValue(0,'a'),'replaced');engine.destroy();
assert.match(renderToString(createElement(ReactGrid,{options})),/div/);assert.match(await vueRender(createSSRApp({render:()=>h(VueGrid,{options})})),/div/);assert.match(markdownToHtml('**ok**'),/strong/);await createGridMcpServer({documents:{core:'test'}}).close();
`,
);
run(['runtime.mjs']);
await writeFile(
  join(consumer, 'browser.js'),
  `
import {createGrid} from '@acheron-grid/canvas';import {LocalDataSource} from '@acheron-grid/core';
import {createTsvWorker} from '@acheron-grid/core/worker';
window.createTsvWorker=createTsvWorker;
import {exportSelectionCsv,exportSelectionXlsx} from '@acheron-grid/export';
import {createChartRenderer} from '@acheron-grid/charts';
const renderer=createChartRenderer({trend:'line'});window.chartDraws=0;
window.grid=createGrid({container:document.querySelector('#grid'),columns:[{key:'a',title:'A',editable:true},{key:'trend',title:'Trend'}],dataSource:new LocalDataSource([{a:'old',trend:[1,3,null,2]}],(_,i)=>i),renderCell:(ctx,cell)=>{const handled=renderer(ctx,cell);if(handled)window.chartDraws++;return handled;}});
window.exportCsv=()=>exportSelectionCsv(window.grid);
window.exportXlsx=()=>exportSelectionXlsx(window.grid);
`,
);
await build({
  entryPoints: [join(consumer, 'browser.js')],
  outfile: join(consumer, 'bundle.js'),
  bundle: true,
  platform: 'browser',
});
await writeFile(join(consumer, 'worker.js'), "import '@acheron-grid/core/worker-entry';");
const workerBundle = await build({
  entryPoints: [join(consumer, 'worker.js')],
  bundle: true,
  write: false,
  platform: 'browser',
  format: 'esm',
});
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  await page.route('http://packed-consumer.test/', (route) =>
    route.fulfill({
      contentType: 'text/html',
      body: '<div id="grid" style="width:600px;height:300px"></div>',
    }),
  );
  await page.goto('http://packed-consumer.test/');
  await page.addScriptTag({ content: await readFile(join(consumer, 'bundle.js'), 'utf8') });
  await page.getByRole('grid').waitFor();
  await page.getByRole('grid').click({ position: { x: 40, y: 16 } });
  await page.evaluate(async (workerSource) => {
    window.grid.updateCells([{ rowIndex: 0, columnKey: 'a', value: 'new' }]);
    if (window.exportCsv() !== 'new') throw new Error('Packed CSV export failed.');
    if (!window.chartDraws) throw new Error('Packed chart renderer was not called.');
    const url = URL.createObjectURL(new Blob([workerSource], { type: 'text/javascript' }));
    const decoder = window.createTsvWorker(() => new Worker(url, { type: 'module' }));
    try {
      await window.grid.pasteAsync('worker', { tsvDecoder: decoder, yieldControl: async () => {} });
      if (window.grid.getValue(0, 'a') !== 'worker') throw new Error('Packed Worker paste failed.');
      window.grid.undo();
      if (window.grid.getValue(0, 'a') !== 'new') throw new Error('Packed Worker undo failed.');
    } finally {
      decoder.destroy();
      URL.revokeObjectURL(url);
    }
    window.grid.destroy();
  }, workerBundle.outputFiles[0].text);
  if (await page.getByRole('grid').count()) throw new Error('Packed grid cleanup failed.');
} finally {
  await browser.close();
}
console.log(
  'PASS:',
  packed.length,
  'packed packages, strict TypeScript consumer, headless/React/Vue SSR, Markdown/MCP/CSV imports and browser mount/update/export/destroy.',
);
