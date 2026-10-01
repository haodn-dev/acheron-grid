import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
const files = new Set(['index.js', 'grid.js', 'viewport.js', 'data-source.js']);
createServer(async (request, response) => {
  if (request.url === '/') {
    response.setHeader('Content-Type', 'text/html');
    response.end('<!doctype html><div id="grid" style="width:640px;height:360px"><span id="existing">Existing content</span></div>');
    return;
  }
  const file = request.url.slice(1);
  if (!files.has(file)) { response.writeHead(404).end(); return; }
  response.setHeader('Content-Type', 'text/javascript');
  response.end(await readFile(new URL(`../packages/core/dist/${file}`, import.meta.url)));
}).listen(4179, '127.0.0.1');
