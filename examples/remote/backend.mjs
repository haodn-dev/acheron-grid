import { readFile } from 'node:fs/promises';

export function createRemoteDemoHandler() {
  let revision = 1,
    mode = 'normal';
  let rows = [
    { id: 'one', values: { title: 'Review documentation' } },
    { id: 'two', values: { title: 'Check release settings' } },
  ];
  const receipts = new Map();
  const snapshot = () => ({ datasetId: 'demo', revision: String(revision), rows: structuredClone(rows) });
  const json = (response, status, value) =>
    response
      .writeHead(status, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      })
      .end(JSON.stringify(value));
  return async (request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1:4180');
    if (!url.pathname.startsWith('/remote/')) return false;
    const files = { '/remote/': 'index.html', '/remote/app.js': 'app.js' };
    if (request.method === 'GET' && files[url.pathname]) {
      const body = await readFile(new URL(files[url.pathname], import.meta.url));
      response
        .writeHead(200, {
          'Content-Type': url.pathname.endsWith('.js') ? 'text/javascript' : 'text/html; charset=utf-8',
          'X-Content-Type-Options': 'nosniff',
        })
        .end(body);
      return true;
    }
    if (request.method === 'GET' && url.pathname === '/remote/api/snapshot') {
      json(response, 200, snapshot());
      return true;
    }
    if (request.method !== 'POST' || !['/remote/api/write', '/remote/api/control'].includes(url.pathname)) {
      json(response, 404, { error: 'Not found' });
      return true;
    }
    if (
      (request.headers.origin && request.headers.origin !== 'http://127.0.0.1:4180') ||
      request.headers['content-type'] !== 'application/json'
    ) {
      json(response, 403, { error: 'Denied' });
      return true;
    }
    try {
      const chunks = [];
      let size = 0;
      for await (const chunk of request) {
        size += chunk.length;
        if (size > 16384) throw Error('Request too large');
        chunks.push(chunk);
      }
      const input = JSON.parse(Buffer.concat(chunks).toString());
      if (url.pathname === '/remote/api/control') {
        if (!input || typeof input !== 'object') throw Error('Invalid control');
        if (input.mode !== undefined) {
          if (!['normal', 'reject', 'drop'].includes(input.mode)) throw Error('Invalid mode');
          mode = input.mode;
        }
        if (input.external === true) {
          rows[0].values.title = 'Server edit';
          revision++;
        }
        json(response, 200, snapshot());
        return true;
      }
      if (
        !input ||
        input.datasetId !== 'demo' ||
        typeof input.mutationId !== 'string' ||
        !input.mutationId.length ||
        input.mutationId.length > 256 ||
        typeof input.expectedRevision !== 'string' ||
        !Array.isArray(input.changes) ||
        !input.changes.length ||
        input.changes.length > 100
      )
        throw Error('Invalid mutation');
      const fingerprint = JSON.stringify(input),
        prior = receipts.get(input.mutationId);
      if (prior) {
        if (prior.fingerprint !== fingerprint) throw Error('Mutation ID reused');
        json(response, 200, prior.result);
        return true;
      }
      if (receipts.size >= 100) throw Error('Restart demo to clear receipt limit');
      const seen = new Set();
      for (const change of input.changes) {
        if (
          !change ||
          !rows.some((row) => row.id === change.rowId) ||
          change.columnKey !== 'title' ||
          typeof change.previous !== 'string' ||
          typeof change.value !== 'string' ||
          !change.value.trim() ||
          change.value.length > 200 ||
          seen.has(change.rowId)
        )
          throw Error('Invalid or unauthorized change');
        seen.add(change.rowId);
      }
      let result;
      if (
        input.expectedRevision !== String(revision) ||
        input.changes.some((change) => rows.find((row) => row.id === change.rowId).values.title !== change.previous)
      )
        result = { mutationId: input.mutationId, status: 'conflict', snapshot: snapshot() };
      else if (mode === 'reject')
        result = {
          datasetId: 'demo',
          mutationId: input.mutationId,
          status: 'rejected',
          message: 'Server rejected this edit; correct or retry the draft.',
        };
      else {
        const next = structuredClone(rows);
        for (const change of input.changes) next.find((row) => row.id === change.rowId).values.title = change.value;
        rows = next;
        revision++;
        result = {
          mutationId: input.mutationId,
          status: 'accepted',
          delta: {
            datasetId: 'demo',
            baseRevision: input.expectedRevision,
            revision: String(revision),
            cells: input.changes.map((change) => ({
              rowId: change.rowId,
              columnKey: change.columnKey,
              value: rows.find((row) => row.id === change.rowId).values[change.columnKey],
            })),
          },
        };
      }
      receipts.set(input.mutationId, { fingerprint, result });
      if (mode === 'drop' && result.status === 'accepted') {
        mode = 'normal';
        json(response, 503, { error: 'Receipt unavailable after commit' });
        return true;
      }
      json(response, 200, result);
    } catch (error) {
      if (!response.destroyed)
        json(response, 400, { error: error instanceof Error ? error.message : 'Invalid request' });
    }
    return true;
  };
}
