import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
const coreFiles = new Set(['index.js', 'viewport.js', 'data-source.js', 'tsv.js', 'axis.js', 'engine.js', 'types.js', 'headless.js', 'permissions.js', 'events.js', 'panes.js', 'structure.js', 'clipboard.js']);
const canvasFiles = new Set(['index.js', 'grid.js', 'links.js', 'headers.js', 'reorder.js', 'choices.js', 'icons.js', 'rich-text.js', 'tooltips.js']);
createServer(async (request, response) => {
  if (request.url === '/adapters.js') {
    try {
      const result = await build({ entryPoints: [fileURLToPath(new URL('./adapters.fixture.mjs', import.meta.url))], bundle: true, write: false, format: 'esm', platform: 'browser', define: { 'process.env.NODE_ENV': '"development"', __VUE_OPTIONS_API__: 'true', __VUE_PROD_DEVTOOLS__: 'false', __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: 'false' } });
      response.setHeader('Content-Type', 'text/javascript'); response.end(result.outputFiles[0].text);
    } catch { response.writeHead(500).end(); }
    return;
  }
  if (request.url === '/') {
    response.setHeader('Content-Type', 'text/html');
    response.end('<!doctype html><script type="importmap">{"imports":{"@acheron-grid/core":"/core/index.js","marked":"/marked.js"}}</script><div id="grid" style="width:640px;height:360px"><span id="existing">Existing content</span></div>');
    return;
  }
  if (request.url === '/marked.js' || request.url === '/markdown/index.js') {
    response.setHeader('Content-Type', 'text/javascript');
    try { response.end(await readFile(new URL(request.url === '/marked.js' ? '../node_modules/marked/lib/marked.esm.js' : '../packages/markdown/dist/index.js', import.meta.url))); }
    catch { response.writeHead(404).end(); }
    return;
  }
  const [, pkg, file] = request.url.split('/');
  if (request.url !== '/' + pkg + '/' + file || !(pkg === 'core' ? coreFiles : pkg === 'canvas' ? canvasFiles : new Set()).has(file)) {
    response.writeHead(404).end(); return;
  }
  response.setHeader('Content-Type', 'text/javascript');
  try { response.end(await readFile(new URL('../packages/' + pkg + '/dist/' + file, import.meta.url))); }
  catch { response.writeHead(404).end(); }
}).listen(4179, '127.0.0.1');
