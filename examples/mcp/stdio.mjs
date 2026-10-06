import { readFile, stat } from 'node:fs/promises';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createTaskApplication, sampleTasks } from './tasks.mjs';

const args = process.argv.slice(2);
const allowWrites = args.includes('--allow-writes');
const files = args.filter(arg => arg !== '--allow-writes');
if (files.length > 1 || files.some(arg => arg.startsWith('--'))) throw new Error('Usage: node examples/mcp/stdio.mjs [tasks.json] [--allow-writes]');
let rows = sampleTasks;
if (files.length) {
  if ((await stat(files[0])).size > 1_000_000) throw new Error('Task file exceeds 1 MB.');
  const bytes = await readFile(files[0]);
  if (bytes.length > 1_000_000) throw new Error('Task file exceeds 1 MB.');
  rows = JSON.parse(bytes.toString('utf8'));
}
const { engine, server } = createTaskApplication(rows, { allowWrites });
server.onclose = () => engine.destroy();
await server.connect(new StdioServerTransport());
