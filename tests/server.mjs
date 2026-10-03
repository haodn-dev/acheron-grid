import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
const coreFiles = new Set(['index.js', 'viewport.js', 'data-source.js', 'tsv.js', 'axis.js', 'engine.js', 'types.js', 'headless.js', 'permissions.js', 'events.js', 'panes.js', 'structure.js', 'clipboard.js']);
const canvasFiles = new Set(['index.js', 'grid.js', 'links.js', 'headers.js', 'reorder.js', 'choices.js']);
createServer(async (request, response) => {
  if (request.url === '/') {
    response.setHeader('Content-Type', 'text/html');
    response.end('<!doctype html><script type="importmap">{"imports":{"@acheron-grid/core":"/core/index.js"}}</script><div id="grid" style="width:640px;height:360px"><span id="existing">Existing content</span></div>');
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
