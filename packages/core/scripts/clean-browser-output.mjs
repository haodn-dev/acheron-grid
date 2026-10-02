import { rm } from 'node:fs/promises';

// Older builds emitted browser files here; exclude them from the headless package.
for (const file of ['grid.js', 'grid.js.map', 'grid.d.ts']) {
  await rm(new URL('../dist/' + file, import.meta.url), { force: true });
}
