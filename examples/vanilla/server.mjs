import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';

createServer(async (request, response) => {
  if (request.method !== 'GET') {
    response.writeHead(405).end();
    return;
  }
  const path = new URL(request.url, 'http://127.0.0.1').pathname;
  const module = /^\/(core|canvas)\/((?:internal\/)?[a-z-]+\.js)$/.exec(path);
  const file =
    path === '/'
      ? new URL('./index.html', import.meta.url)
      : path === '/app.js'
        ? new URL('./app.js', import.meta.url)
        : module
          ? new URL(`../../packages/${module[1]}/dist/${module[2]}`, import.meta.url)
          : null;
  if (!file) {
    response.writeHead(404).end();
    return;
  }
  try {
    const body = await readFile(file);
    response
      .writeHead(200, {
        'Content-Type': path === '/' ? 'text/html; charset=utf-8' : 'text/javascript; charset=utf-8',
        'X-Content-Type-Options': 'nosniff',
      })
      .end(body);
  } catch {
    response.writeHead(404).end();
  }
}).listen(4180, '127.0.0.1', () => console.log('Vanilla playground: http://127.0.0.1:4180'));
