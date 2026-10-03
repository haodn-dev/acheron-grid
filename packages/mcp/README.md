# @acheron-grid/mcp

Optional Model Context Protocol adapter. Core and Canvas do not depend on the MCP SDK. Uses the official MCP TypeScript SDK v1 with resources and tools.

## Documentation server

From the source checkout, after installing dependencies:

```sh
node packages/mcp/src/cli.mjs
```

Configure your MCP client to launch that command over stdio, using an absolute path. The CLI exposes five bundled package README snapshots as `acheron://docs/core`, `canvas`, `react`, `vue` and `markdown`. It exposes no grid data or write tools. stdout belongs to the protocol; no HTTP listener or authentication service is started.

## Connect a host-owned grid

```js
import { createGridMcpServer } from '@acheron-grid/mcp';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

const server = createGridMcpServer({
  engine, // public GridEngine created by your application
  documents: { usage: '# Your application guide' },
  authorize: request => request.operation === 'schema'
    || request.columnKey === 'title',
  allowWrites: true,
  validateWrite: cell => {
    if (typeof cell.value !== 'string' || !cell.value.trim()) {
      throw new Error('A non-empty string is required.');
    }
  },
});
await server.connect(new StdioServerTransport());
```

The application must authorize every schema/read/write request for the connected principal. Callbacks are synchronous and must not mutate the engine. Default is read-only; grid access requires `authorize`, writes additionally require `validateWrite`. The host owns connection identity, lifecycle and data exposure. This example is not an authentication implementation.

## Tools

- `grid_schema`: approved column keys/titles and visible row count. Schema authorization grants visibility of that count.
- `grid_read`: `{ cells: [{ rowId, columnKey }] }`, 1–100 cells.
- `grid_update`: `{ cells: [{ rowId, columnKey, expected, value }] }`, 1–100 cells. Requires read/write host permission and core writable permission; host validation runs before one atomic `updateCells` call. Undo uses normal core history.

Stable IDs are resolved in the current visible view, not stale row indices. Hidden or missing rows are unavailable. Duplicate cells are rejected. Expected values use `Object.is`: this first version targets scalar cell values, not structural equality of objects. Conflicts or validation failures produce tool errors before a batch commits. Documents are host-supplied public content; never include secrets. Tool error text can include host validation messages, which the host must keep safe for the caller.

## Limits

No browser bridge, HTTP transport setup, remote data, collaborative revisioning, sort/filter/structure tools or autonomous undo tool is included. A standalone server cannot see a browser grid without a host bridge. Row ID lookup scans the visible view; use bounded requests. Bundled documentation must be refreshed after package changes. The package is a source preview, not an npm release.

## Verification

`npm run test --workspace @acheron-grid/mcp` checks an SDK client/server handshake, resources, reads, conflict-safe atomic updates and core history. Uses SDK transports rather than implementing JSON-RPC.

MIT © 2026 Hao Duong.
