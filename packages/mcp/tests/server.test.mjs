import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createGridEngine, LocalDataSource } from '@acheron-grid/core';
import { createGridMcpServer } from '../src/index.mjs';
test('MCP resources, approved reads, atomic conflict-safe writes and history', async () => {
 const engine = createGridEngine({ columns: [{ key: 'title', title: 'Title', editable: true }], dataSource: new LocalDataSource([{ id: 'a', title: 'Old' }, { id: 'b', title: 'Other' }], row => row.id) });
 const server = createGridMcpServer({ engine, documents: { core: '# Core' }, authorize: () => true, allowWrites: true, validateWrite: cell => { if (typeof cell.value !== 'string') throw new Error('String required'); } });
 const client = new Client({ name: 'test', version: '1' });
 const [a,b] = InMemoryTransport.createLinkedPair();
 await Promise.all([server.connect(a), client.connect(b)]);
 try {
  assert.equal((await client.listResources()).resources.length, 1);
  assert.equal((await client.readResource({ uri: 'acheron://docs/core' })).contents[0].text, '# Core');
  const read = await client.callTool({ name: 'grid_read', arguments: { cells: [{ rowId: 'a', columnKey: 'title' }] } });
  assert.equal(JSON.parse(read.content[0].text).cells[0].value, 'Old');
  const conflict = await client.callTool({ name: 'grid_update', arguments: { cells: [{ rowId: 'a', columnKey: 'title', expected: 'Old', value: 'New' }, { rowId: 'b', columnKey: 'title', expected: 'stale', value: 'Changed' }] } });
  assert.equal(conflict.isError, true); assert.equal(engine.getValue(0,'title'), 'Old');
  await client.callTool({ name: 'grid_update', arguments: { cells: [{ rowId: 'a', columnKey: 'title', expected: 'Old', value: 'New' }] } });
  assert.equal(engine.getValue(0,'title'), 'New');
  engine.setLocked({ scope: 'cell', rowIndex: 0, columnIndex: 0 }, true);
  const denied = await client.callTool({ name: 'grid_update', arguments: { cells: [{ rowId: 'a', columnKey: 'title', expected: 'New', value: 'Denied' }] } });
  assert.equal(denied.isError, true); assert.equal(engine.getValue(0,'title'), 'New');
  engine.setLocked({ scope: 'cell', rowIndex: 0, columnIndex: 0 }, false);
  engine.undo(); assert.equal(engine.getValue(0,'title'), 'Old');
 } finally { await client.close(); await server.close(); engine.destroy(); }
});

test('stdio CLI provides documents without exposing grid tools', async () => {
 const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js');
 const client = new Client({ name: 'stdio-test', version: '1' });
 await client.connect(new StdioClientTransport({ command: process.execPath, args: [new URL('../src/cli.mjs', import.meta.url).pathname.replace(/^\/(?:([A-Z]:))/, '$1')] }));
 try { assert.equal((await client.listResources()).resources.length, 7); assert.equal((await client.readResource({ uri: 'acheron://docs/export' })).contents[0].text.includes('exportSelectionCsv'), true); assert.equal((await client.readResource({uri:'acheron://docs/charts'})).contents[0].text.includes('createChartRenderer'),true); assert.equal((await client.listTools()).tools.length, 0); }
 finally { await client.close(); }
});

test('host authorization is mandatory and denied reads expose no values', async () => {
 const engine = createGridEngine({ columns: [{ key: 'title', title: 'Title' }], dataSource: new LocalDataSource([{ id: 'a', title: 'Secret' }], row => row.id) });
 assert.throws(() => createGridMcpServer({ engine }), /authorize/);
 assert.throws(() => createGridMcpServer({ engine, authorize: () => true, allowWrites: true }), /validation/);
 const server = createGridMcpServer({ engine, authorize: () => false });
 const client = new Client({ name: 'denied-test', version: '1' });
 const [a,b] = InMemoryTransport.createLinkedPair(); await Promise.all([server.connect(a), client.connect(b)]);
 try {
  const denied = await client.callTool({ name: 'grid_read', arguments: { cells: [{ rowId: 'a', columnKey: 'title' }] } });
  assert.equal(denied.isError, true); assert.ok(!JSON.stringify(denied).includes('Secret'));
  assert.equal((await client.listTools()).tools.some(tool => tool.name === 'grid_update'), false);
 } finally { await client.close(); await server.close(); engine.destroy(); }
});

