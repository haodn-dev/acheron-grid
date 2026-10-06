#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createGridMcpServer } from './index.js';
const documents = Object.fromEntries(
  await Promise.all(
    ['core', 'canvas', 'react', 'vue', 'markdown', 'export', 'charts'].map(async (name) => [
      name,
      await readFile(new URL(`../docs/${name}.md`, import.meta.url), 'utf8'),
    ]),
  ),
);
await createGridMcpServer({ documents }).connect(new StdioServerTransport());
