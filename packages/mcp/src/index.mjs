import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

export function createGridMcpServer({
  engine,
  documents = {},
  authorize,
  validateWrite,
  allowWrites = false,
  allowDiscovery = false,
  maxRowScan = 10_000,
  maxOutputBytes = 1_000_000,
  resolveRowIndex,
  getRevision,
}) {
  if (engine && typeof authorize !== 'function') throw new TypeError('Grid access requires an authorize callback.');
  if (allowWrites && typeof validateWrite !== 'function') throw new TypeError('Writes require host validation.');
  if (!Number.isSafeInteger(maxRowScan) || maxRowScan < 1) throw new RangeError('Invalid row scan budget.');
  if (!Number.isSafeInteger(maxOutputBytes) || maxOutputBytes < 1) throw new RangeError('Invalid output budget.');
  if (resolveRowIndex !== undefined && typeof resolveRowIndex !== 'function')
    throw new TypeError('Invalid row resolver.');
  if (getRevision !== undefined && typeof getRevision !== 'function') throw new TypeError('Invalid revision provider.');
  function revision() {
    if (!getRevision) return undefined;
    const token = getRevision();
    if (typeof token !== 'string' || !token.length || token.length > 256) throw new Error('Invalid dataset revision.');
    return token;
  }
  function result(value) {
    const text = JSON.stringify(value);
    if (new TextEncoder().encode(text).byteLength > maxOutputBytes) throw new Error('Output budget exceeded.');
    return { content: [{ type: 'text', text }] };
  }
  const server = new Server({ name: 'acheron-grid', version: '0.1.0' }, { capabilities: { resources: {}, tools: {} } });
  const resources = Object.entries(documents).map(([name, text]) => {
    if (!/^[a-z0-9-]+$/.test(name) || typeof text !== 'string') throw new TypeError('Invalid document.');
    return { uri: `acheron://docs/${name}`, name, mimeType: 'text/markdown', text };
  });
  server.setRequestHandler(ListResourcesRequestSchema, async () => ({
    resources: resources.map(({ text, ...resource }) => resource),
  }));
  server.setRequestHandler(ReadResourceRequestSchema, async ({ params }) => {
    const resource = resources.find((item) => item.uri === params.uri);
    if (!resource) throw new Error('Unknown resource.');
    return { contents: [{ uri: resource.uri, mimeType: resource.mimeType, text: resource.text }] };
  });
  const cellProperties = {
    rowId: { type: ['string', 'number'] },
    columnKey: { type: 'string' },
    expected: { type: ['string', 'number', 'boolean', 'null'] },
    value: { type: ['string', 'number', 'boolean', 'null'] },
  };
  const cellList = (writing) => ({
    type: 'array',
    minItems: 1,
    maxItems: 100,
    items: {
      type: 'object',
      properties: writing ? cellProperties : { rowId: cellProperties.rowId, columnKey: cellProperties.columnKey },
      required: writing ? ['rowId', 'columnKey', 'expected', 'value'] : ['rowId', 'columnKey'],
      additionalProperties: false,
    },
  });
  const tools = engine
    ? [
        {
          name: 'grid_schema',
          description: 'Read host-approved columns and visible row count.',
          inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        },
        {
          name: 'grid_read',
          description: 'Read up to 100 host-approved cells by stable row ID and column key.',
          inputSchema: {
            type: 'object',
            properties: { cells: cellList(false) },
            required: ['cells'],
            additionalProperties: false,
          },
        },
        ...(allowDiscovery
          ? [
              {
                name: 'grid_rows',
                description: 'Discover up to 100 host-approved visible row IDs within a bounded positional scan.',
                inputSchema: {
                  type: 'object',
                  properties: {
                    cursor: { type: 'integer', minimum: 0 },
                    limit: { type: 'integer', minimum: 1, maximum: 100 },
                  },
                  additionalProperties: false,
                },
              },
            ]
          : []),
        ...(allowWrites
          ? [
              {
                name: 'grid_update',
                description: 'Atomically update up to 100 cells, requiring expected values and host validation.',
                inputSchema: {
                  type: 'object',
                  properties: { cells: cellList(true) },
                  required: ['cells'],
                  additionalProperties: false,
                },
              },
            ]
          : []),
      ]
    : [];
  if (getRevision)
    for (const tool of tools) {
      tool.inputSchema.properties.expectedRevision = { type: 'string', minLength: 1, maxLength: 256 };
      if (tool.name === 'grid_update') tool.inputSchema.required.push('expectedRevision');
    }
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
  server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
    try {
      if (!tools.some((tool) => tool.name === params.name)) throw new Error('Unknown or disabled tool.');
      const input = params.arguments;
      const currentRevision = revision();
      if (currentRevision !== undefined) {
        if (input?.expectedRevision !== undefined && input.expectedRevision !== currentRevision)
          throw new Error('Conflict: dataset revision changed. Read again.');
        if (
          (params.name === 'grid_update' || (params.name === 'grid_rows' && (input?.cursor ?? 0) > 0)) &&
          input?.expectedRevision === undefined
        )
          throw new Error('Expected dataset revision is required.');
      } else if (input?.expectedRevision !== undefined) throw new Error('Dataset revisions are not enabled.');
      const readResult = (value) => {
        if (currentRevision !== revision()) throw new Error('Conflict: dataset revision changed during read.');
        return result(currentRevision === undefined ? value : { ...value, revision: currentRevision });
      };
      if (params.name === 'grid_schema') {
        if (authorize({ operation: 'schema' }) !== true) throw new Error('Access denied.');
        const columns = engine.columns
          .filter((column) => authorize({ operation: 'read', columnKey: column.key }) === true)
          .map(({ key, title }) => ({ key, title }));
        return readResult({ columns, rowCount: engine.rowCount });
      }
      if (params.name === 'grid_rows') {
        if (authorize({ operation: 'discover' }) !== true || authorize({ operation: 'schema' }) !== true)
          throw new Error('Access denied.');
        const cursor = input?.cursor ?? 0,
          limit = input?.limit ?? 100;
        if (
          !Number.isSafeInteger(cursor) ||
          cursor < 0 ||
          cursor > engine.rowCount ||
          !Number.isSafeInteger(limit) ||
          limit < 1 ||
          limit > 100
        )
          throw new Error('Invalid discovery window.');
        const rowIds = [];
        let next = cursor,
          scanned = 0;
        while (next < engine.rowCount && rowIds.length < limit && scanned < maxRowScan) {
          const rowId = engine.getRowId(next++);
          scanned++;
          if (authorize({ operation: 'read', rowId }) === true) rowIds.push(rowId);
        }
        return readResult({ rowIds, nextCursor: next < engine.rowCount ? next : null });
      }
      if (!input || !Array.isArray(input.cells) || !input.cells.length || input.cells.length > 100)
        throw new Error('Expected 1–100 cells.');
      const writing = params.name === 'grid_update';
      const seen = new Set();
      for (const cell of input.cells) {
        if (
          !cell ||
          typeof cell !== 'object' ||
          !['string', 'number'].includes(typeof cell.rowId) ||
          (typeof cell.rowId === 'number' && !Number.isFinite(cell.rowId)) ||
          typeof cell.columnKey !== 'string'
        )
          throw new Error('Invalid cell identity.');
        if (
          !engine.columns.some((column) => column.key === cell.columnKey) ||
          authorize({ operation: 'read', rowId: cell.rowId, columnKey: cell.columnKey }) !== true
        )
          throw new Error('Cell unavailable.');
      }
      const rows = new Map();
      if (resolveRowIndex) {
        for (const rowId of new Set(input.cells.map((cell) => cell.rowId))) {
          const index = resolveRowIndex(rowId);
          if (
            index !== null &&
            index !== undefined &&
            Number.isSafeInteger(index) &&
            index >= 0 &&
            index < engine.rowCount &&
            Object.is(engine.getRowId(index), rowId)
          )
            rows.set(rowId, index);
        }
      } else {
        const wanted = new Set(input.cells.map((cell) => cell.rowId));
        let scanned = 0;
        for (; scanned < Math.min(engine.rowCount, maxRowScan) && rows.size < wanted.size; scanned++) {
          const rowId = engine.getRowId(scanned);
          if (wanted.has(rowId)) rows.set(rowId, scanned);
        }
        if (rows.size < wanted.size && scanned < engine.rowCount)
          throw new Error('Row lookup budget exceeded. Provide a host resolver.');
      }
      const updates = input.cells.map((cell) => {
        if (
          !cell ||
          typeof cell !== 'object' ||
          !['string', 'number'].includes(typeof cell.rowId) ||
          typeof cell.columnKey !== 'string'
        )
          throw new Error('Invalid cell identity.');
        const identity = JSON.stringify([cell.rowId, cell.columnKey]);
        if (seen.has(identity)) throw new Error('Duplicate cell.');
        seen.add(identity);
        const columnIndex = engine.columns.findIndex((column) => column.key === cell.columnKey);
        const rowIndex = rows.get(cell.rowId) ?? -1;
        if (
          columnIndex < 0 ||
          rowIndex < 0 ||
          authorize({ operation: 'read', rowId: cell.rowId, columnKey: cell.columnKey }) !== true
        )
          throw new Error('Cell unavailable.');
        const previous = engine.getValue(rowIndex, cell.columnKey);
        if (!writing) return { rowId: cell.rowId, columnKey: cell.columnKey, value: previous };
        if (!Object.hasOwn(cell, 'expected') || !Object.hasOwn(cell, 'value'))
          throw new Error('Expected and value are required.');
        if (
          authorize({ operation: 'write', rowId: cell.rowId, columnKey: cell.columnKey }) !== true ||
          !engine.getCellPermission(rowIndex, columnIndex).writable
        )
          throw new Error('Write denied.');
        if (!Object.is(previous, cell.expected)) throw new Error('Conflict: cell changed since read.');
        for (const value of [cell.expected, cell.value])
          if (!(
            value === null ||
            ['string', 'boolean'].includes(typeof value) ||
            (typeof value === 'number' && Number.isFinite(value))
          ))
            throw new Error('Writes require finite JSON scalar values.');
        if (validateWrite({ rowId: cell.rowId, columnKey: cell.columnKey, value: cell.value }) !== undefined)
          throw new Error('Validation must be synchronous and return no value.');
        return { rowIndex, columnKey: cell.columnKey, value: cell.value };
      });
      if (currentRevision !== revision()) throw new Error('Conflict: dataset revision changed before commit.');
      const response = writing
        ? result({
            updated: updates.length,
            ...(currentRevision === undefined ? {} : { checkedRevision: currentRevision }),
          })
        : readResult({ cells: updates });
      if (writing) engine.updateCells(updates);
      return response;
    } catch (error) {
      return {
        isError: true,
        content: [{ type: 'text', text: error instanceof Error ? error.message : 'Operation failed.' }],
      };
    }
  });
  return server;
}
