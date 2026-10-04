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
 try { assert.equal((await client.listResources()).resources.length, 5); assert.equal((await client.listTools()).tools.length, 0); }
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
