# @acheron-grid/mcp

Documentation revision 2 · npm 0.1.0 + explicitly marked source additions. See [documentation versions](../../guides/versions.md).


Optional Model Context Protocol adapter. Core and Canvas do not depend on the MCP SDK. Uses the official MCP TypeScript SDK v1 with resources and tools.

## Installation

```sh
npm install @acheron-grid/mcp@0.1.0
```

Install core/Canvas at the same version when used. For newer APIs, use a built source checkout and install matching packed artifacts; see [Getting started](../../guides/getting-started.md).

## Documentation server

From the source checkout, after installing dependencies:

```sh
node packages/mcp/src/cli.mjs
```

Configure your MCP client to launch that command over stdio, using an absolute path. The source CLI exposes seven bundled package README snapshots as `acheron://docs/core`, `canvas`, `react`, `vue`, `markdown`, `export` and `charts`. Published npm 0.1.0 exposes the original five resources; export/charts resources are Unreleased additions. It exposes no grid data or write tools. stdout belongs to the protocol; no HTTP listener or authentication service is started.

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

The discovery and budget options below are unreleased source changes.

- `grid_schema`: approved column keys/titles and visible row count. Schema authorization grants visibility of that count.
- `grid_read`: `{ cells: [{ rowId, columnKey }] }`, 1–100 cells.
- `grid_rows`: opt-in with `allowDiscovery: true`; `{ cursor?: number, limit?: number }` returns authorized `rowIds` and `nextCursor`. Limit defaults to 100 and cannot exceed 100. Requires both `discover` and `schema` authorization, plus row-level `read` approval for every returned ID. The CLI keeps discovery disabled.
- `grid_update`: `{ cells: [{ rowId, columnKey, expected, value }] }`, 1–100 cells. Requires read/write host permission and core writable permission; host validation runs before one atomic `updateCells` call. Undo uses normal core history.

Stable IDs are resolved in the current visible view, not stale row indices. Rows excluded by the current projection or missing from the dataset are unavailable. Layout hiding is not authorization: use `authorize` to protect rows and columns. Duplicate cells are rejected. Expected values use `Object.is`: this first version targets scalar cell values, not structural equality of objects. Conflicts or validation failures produce tool errors before a batch commits. Documents are host-supplied public content; never include secrets. Tool error text can include host validation messages, which the host must keep safe for the caller.

## Dataset revisions and application example

Unreleased source option `getRevision: () => string` enables host-managed consistency. Return a non-empty opaque token of at most 256 characters, synchronously and without side effects. Never reuse a token within a session: change it on dataset replacement, data, query/order or permission changes, including undo. The adapter does not infer backend revisions.

With this option, schema/discovery/read responses include `revision`; all tools accept `expectedRevision`. Writes require it in addition to each cell's `expected` value. Discovery continuation (`cursor > 0`) also requires it. A mismatch fails before values or mutations are returned; a changing token during a read fails before returning its result. Write receipts include the pre-write `checkedRevision`; read again for the post-write revision. Without the option, existing response shapes remain unchanged, and `expectedRevision` is rejected rather than silently ignored.

This is optimistic detection, not an immutable snapshot or remote transaction. The host must keep callbacks pure and cover all state changes in the token. Backend compare-and-swap and authorization remain mandatory for remote persistence.

See the runnable [task application and model evaluation protocol](../../examples/mcp/README.md). It loads application JSON into a bounded headless session, defaults to read-only, and exposes authorized status edits over stdio. Writes are in memory only; no browser connection, durable storage or model evaluation score is claimed.

## Limits

`maxRowScan` defaults to 10,000 visible rows per request. Cell lookup scans once for all requested IDs and fails without reading values if the budget cannot resolve them. Hosts with large datasets can provide a synchronous `resolveRowIndex(rowId)` using their own index; returned positions are checked against the current visible identity. Authorize callbacks must not mutate the engine. Discovery scans at most the same budget, including denied candidates, so a page can be empty with a non-null cursor. Cursors are positional within the current view; restart from zero after query/order changes. Optional host revisions detect stale cursors; without them there is no consistency token.

`maxOutputBytes` defaults to 1,000,000 UTF-8 bytes for successful tool JSON payloads. Both budgets must be positive safe integers. Oversized responses become tool errors; write receipts are checked before mutations. This limits returned payload size, not peak serialization memory or host-supplied document resource size. Hosts remain responsible for limiting stored values, principals, transports and safe error messages.

No browser bridge, HTTP transport setup, remote data, collaborative revisioning, sort/filter/structure tools or autonomous undo tool is included. A standalone server cannot see a browser grid without a host bridge. Bundled documentation must be refreshed after package changes.

## Verification

`npm run test --workspace @acheron-grid/mcp` checks an SDK client/server handshake, resources, reads, conflict-safe atomic updates and core history. Uses SDK transports rather than implementing JSON-RPC.

Apache 2.0 © 2026 Hao Duong.