test('bounded discovery skips denied rows, advances cursor and requires explicit authorization', async () => {
 const engine = createGridEngine({ columns: [{ key: 'value', title: 'Value' }], dataSource: new LocalDataSource(Array.from({ length: 8 }, (_, id) => ({ id, value: `secret-${id}` })), row => row.id) });
 let discovery = true;
 const server = createGridMcpServer({ engine, allowDiscovery: true, maxRowScan: 3, authorize: request => request.operation === 'discover' ? discovery : request.operation === 'schema' || request.rowId % 2 === 1 });
 const client = new Client({ name: 'discovery-test', version: '1' });
 const [a,b] = InMemoryTransport.createLinkedPair(); await Promise.all([server.connect(a), client.connect(b)]);
 try {
  const first = await client.callTool({ name: 'grid_rows', arguments: { limit: 100 } });
  assert.deepEqual(JSON.parse(first.content[0].text), { rowIds: [1], nextCursor: 3 });
  assert.ok(!JSON.stringify(first).includes('secret'));
  const second = await client.callTool({ name: 'grid_rows', arguments: { cursor: 3, limit: 1 } });
  assert.deepEqual(JSON.parse(second.content[0].text), { rowIds: [3], nextCursor: 4 });
  const end = await client.callTool({ name: 'grid_rows', arguments: { cursor: 8 } });
  assert.deepEqual(JSON.parse(end.content[0].text), { rowIds: [], nextCursor: null });
  discovery = false;
  assert.equal((await client.callTool({ name: 'grid_rows', arguments: {} })).isError, true);
 } finally { await client.close(); await server.close(); engine.destroy(); }
});

test('cell reads scan once within budget and host resolver validates the current visible identity', async () => {
 let idReads = 0, valueReads = 0, resolverIndex = 99, denied = false;
 const engine = createGridEngine({ columns: [{ key: 'value', title: 'Value' }, { key: 'other', title: 'Other' }],
  dataSource: { getRowCount: () => 100, getRowId: row => { idReads++; return row; }, getValue: row => { valueReads++; return row; } } });
 const server = createGridMcpServer({ engine, maxRowScan: 5, authorize: () => !denied });
 const client = new Client({ name: 'bounded-test', version: '1' });
 const [a,b] = InMemoryTransport.createLinkedPair(); await Promise.all([server.connect(a), client.connect(b)]);
 try {
  idReads = valueReads = 0;
  const result = await client.callTool({ name: 'grid_read', arguments: { cells: [{ rowId: 4, columnKey: 'value' }, { rowId: 4, columnKey: 'other' }] } });
  assert.equal(result.isError, undefined); assert.equal(idReads, 5); assert.equal(valueReads, 2);
  idReads = valueReads = 0;
  const over = await client.callTool({ name: 'grid_read', arguments: { cells: [{ rowId: 99, columnKey: 'value' }] } });
  assert.equal(over.isError, true); assert.match(over.content[0].text, /budget exceeded/); assert.equal(idReads, 5); assert.equal(valueReads, 0);
  denied = true; idReads = 0;
  assert.equal((await client.callTool({ name: 'grid_read', arguments: { cells: [{ rowId: 4, columnKey: 'value' }] } })).isError, true);
  assert.equal(idReads, 0);
  assert.equal((await client.listTools()).tools.some(tool => tool.name === 'grid_rows'), false);
 } finally { await client.close(); await server.close(); }
 const resolvedServer = createGridMcpServer({ engine, maxRowScan: 1, authorize: () => true, resolveRowIndex: () => resolverIndex });
 const resolvedClient = new Client({ name: 'resolver-test', version: '1' });
 const [c,d] = InMemoryTransport.createLinkedPair(); await Promise.all([resolvedServer.connect(c), resolvedClient.connect(d)]);
 try {
  idReads = 0;
  const result = await resolvedClient.callTool({ name: 'grid_read', arguments: { cells: [{ rowId: 99, columnKey: 'value' }] } });
  assert.equal(JSON.parse(result.content[0].text).cells[0].value, 99); assert.equal(idReads, 1);
  resolverIndex = 98;
  assert.equal((await resolvedClient.callTool({ name: 'grid_read', arguments: { cells: [{ rowId: 99, columnKey: 'value' }] } })).isError, true);
 } finally { await resolvedClient.close(); await resolvedServer.close(); engine.destroy(); }
});

test('output budget rejects oversized reads and write receipts before mutation', async () => {
 const engine = createGridEngine({ columns: [{ key: 'value', title: 'Value', editable: true }], dataSource: new LocalDataSource([{ id: 1, value: 'private content' }], row => row.id) });
 const server = createGridMcpServer({ engine, authorize: () => true, allowWrites: true, validateWrite: () => {}, maxOutputBytes: 1 });
 const client = new Client({ name: 'output-test', version: '1' });
 const [a,b] = InMemoryTransport.createLinkedPair(); await Promise.all([server.connect(a), client.connect(b)]);
 try {
  const read = await client.callTool({ name: 'grid_read', arguments: { cells: [{ rowId: 1, columnKey: 'value' }] } });
  assert.equal(read.isError, true); assert.match(read.content[0].text, /Output budget/); assert.ok(!JSON.stringify(read).includes('private content'));
  const write = await client.callTool({ name: 'grid_update', arguments: { cells: [{ rowId: 1, columnKey: 'value', expected: 'private content', value: 'changed' }] } });
  assert.equal(write.isError, true); assert.equal(engine.getValue(0, 'value'), 'private content'); assert.equal(engine.canUndo(), false);
 } finally { await client.close(); await server.close(); engine.destroy(); }
});
