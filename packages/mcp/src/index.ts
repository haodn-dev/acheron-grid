import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ListToolsRequestSchema,
  CallToolRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

import type { GridEngine, RowId } from '@acheron-grid/core';
export type GridMcpErrorCode =
  | 'INVALID_ARGUMENT'
  | 'ACCESS_DENIED'
  | 'CELL_UNAVAILABLE'
  | 'CONFLICT'
  | 'BUDGET_EXCEEDED'
  | 'TOOL_UNAVAILABLE'
  | 'HOST_ERROR'
  | 'VALIDATION_FAILED'
  | 'OPERATION_FAILED';
class ToolFailure extends Error {
  constructor(
    readonly code: GridMcpErrorCode,
    message: string,
  ) {
    super(message);
  }
}
export interface GridMcpOptions {
  engine?: GridEngine;
  documents?: Readonly<Record<string, string>>;
  authorize?: (request: {
    operation: 'schema' | 'read' | 'write' | 'discover';
    rowId?: RowId;
    columnKey?: string;
  }) => boolean;
  allowDiscovery?: boolean;
  maxRowScan?: number;
  maxOutputBytes?: number;
  resolveRowIndex?: (rowId: RowId) => number | null | undefined;
  /** Synchronous, side-effect-free token; change on data, view, permissions or dataset replacement. */
  getRevision?: () => string;
  schemaRowCount?: 'visible' | 'omit' | (() => number | null);
  allowWrites?: boolean;
  validateWrite?: (cell: { rowId: RowId; columnKey: string; value: unknown }) => void;
}

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
  schemaRowCount = 'visible',
}: GridMcpOptions): Server {
  if (schemaRowCount !== 'visible' && schemaRowCount !== 'omit' && typeof schemaRowCount !== 'function')
    throw new TypeError('Invalid schema row count policy.');
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
    if (typeof token !== 'string' || !token.length || token.length > 256)
      throw new ToolFailure('HOST_ERROR', 'Invalid dataset revision.');
    return token;
  }
  function result(value: unknown): import('@modelcontextprotocol/sdk/types.js').CallToolResult {
    const text = JSON.stringify(value);
    if (new TextEncoder().encode(text).byteLength > maxOutputBytes)
      throw new ToolFailure('BUDGET_EXCEEDED', 'Output budget exceeded.');
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
  const cellList = (writing: boolean) => ({
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
  const tools: import('@modelcontextprotocol/sdk/types.js').Tool[] = engine
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
                  type: 'object' as const,
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
                  type: 'object' as const,
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
      (tool.inputSchema.properties ??= {}).expectedRevision = { type: 'string', minLength: 1, maxLength: 256 };
      if (tool.name === 'grid_update') (tool.inputSchema.required ??= []).push('expectedRevision');
    }
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));
  server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
    try {
      if (!engine || !authorize) throw new ToolFailure('ACCESS_DENIED', 'Grid access unavailable.');
      if (!tools.some((tool) => tool.name === params.name))
        throw new ToolFailure('TOOL_UNAVAILABLE', 'Unknown or disabled tool.');
      const input = params.arguments;
      const currentRevision = revision();
      if (currentRevision !== undefined) {
        if (input?.expectedRevision !== undefined && input.expectedRevision !== currentRevision)
          throw new ToolFailure('CONFLICT', 'Conflict: dataset revision changed. Read again.');
        if (
          (params.name === 'grid_update' ||
            (params.name === 'grid_rows' && typeof input?.cursor === 'number' && input.cursor > 0)) &&
          input?.expectedRevision === undefined
        )
          throw new ToolFailure('INVALID_ARGUMENT', 'Expected dataset revision is required.');
      } else if (input?.expectedRevision !== undefined)
        throw new ToolFailure('INVALID_ARGUMENT', 'Dataset revisions are not enabled.');
      const readResult = (value: Record<string, unknown>) => {
        if (currentRevision !== revision())
          throw new ToolFailure('CONFLICT', 'Conflict: dataset revision changed during read.');
        return result(currentRevision === undefined ? value : { ...value, revision: currentRevision });
      };
      if (params.name === 'grid_schema') {
        if (authorize({ operation: 'schema' }) !== true) throw new ToolFailure('ACCESS_DENIED', 'Access denied.');
        const columns = engine.columns
          .filter((column) => authorize({ operation: 'read', columnKey: column.key }) === true)
          .map(({ key, title }) => ({ key, title }));
        const count =
          schemaRowCount === 'omit' ? null : schemaRowCount === 'visible' ? engine.rowCount : schemaRowCount();
        if (count !== null && (!Number.isSafeInteger(count) || count < 0))
          throw new ToolFailure('HOST_ERROR', 'Invalid schema row count.');
        return readResult({ columns, ...(count === null ? {} : { rowCount: count }) });
      }
      if (params.name === 'grid_rows') {
        if (authorize({ operation: 'discover' }) !== true || authorize({ operation: 'schema' }) !== true)
          throw new ToolFailure('ACCESS_DENIED', 'Access denied.');
        const cursor = input?.cursor ?? 0,
          limit = input?.limit ?? 100;
        if (
          typeof cursor !== 'number' ||
          !Number.isSafeInteger(cursor) ||
          cursor < 0 ||
          cursor > engine.rowCount ||
          typeof limit !== 'number' ||
          !Number.isSafeInteger(limit) ||
          limit < 1 ||
          limit > 100
        )
          throw new ToolFailure('INVALID_ARGUMENT', 'Invalid discovery window.');
        const rowIds: import('@acheron-grid/core').RowId[] = [];
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
        throw new ToolFailure('INVALID_ARGUMENT', 'Expected 1–100 cells.');
      const writing = params.name === 'grid_update';
      const seen = new Set<string>();
      for (const cell of input.cells) {
        if (
          !cell ||
          typeof cell !== 'object' ||
          !['string', 'number'].includes(typeof cell.rowId) ||
          (typeof cell.rowId === 'number' && !Number.isFinite(cell.rowId)) ||
          typeof cell.columnKey !== 'string'
        )
          throw new ToolFailure('INVALID_ARGUMENT', 'Invalid cell identity.');
        if (
          !engine.columns.some((column) => column.key === cell.columnKey) ||
          authorize({ operation: 'read', rowId: cell.rowId, columnKey: cell.columnKey }) !== true
        )
          throw new ToolFailure('CELL_UNAVAILABLE', 'Cell unavailable.');
      }
      const cells = input.cells as {
        rowId: import('@acheron-grid/core').RowId;
        columnKey: string;
        expected?: unknown;
        value?: unknown;
      }[];
      const rows = new Map<import('@acheron-grid/core').RowId, number>();
      if (resolveRowIndex) {
        for (const rowId of new Set(cells.map((cell) => cell.rowId))) {
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
        const wanted = new Set(cells.map((cell) => cell.rowId));
        let scanned = 0;
        for (; scanned < Math.min(engine.rowCount, maxRowScan) && rows.size < wanted.size; scanned++) {
          const rowId = engine.getRowId(scanned);
          if (wanted.has(rowId)) rows.set(rowId, scanned);
        }
        if (rows.size < wanted.size && scanned < engine.rowCount)
          throw new ToolFailure('BUDGET_EXCEEDED', 'Row lookup budget exceeded. Provide a host resolver.');
      }
      const updates = cells.map((cell) => {
        if (
          !cell ||
          typeof cell !== 'object' ||
          !['string', 'number'].includes(typeof cell.rowId) ||
          typeof cell.columnKey !== 'string'
        )
          throw new ToolFailure('INVALID_ARGUMENT', 'Invalid cell identity.');
        const identity = JSON.stringify([cell.rowId, cell.columnKey]);
        if (seen.has(identity)) throw new ToolFailure('INVALID_ARGUMENT', 'Duplicate cell.');
        seen.add(identity);
        const columnIndex = engine.columns.findIndex((column) => column.key === cell.columnKey);
        const rowIndex = rows.get(cell.rowId) ?? -1;
        if (
          columnIndex < 0 ||
          rowIndex < 0 ||
          authorize({ operation: 'read', rowId: cell.rowId, columnKey: cell.columnKey }) !== true
        )
          throw new ToolFailure('CELL_UNAVAILABLE', 'Cell unavailable.');
        const previous = engine.getValue(rowIndex, cell.columnKey);
        if (!writing) return { rowId: cell.rowId, columnKey: cell.columnKey, value: previous };
        if (!Object.hasOwn(cell, 'expected') || !Object.hasOwn(cell, 'value'))
          throw new ToolFailure('INVALID_ARGUMENT', 'Expected and value are required.');
        if (
          authorize({ operation: 'write', rowId: cell.rowId, columnKey: cell.columnKey }) !== true ||
          !engine.getCellPermission(rowIndex, columnIndex).writable
        )
          throw new ToolFailure('ACCESS_DENIED', 'Write denied.');
        if (!Object.is(previous, cell.expected))
          throw new ToolFailure('CONFLICT', 'Conflict: cell changed since read.');
        for (const value of [cell.expected, cell.value])
          if (!(
            value === null ||
            ['string', 'boolean'].includes(typeof value) ||
            (typeof value === 'number' && Number.isFinite(value))
          ))
            throw new ToolFailure('INVALID_ARGUMENT', 'Writes require finite JSON scalar values.');
        if (!validateWrite) throw new ToolFailure('HOST_ERROR', 'Writes require host validation.');
        try {
          if (validateWrite({ rowId: cell.rowId, columnKey: cell.columnKey, value: cell.value }) !== undefined)
            throw new ToolFailure('HOST_ERROR', 'Validation must be synchronous and return no value.');
        } catch (error) {
          if (error instanceof ToolFailure) throw error;
          throw new ToolFailure('VALIDATION_FAILED', error instanceof Error ? error.message : 'Validation failed.');
        }
        return { rowIndex, columnKey: cell.columnKey, value: cell.value };
      });
      if (currentRevision !== revision())
        throw new ToolFailure('CONFLICT', 'Conflict: dataset revision changed before commit.');
      if (!writing) return readResult({ cells: updates });
      const receipt = {
        updated: updates.length,
        ...(currentRevision === undefined ? {} : { checkedRevision: currentRevision }),
      };
      const fallback = result(currentRevision === undefined ? receipt : { ...receipt, revisionUnavailable: true });
      engine.updateCells(updates as import('@acheron-grid/core').CellUpdate[]);
      if (currentRevision === undefined) return fallback;
      try {
        return result({ ...receipt, revision: revision() });
      } catch {
        return fallback;
      }
    } catch (error) {
      const code = error instanceof ToolFailure ? error.code : 'OPERATION_FAILED';
      const message = error instanceof Error ? error.message : 'Operation failed.';
      return {
        isError: true,
        content: [{ type: 'text', text: message }],
        structuredContent: { error: { code, message, retryable: code === 'CONFLICT' } },
      };
    }
  });
  return server;
}
