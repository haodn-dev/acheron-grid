import { readFile } from 'node:fs/promises';

// Process-local demonstration; production hosts must persist writes and idempotency records together.
export function createPagedDemoHandler() {
  const rows = Array.from({ length: 10000 }, (_, id) => ({ id, values: { title: `Task ${id}` } }));
  const receipts = new Map();
  let revision = 1,
    mode = 'normal';
  const queryRows = (query) => {
    const filter = query.filters?.[0];
    if (filter && (filter.columnKey !== 'title' || filter.operator !== 'contains' || typeof filter.query !== 'string'))
      throw Error('Invalid filter');
    if (query.sort && (query.sort.columnKey !== 'title' || !['asc', 'desc'].includes(query.sort.direction)))
      throw Error('Invalid sort');
    const result = filter
      ? rows.filter((row) => row.values.title.toLowerCase().includes(filter.query.toLowerCase()))
      : rows.slice();
    if (query.sort)
      result.sort(
        (a, b) =>
          a.values.title.localeCompare(b.values.title, undefined, { numeric: true }) *
          (query.sort.direction === 'asc' ? 1 : -1),
      );
    return result;
  };
  function json(response, status, value) {
    response
      .writeHead(status, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
      })
      .end(JSON.stringify(value));
  }
  return async (request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1:4180');
    if (!url.pathname.startsWith('/paged/')) return false;
    try {
      if (request.method === 'GET' && ['/paged/', '/paged/app.js'].includes(url.pathname)) {
        const file = url.pathname.endsWith('.js') ? 'app.js' : 'index.html';
        response
          .writeHead(200, {
            'Content-Type': file.endsWith('.js') ? 'text/javascript' : 'text/html; charset=utf-8',
            'X-Content-Type-Options': 'nosniff',
          })
          .end(await readFile(new URL(file, import.meta.url)));
        return true;
      }
      if (request.method === 'GET' && url.pathname === '/paged/api/page') {
        const offset = Number(url.searchParams.get('offset')),
          limit = Number(url.searchParams.get('limit'));
        if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100)
          throw Error('Invalid page');
        const expected = url.searchParams.get('revision');
        if (expected && expected !== String(revision)) {
          json(response, 409, { error: 'Resync required' });
          return true;
        }
        const filtered = queryRows(JSON.parse(url.searchParams.get('query') || '{}'));
        json(response, 200, {
          datasetId: 'paged-demo',
          revision: String(revision),
          total: filtered.length,
          rows: filtered.slice(offset, offset + limit),
        });
        return true;
      }
      if (request.method !== 'POST' || !['/paged/api/write', '/paged/api/control'].includes(url.pathname)) {
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
      let size = 0;
      const chunks = [];
      for await (const chunk of request) {
        size += chunk.length;
        if (size > 16384) throw Error('Request too large');
        chunks.push(chunk);
      }
      const input = JSON.parse(Buffer.concat(chunks).toString());
      if (url.pathname.endsWith('/control')) {
        if (!input || !['normal', 'reject', 'drop', 'external'].includes(input.mode)) throw Error('Invalid mode');
        if (input.mode === 'external') {
          rows[0].values.title = 'Server edit';
          revision++;
        } else mode = input.mode;
        json(response, 200, { revision: String(revision) });
        return true;
      }
      const { mutation, query } = input ?? {};
      if (
        !mutation ||
        mutation.datasetId !== 'paged-demo' ||
        typeof mutation.mutationId !== 'string' ||
        !mutation.mutationId ||
        mutation.mutationId.length > 256 ||
        typeof mutation.expectedRevision !== 'string' ||
        !Array.isArray(mutation.changes) ||
        !mutation.changes.length ||
        mutation.changes.length > 100
      )
        throw Error('Invalid mutation');
      const fingerprint = JSON.stringify(input),
        prior = receipts.get(mutation.mutationId);
      if (prior) {
        if (prior.fingerprint !== fingerprint) throw Error('Mutation ID reused');
        json(response, 200, prior.result);
        return true;
      }
      if (receipts.size >= 100) throw Error('Restart demo to clear receipt limit');
      const seen = new Set();
      for (const change of mutation.changes) {
        if (
          !change ||
          !Number.isSafeInteger(change.rowId) ||
          !rows[change.rowId] ||
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
      queryRows(query);
      let result;
      if (
        mutation.expectedRevision !== String(revision) ||
        mutation.changes.some((change) => rows[change.rowId].values.title !== change.previous)
      ) {
        result = {
          status: 'conflict',
          mutationId: mutation.mutationId,
          snapshot: { datasetId: 'paged-demo', revision: String(revision), rows: [...seen].map((id) => rows[id]) },
        };
      } else if (mode === 'reject')
        result = {
          status: 'rejected',
          datasetId: 'paged-demo',
          mutationId: mutation.mutationId,
          message: 'Server rejected this draft.',
        };
      else {
        for (const change of mutation.changes) rows[change.rowId].values.title = change.value.trim();
        revision++;
        result = {
          status: 'accepted',
          mutationId: mutation.mutationId,
          delta: {
            datasetId: 'paged-demo',
            baseRevision: mutation.expectedRevision,
            revision: String(revision),
            cells: mutation.changes.map((change) => ({
              rowId: change.rowId,
              columnKey: 'title',
              value: rows[change.rowId].values.title,
            })),
          },
        };
      }
      result = structuredClone({ ...result, total: queryRows(query).length });
      receipts.set(mutation.mutationId, { fingerprint, result });
      await new Promise((resolve) => setTimeout(resolve, 100));
      json(
        response,
        mode === 'drop' && result.status === 'accepted' ? 503 : 200,
        mode === 'drop' && result.status === 'accepted' ? { error: 'Receipt lost; retry identical mutation' } : result,
      );
    } catch (error) {
      json(response, 400, { error: error.message });
    }
    return true;
  };
}
