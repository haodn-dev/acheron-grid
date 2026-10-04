import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import type { GridEngine, RowId } from '@acheron-grid/core';
export interface GridMcpOptions {
 engine?: GridEngine;
 documents?: Readonly<Record<string, string>>;
 authorize?: (request: { operation: 'schema' | 'read' | 'write'; rowId?: RowId; columnKey?: string }) => boolean;
 allowWrites?: boolean;
 validateWrite?: (cell: { rowId: RowId; columnKey: string; value: unknown }) => void;
}
export function createGridMcpServer(options: GridMcpOptions): Server;
