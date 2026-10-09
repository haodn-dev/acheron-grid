import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
const coreFiles = new Set([
  'worker.js',
  'worker-entry.js',
  'paged-remote-data-source.js',
  'internal/remote-json.js',
  'internal/bulk.js',
  'internal/history-budget.js',
  'internal/local-view-steps.js',
  'internal/persistence.js',
  'internal/clipboard.js',
  'internal/selection.js',
  'internal/projection.js',
  'internal/outline.js',
  'internal/layout.js',
  'internal/values.js',
  'internal/formatting.js',
  'internal/permissions.js',
  'internal/structure.js',
  'internal/structure-mapping.js',
  'internal/history.js',
  'index.js',
  'viewport.js',
  'data-source.js',
  'async-data-source.js',
  'live-data-source.js',
  'remote-data-source.js',
  'state.js',
  'tsv.js',
  'axis.js',
  'engine.js',
  'types.js',
  'headless.js',
  'permissions.js',
  'events.js',
  'panes.js',
  'structure.js',
  'clipboard.js',
  'configuration.js',
]);
const canvasFiles = new Set([
  'internal/editor-config.js',
  'internal/rendering.js',
  'internal/menus.js',
  'internal/accessibility.js',
  'internal/interaction.js',
  'internal/editors.js',
  'internal/media-controller.js',
  'internal/clipboard.js',
  'internal/search.js',
  'internal/overlay.js',
  'internal/motion.js',
  'internal/display.js',
  'internal/reorder-geometry.js',
  'index.js',
  'grid.js',
  'media.js',
  'media-editor.js',
  'links.js',
  'headers.js',
  'reorder.js',
  'choices.js',
  'icons.js',
  'rich-text.js',
  'tooltips.js',
  'locale.js',
]);
createServer(async (request, response) => {
  if (request.url === '/adapters.js') {
    try {
      const result = await build({
        entryPoints: [fileURLToPath(new URL('./adapters.fixture.mjs', import.meta.url))],
        bundle: true,
        write: false,
        format: 'esm',
        platform: 'browser',
        define: {
          'process.env.NODE_ENV': '"development"',
          __VUE_OPTIONS_API__: 'true',
          __VUE_PROD_DEVTOOLS__: 'false',
          __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: 'false',
        },
      });
      response.setHeader('Content-Type', 'text/javascript');
      response.end(result.outputFiles[0].text);
    } catch {
      response.writeHead(500).end();
    }
    return;
  }
  if (request.url === '/') {
    response.setHeader('Content-Type', 'text/html');
    response.end(
      '<!doctype html><script type="importmap">{"imports":{"@acheron-grid/core":"/core/index.js","marked":"/marked.js"}}</script><div id="grid" style="width:640px;height:360px"><span id="existing">Existing content</span></div>',
    );
    return;
  }
  if (request.url === '/marked.js' || request.url === '/markdown/index.js') {
    response.setHeader('Content-Type', 'text/javascript');
    try {
      response.end(
        await readFile(
          new URL(
            request.url === '/marked.js'
              ? '../node_modules/marked/lib/marked.esm.js'
              : '../packages/markdown/dist/index.js',
            import.meta.url,
          ),
        ),
      );
    } catch {
      response.writeHead(404).end();
    }
    return;
  }
  const [, pkg, ...segments] = request.url.split('/');
  const file = segments.join('/');
  if (
    request.url !== '/' + pkg + '/' + file ||
    !(
      pkg === 'core' ? coreFiles : pkg === 'canvas' ? canvasFiles : pkg === 'charts' ? new Set(['index.js']) : new Set()
    ).has(file)
  ) {
    response.writeHead(404).end();
    return;
  }
  response.setHeader('Content-Type', 'text/javascript');
  try {
    response.end(await readFile(new URL('../packages/' + pkg + '/dist/' + file, import.meta.url)));
  } catch {
    response.writeHead(404).end();
  }
}).listen(4179, '127.0.0.1');
