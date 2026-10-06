import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createGridEngine, LocalDataSource } from '@acheron-grid/core';
import { createGridMcpServer } from '../dist/index.js';

async function session(options, run) {
  const engine = createGridEngine({
    columns: [{ key: 'value', title: 'Value', editable: true }],
    dataSource: new LocalDataSource([{ id: 'a', value: 'old' }], (row) => row.id),
  });
  const server = createGridMcpServer({ engine, authorize: () => true, ...options(engine) });
  const client = new Client({ name: 'protocol-tests', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  try {
    await run(client, engine);
  } finally {
    await client.close();
    await server.close();
    engine.destroy();
  }
}
const cell = { rowId: 'a', columnKey: 'value' };
const write = (revision) => ({
  name: 'grid_update',
  arguments: { cells: [{ ...cell, expected: 'old', value: 'new' }], expectedRevision: revision },
});
const payload = (response) => JSON.parse(response.content[0].text);

test('schema count omission does not read row count; host aggregate is validated', async () => {
  await session(
    (engine) => ({
      schemaRowCount: 'omit',
      engine: new Proxy(engine, {
        get(target, key) {
          if (key === 'rowCount') throw Error('Count must not be read');
          return Reflect.get(target, key);
        },
      }),
    }),
    async (client) => {
      const response = await client.callTool({ name: 'grid_schema', arguments: {} });
      assert.equal(response.isError, undefined);
      assert.equal(Object.hasOwn(payload(response), 'rowCount'), false);
    },
  );
  await session(
    () => ({ schemaRowCount: () => 0 }),
    async (client) => assert.equal(payload(await client.callTool({ name: 'grid_schema', arguments: {} })).rowCount, 0),
  );
  await session(
    () => ({ schemaRowCount: () => NaN }),
    async (client) =>
      assert.equal(
        (await client.callTool({ name: 'grid_schema', arguments: {} })).structuredContent.error.code,
        'HOST_ERROR',
      ),
  );
});

test('tool errors retain text and expose stable codes without writing', async () => {
  await session(
    () => ({ authorize: () => false }),
    async (client, engine) => {
      const response = await client.callTool({ name: 'grid_schema', arguments: {} });
      assert.equal(response.isError, true);
      assert.match(response.content[0].text, /Access denied/);
      assert.deepEqual(response.structuredContent.error, {
        code: 'ACCESS_DENIED',
        message: 'Access denied.',
        retryable: false,
      });
      assert.equal(engine.getValue(0, 'value'), 'old');
    },
  );
  await session(
    () => ({
      allowWrites: true,
      validateWrite: () => {
        throw Error('Value rejected');
      },
    }),
    async (client, engine) => {
      const response = await client.callTool({
        name: 'grid_update',
        arguments: { cells: [{ ...cell, expected: 'old', value: 'new' }] },
      });
      assert.equal(response.structuredContent.error.code, 'VALIDATION_FAILED');
      assert.equal(engine.canUndo(), false);
    },
  );
});

test('successful writes return the post-write host revision and stale tokens remain rejected', async () => {
  let revision = 0;
  await session(
    (engine) => {
      engine.subscribe({ onInvalidate: () => revision++ });
      return { allowWrites: true, validateWrite: () => {}, getRevision: () => String(revision) };
    },
    async (client, engine) => {
      const response = await client.callTool(write('0'));
      assert.deepEqual(payload(response), { updated: 1, checkedRevision: '0', revision: '1' });
      const stale = await client.callTool(write('0'));
      assert.equal(stale.structuredContent.error.code, 'CONFLICT');
      assert.equal(stale.structuredContent.error.retryable, true);
      assert.equal(engine.getValue(0, 'value'), 'new');
    },
  );
});

test('post-write revision provider failure returns a committed receipt requiring read-back', async () => {
  await session(
    (engine) => ({
      allowWrites: true,
      validateWrite: () => {},
      getRevision: () => {
        if (engine.getValue(0, 'value') === 'new') throw Error('Provider offline');
        return 'before';
      },
    }),
    async (client, engine) => {
      const response = await client.callTool(write('before'));
      assert.equal(response.isError, undefined);
      assert.deepEqual(payload(response), { updated: 1, checkedRevision: 'before', revisionUnavailable: true });
      assert.equal(engine.getValue(0, 'value'), 'new');
      assert.equal(engine.canUndo(), true);
    },
  );
});

test('receipt budget failure prevents writes and oversized post-write revision falls back safely', async () => {
  await session(
    () => ({ allowWrites: true, validateWrite: () => {}, maxOutputBytes: 1, getRevision: () => 'before' }),
    async (client, engine) => {
      const response = await client.callTool(write('before'));
      assert.equal(response.structuredContent.error.code, 'BUDGET_EXCEEDED');
      assert.equal(engine.getValue(0, 'value'), 'old');
    },
  );
  await session(
    (engine) => ({
      allowWrites: true,
      validateWrite: () => {},
      maxOutputBytes: 100,
      getRevision: () => (engine.getValue(0, 'value') === 'old' ? 'before' : 'x'.repeat(256)),
    }),
    async (client, engine) => {
      const response = await client.callTool(write('before'));
      assert.equal(response.isError, undefined);
      assert.equal(payload(response).revisionUnavailable, true);
      assert.equal(engine.getValue(0, 'value'), 'new');
    },
  );
});
