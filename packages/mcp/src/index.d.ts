import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import type { GridEngine, RowId } from '@acheron-grid/core';
export interface GridMcpOptions {
 engine?: GridEngine;
 documents?: Readonly<Record<string, string>>;
 authorize?: (request: { operation: 'schema' | 'read' | 'write' | 'discover'; rowId?: RowId; columnKey?: string }) => boolean;
 allowDiscovery?: boolean;
 maxRowScan?: number;
 maxOutputBytes?: number;
 resolveRowIndex?: (rowId: RowId) => number | null | undefined;
 /** Synchronous, side-effect-free token; change on data, view, permissions or dataset replacement. */
 getRevision?: () => string;
 allowWrites?: boolean;
 validateWrite?: (cell: { rowId: RowId; columnKey: string; value: unknown }) => void;
}
export function createGridMcpServer(options: GridMcpOptions): Server;
