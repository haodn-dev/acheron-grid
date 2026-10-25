import ts from 'typescript';
import assert from 'node:assert/strict';
import { readFile, mkdir, mkdtemp, writeFile, rm, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, sep, dirname } from 'node:path';
import { spawnSync } from 'node:child_process';
import { coreContracts, coreExportContracts } from '../scripts/core-contracts.mjs';
import { marked } from 'marked';

const changed = JSON.parse(process.env.CI_CHANGED_FILES ?? '[]');
for (const path of new Set(['README.md', ...changed.filter((file) => file.endsWith('.md'))])) {
  try {
    await access(path);
  } catch (error) {
    if (error.code === 'ENOENT' && path !== 'README.md') continue;
    throw error;
  }
  const tokens = marked.lexer(await readFile(path, 'utf8'));
  const links = [];
  marked.walkTokens(tokens, (token) => {
    if (token.type === 'link' || token.type === 'image') links.push(token.href);
  });
  for (const href of links) {
    if (/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(href)) continue;
    const [file, hash] = href.split('#');
    const target = resolve(dirname(path), decodeURIComponent(file.split('?')[0] || '.'));
    const targetFile = file ? target : resolve(path);
    await access(targetFile);
    if (hash && targetFile.endsWith('.md')) {
      const headings = marked.lexer(await readFile(targetFile, 'utf8')).filter((token) => token.type === 'heading');
      const slugs = headings.map((token) =>
        token.text
          .toLowerCase()
          .replace(/[`*_]/g, '')
          .replace(/[^\p{L}\p{N}\s-]/gu, '')
          .replace(/\s/g, '-'),
      );
      assert.ok(slugs.includes(decodeURIComponent(hash)), `${path}: broken heading ${href}`);
    }
  }
  if (path === 'README.md') {
    const tables = tokens.filter((token) => token.type === 'table');
    const packages = tables.find((table) => table.header[0].text === 'Package');
    const commands = tables.find((table) => table.header[0].text === 'Command');
    assert.equal(packages?.header.length, 4, 'Package table must render separate npm badge cells.');
    assert.equal(commands?.header.length, 2, 'Command table must render as a two-column table.');
    assert.equal(packages.rows.length, 8, 'Keep all eight package references.');
    for (const row of packages.rows)
      assert.ok(
        row[3].tokens.some((token) => token.type === 'link'),
        'Missing linked npm badge.',
      );
  }
}
const manifest = JSON.parse(await readFile('documentation.json', 'utf8'));
const canvasReadme = await readFile('packages/canvas/README.md', 'utf8');
assert.ok(
  Math.max(canvasReadme.length, Buffer.byteLength(canvasReadme)) <= 65_536,
  'Canvas npm README must not be truncated by the registry.',
);
assert.ok(
  manifest.documents.some((doc) => doc.id === 'canvas-recipes' && doc.path === 'guides/canvas-recipes.md'),
  'Advanced Canvas recipes must remain in the canonical document catalog.',
);
for (const name of ['core', 'canvas', 'react', 'vue', 'markdown', 'export', 'charts']) {
  const file = `packages/mcp/docs/${name}.md`;
  for (const [, href] of (await readFile(file, 'utf8')).matchAll(/\]\(([^\s)]+)\)/g)) {
    if (/^(?:https?:|acheron:|mailto:|#)/i.test(href)) continue;
    assert.ok(!href.startsWith('/'), `MCP snapshot link needs an origin: ${file}: ${href}`);
    await access(resolve(dirname(file), decodeURIComponent(href.split(/[?#]/)[0])));
  }
}
for (const doc of manifest.documents) {
  const text = (await readFile(doc.path, 'utf8')).replaceAll('\r\n', '\n');
  assert.equal(createHash('sha256').update(text).digest('hex'), doc.sha256, `Stale docs manifest: ${doc.id}`);
}
const synced = spawnSync(process.execPath, ['scripts/sync-docs.mjs'], { encoding: 'utf8' });
assert.equal(synced.status, 0, synced.stderr);
assert.deepEqual(
  JSON.parse(await readFile('documentation.json', 'utf8')).documents,
  manifest.documents,
  'Unchanged documents must retain revision/date/history.',
);
await mkdir('test-results', { recursive: true });
const directory = await mkdtemp('test-results/docs-consumer-');
try {
  const files = [];
  for (const path of [
    'README.md',
    'guides/getting-started.md',
    'packages/export/README.md',
    'packages/charts/README.md',
    'guides/paged-remote.md',
  ]) {
    const text = await readFile(path, 'utf8');
    const code = [...text.matchAll(/```ts\n([\s\S]*?)```/g)][0][1];
    const file = directory + '/' + path.replaceAll('/', '-') + '.ts';
    await writeFile(file, code);
    files.push(file);
  }
  const remoteGuide = await readFile('guides/editing-and-remote.md', 'utf8');
  const remoteCode = [...remoteGuide.matchAll(/```ts\n([\s\S]*?)```/g)].find(([, code]) =>
    code.includes('createRemoteDataSource'),
  )?.[1];
  assert.ok(remoteCode);
  const remoteFile = directory + '/remote-lifecycle.ts';
  await writeFile(remoteFile, remoteCode);
  files.push(remoteFile);
  const recoveryCode = [...remoteGuide.matchAll(/```ts\n([\s\S]*?)```/g)].find(([, code]) =>
    code.includes('RemoteMutationCheckpoint'),
  )?.[1];
  assert.ok(recoveryCode);
  const recoveryFile = directory + '/remote-recovery.ts';
  await writeFile(recoveryFile, recoveryCode);
  files.push(recoveryFile);
  const core = await readFile('packages/core/README.md', 'utf8');
  const exportGuide = await readFile('packages/export/README.md', 'utf8');
  const htmlCode = [...exportGuide.matchAll(/```ts\n([\s\S]*?)```/g)].find(([, code]) =>
    code.includes('renderHtmlTable'),
  )?.[1];
  assert.ok(htmlCode, 'Missing complete HTML snapshot example.');
  const htmlExample = directory + '/html-snapshot.ts';
  await writeFile(htmlExample, htmlCode);
  files.push(htmlExample);
  const htmlRuntime = directory + '/html-snapshot.mjs';
  await writeFile(htmlRuntime, htmlCode);
  const htmlExecuted = spawnSync(process.execPath, [htmlRuntime], { encoding: 'utf8' });
  assert.equal(htmlExecuted.status, 0, htmlExecuted.stderr);
  assert.match(htmlExecuted.stdout, /<th scope="col">Name<\/th>/);
  const lifecycle = [...core.matchAll(/```ts\n([\s\S]*?)```/g)].find(([, code]) =>
    code.includes('source.spliceRows'),
  )?.[1];
  assert.ok(lifecycle, 'Missing complete lifecycle example.');
  const example = directory + '/core-lifecycle.ts';
  await writeFile(example, lifecycle);
  files.push(example);
  const runtime = directory + '/core-lifecycle.mjs';
  await writeFile(runtime, lifecycle);
  const executed = spawnSync(process.execPath, [runtime], { encoding: 'utf8' });
  assert.equal(executed.status, 0, executed.stderr);
  const program = ts.createProgram(files, {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    strict: true,
    noEmit: true,
    skipLibCheck: true,
  });
  const diagnostics = ts.getPreEmitDiagnostics(program);
  assert.equal(
    diagnostics.length,
    0,
    ts.formatDiagnosticsWithColorAndContext(diagnostics, {
      getCanonicalFileName: (path) => path,
      getCurrentDirectory: () => process.cwd(),
      getNewLine: () => '\n',
    }),
  );
  for (const name of ['core', 'canvas']) {
    const catalog = await readFile(`guides/${name}-api.md`, 'utf8');
    for (const method of ['updateCells', 'refreshData', 'exportState', 'destroy'])
      assert.ok(catalog.includes('### ' + method));
    if (name === 'core') {
      for (const [member, contract] of Object.entries(coreContracts)) {
        assert.ok(catalog.includes('### ' + member + '\n'), member);
        assert.ok(catalog.includes(contract), 'Missing behavior: ' + member);
      }
      for (const source of [
        'LocalDataSource',
        'LocalDataView',
        'createAsyncDataSource',
        'createLiveDataSource',
        'createRemoteDataSource',
        'createPagedRemoteDataSource',
      ])
        assert.ok(catalog.includes('### ' + source + ' source members'));
    }
  }
  const publicCatalog = await readFile('guides/core-api.md', 'utf8');
  for (const contract of Object.values(coreExportContracts)) assert.ok(publicCatalog.includes(contract));
  console.log(
    'PASS: Markdown links/tables/images, document hashes, nine TypeScript examples, executable HTML/core lifecycle and core/Canvas API catalogs.',
  );
} finally {
  assert.ok(resolve(directory).startsWith(resolve('test-results') + sep));
  await rm(directory, { recursive: true, force: true });
}
