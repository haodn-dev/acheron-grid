import ts from 'typescript';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { coreContracts, coreExportContracts, sourceContracts } from './core-contracts.mjs';

const root = new URL('../', import.meta.url);
const previous = JSON.parse(await readFile(new URL('documentation.json', root), 'utf8'));
const program = ts.createProgram(
  ['packages/core/src/headless.ts', 'packages/core/src/engine.ts', 'packages/canvas/src/grid.ts'],
  {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.NodeNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    strict: true,
    skipLibCheck: true,
  },
);
const checker = program.getTypeChecker();
const groups = {
  'Data and lifecycle':
    /^(getValue|getRowId|updateCells(?:Async)?|editCell|replaceText|refreshData|captureRowIdentity|subscribe|takeObserverErrors|destroy|render|rowCount|sourceRowCount|columns)$/,
  'Selection and clipboard':
    /^(select|navigate|extend|clearSelection|getSelection|copySelection|paste|cutSelection|cancelCut)/,
  History: /^(undo|redo|undoAsync|redoAsync|canUndo|canRedo)$/,
  'Views and persistence': /^(setView|view|export|restore)/,
  'Structure and groups':
    /^(insert|delete|move|getMerge|getMerged|canMerge|mergeCells|unmergeCells|getRowGroups|groupRows|ungroupRows|setGroupCollapsed)/,
  'Permissions and formatting': /^(getCellPermission|isLocked|canManageLocks|setLocked|getFormat|canFormat|format)$/,
  'Layout and browser controls': /.*/,
};
const descriptions = {
  updateCells:
    'Typed values; no parsing. Column validation and writable permissions run before one atomic write. Uses visible indices.',
  editCell: 'Editor-style text command: applies parsers, editable/writable permissions and validation.',
  replaceText:
    'Source-only bounded literal replacement. One undo command; permission/validation failures leave the batch unchanged.',
  refreshData:
    'External writes are outside history. All refresh modes clear undo/redo; values mode requires unchanged row IDs/order/count.',
  captureRowIdentity: 'Capture before external structural changes. Explicitly scans all row IDs.',
  destroy: 'Release this instance. Idempotent; host-owned sources and external subscriptions still need host cleanup.',
  setView:
    'Set local sort/filter criteria, not a server query. Structural commands require clearing the projected view.',
  exportState: 'Domain UI state only: excludes row data, callbacks, source transport and undo history.',
  restoreState: 'Validate unknown state before committing; application permissions cannot be replaced by saved state.',
  copySelection: 'TSV text through copy permissions. No direct operating-system clipboard access in core.',
  paste: 'Parse TSV/editor text and preflight the complete destination before writing.',
  undo: 'Replay the last command only if current identities/values/permissions allow it; returns whether replay occurred.',
  redo: 'Reapply a previously undone command under current identity/value/permission checks.',
  setColumnEditor: 'Replace a configured browser editor. Host callbacks remain trusted code.',
  setTheme: 'Validated theme patch; does not recreate the grid or resize rows.',
  render:
    'Schedule a browser repaint. It is not an identity reconciliation command; use refreshData after external changes.',
  exportConfiguration:
    'JSON-safe column order/widths, frozen counts and core-owned view; excludes data, callbacks and history.',
};
for (const [name, file, typeName, optionsName] of [
  ['core', 'packages/core/src/engine.ts', 'GridEngine', 'GridEngineOptions'],
  ['canvas', 'packages/canvas/src/grid.ts', 'Grid', 'GridOptions'],
]) {
  const source = program.getSourceFile(file);
  const exported = checker.getExportsOfModule(checker.getSymbolAtLocation(source));
  const type = checker.getDeclaredTypeOfSymbol(exported.find((symbol) => symbol.name === typeName));
  const grouped = new Map(Object.keys(groups).map((group) => [group, []]));
  for (const symbol of type.getProperties()) {
    const declaration = symbol.valueDeclaration ?? symbol.declarations[0];
    const value = checker.getTypeOfSymbolAtLocation(symbol, declaration);
    const signature = checker.typeToString(
      value,
      declaration,
      ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.UseAliasDefinedOutsideCurrentScope,
    );
    const group = Object.entries(groups).find(([, pattern]) => pattern.test(symbol.name))[0];
    if (name === 'core' && !coreContracts[symbol.name])
      throw new Error('Missing core behavioral contract: ' + symbol.name);
    grouped
      .get(group)
      .push(
        `### ${symbol.name}\n\n\`\`\`ts\n${symbol.name}: ${signature}\n\`\`\`\n\n${name === 'core' ? coreContracts[symbol.name] : (descriptions[symbol.name] ?? ts.displayPartsToString(symbol.getDocumentationComment(checker)) ?? '')}\n`,
      );
  }
  let markdown = `# ${name === 'core' ? 'Core' : 'Canvas'} API signatures\n\nSource-preview catalog generated from the exported TypeScript ${typeName} type. Use the package guide for behavior/examples; do not copy source-only members into an npm 0.1.0 application. Coordinates are zero-based visible indices unless a contract states otherwise.\n\n[Package guide](../packages/${name}/README.md) · [Version policy](versions.md)\n\n`;
  for (const [group, entries] of grouped) if (entries.length) markdown += `## ${group}\n\n${entries.join('\n')}\n`;
  const options = checker.getDeclaredTypeOfSymbol(exported.find((symbol) => symbol.name === optionsName));
  markdown += `## Construction options\n\nCall ${name === 'core' ? 'createGridEngine' : 'createGrid'} with ${optionsName}. Required fields are marked; options are read at construction unless the package guide specifies a runtime setter.\n\n| Field | Required | Type |\n| --- | --- | --- |\n`;
  for (const symbol of options.getProperties()) {
    const declaration = symbol.valueDeclaration ?? symbol.declarations[0];
    const signature = checker
      .typeToString(
        checker.getTypeOfSymbolAtLocation(symbol, declaration),
        declaration,
        ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.UseAliasDefinedOutsideCurrentScope,
      )
      .replaceAll('|', '\\|');
    markdown += `| ${symbol.name} | ${symbol.flags & ts.SymbolFlags.Optional ? 'No' : 'Yes'} | \`${signature}\` |\n`;
  }
  if (name === 'core') {
    const entry = program.getSourceFile('packages/core/src/headless.ts');
    const symbols = checker.getExportsOfModule(checker.getSymbolAtLocation(entry));
    markdown +=
      '\n## Public exports and source interfaces\n\nThe root and headless alias expose the same API. Source interfaces use their own row indices, not an engine visible projection. The table lists every public export, including types; declarations and the package guide define their contracts. createAsyncDataSource and createLiveDataSource remain read-only; createPagedRemoteDataSource adds explicit writable paging.\n\n| Export | Kind | Defined in | Contract |\n| --- | --- | --- | --- |\n';
    for (const symbol of symbols) {
      const target = symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
      const declaration = target.valueDeclaration ?? target.declarations?.[0];
      const runtime = !!(target.flags & ts.SymbolFlags.Value);
      if (runtime && !coreExportContracts[symbol.name])
        throw new Error('Missing exported core contract: ' + symbol.name);
      markdown += `| ${symbol.name} | ${runtime ? 'Runtime' : 'Type'} | ${declaration?.getSourceFile().fileName.split(/[\\/]/).at(-1) ?? 'inferred'} | ${runtime ? coreExportContracts[symbol.name] : 'Compile-time contract; see the exported type definitions below or engine construction/member signatures.'} |\n`;
    }
    for (const symbol of symbols.filter((symbol) =>
      [
        'LocalDataSource',
        'LocalDataView',
        'createAsyncDataSource',
        'createLiveDataSource',
        'createRemoteDataSource',
        'createPagedRemoteDataSource',
      ].includes(symbol.name),
    )) {
      const target = checker.getAliasedSymbol(symbol),
        declaration = target.valueDeclaration ?? target.declarations[0];
      const value = checker.getTypeOfSymbolAtLocation(target, declaration);
      const instance =
        value.getConstructSignatures()[0]?.getReturnType() ?? value.getCallSignatures()[0]?.getReturnType();
      markdown += `\n### ${symbol.name} source members\n\nUse source indices here; engine selection/value APIs use visible indices.${symbol.name === 'LocalDataView' ? ' This view fixes a projection at construction; rebuild it to reapply criteria.' : ''}\n\n\`\`\`ts\n`;
      const members = instance
        .getProperties()
        .filter(
          (member) =>
            !(
              ts.getCombinedModifierFlags(member.valueDeclaration ?? member.declarations[0]) & ts.ModifierFlags.Private
            ),
        );
      for (const member of members) {
        const node = member.valueDeclaration ?? member.declarations[0];
        markdown += `${member.name}${member.flags & ts.SymbolFlags.Optional ? '?' : ''}: ${checker.typeToString(checker.getTypeOfSymbolAtLocation(member, node), node, ts.TypeFormatFlags.NoTruncation | ts.TypeFormatFlags.UseAliasDefinedOutsideCurrentScope)}\n`;
      }
      markdown += '\`\`\`\n';
      markdown += '\n| Source member | Behavior |\n| --- | --- |\n';
      for (const member of members) {
        if (!sourceContracts[member.name])
          throw new Error('Missing source contract: ' + symbol.name + '.' + member.name);
        const absent =
          ['createAsyncDataSource', 'createLiveDataSource'].includes(symbol.name) &&
          ['getRow', 'addColumns', 'spliceRows', 'setValue', 'setValues'].includes(member.name);
        markdown += `| ${member.name} | ${absent ? 'Optional DataSource compatibility slot; not implemented by this read-only factory and undefined at runtime.' : sourceContracts[member.name]} |\n`;
      }
    }
    markdown +=
      '\n## Exported type definitions\n\nThese declaration excerpts describe compile-time contracts, not executable examples or runtime validators. GridEngine members and GridEngineOptions are catalogued above. Unknown persisted/clipboard input still requires its validation API; never trust a TypeScript assertion as validation.\n';
    for (const symbol of symbols) {
      const target = symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol;
      if (target.flags & ts.SymbolFlags.Value || ['GridEngine', 'GridEngineOptions'].includes(symbol.name)) continue;
      const declaration = target.declarations?.[0];
      markdown += `\n### Type ${symbol.name}\n\n\`\`\`ts\n${declaration.getText()}\n\`\`\`\n`;
    }
  }
  await writeFile(new URL(`guides/${name}-api.md`, root), markdown);
}
const entries = [
  [
    'architecture',
    'guides/architecture.md',
    1,
    'Headless package/module map, controlled mutations, source lifecycles and extension boundaries.',
  ],
  [
    'bulk-commands',
    'guides/bulk-commands.md',
    1,
    'Cooperative bulk preparation, cancellation, atomic commit limits and retained history budgets.',
  ],
  [
    'paged-remote',
    'guides/paged-remote.md',
    1,
    'Stable-ID writable paging, query/revision lifecycle, dirty-cohort receipts and runnable HTTP example.',
  ],
  ['getting-started', 'guides/getting-started.md', 1, 'Complete pinned-install browser example and troubleshooting.'],
  [
    'integration',
    'guides/integration.md',
    2,
    'Clarify async request limits, positional page invalidation and dataset revision ownership.',
  ],
  ['frameworks', 'guides/frameworks.md', 1, 'Canonical React/Vue lifecycle guide.'],
  ['ai', 'guides/ai-integration.md', 1, 'Canonical public integration and host boundaries.'],
  ['versions', 'guides/versions.md', 1, 'Separate package releases, source previews and per-document revisions.'],
  [
    'core-api',
    'guides/core-api.md',
    1,
    'Complete behavioral contracts for every engine member, all public exports and source interface signatures.',
  ],
  ['canvas-api', 'guides/canvas-api.md', 1, 'Generated source API signatures and construction options.'],
  ...['core', 'canvas', 'react', 'vue', 'markdown', 'mcp', 'export', 'charts'].map((name) => [
    name,
    `packages/${name}/README.md`,
    2,
    name === 'core'
      ? 'Audit all core components; correct lifecycle example, formatting, refresh, selection and async contracts.'
      : 'Align publication status, installation and current source contracts.',
  ]),
  ['security', 'SECURITY.md', 1, 'Host authorization and untrusted-data boundaries.'],
  ['support', 'SUPPORT.md', 1, 'Verified environments and practical limits.'],
  [
    'editing-and-remote',
    'guides/editing-and-remote.md',
    1,
    'Paste special, hidden axes, number formats, Canvas localization and bounded remote write lifecycle.',
  ],
  [
    'manual-validation',
    'guides/manual-validation.md',
    1,
    'Manual accessibility, device, clipboard and operational acceptance protocol.',
  ],
];
const documents = [];
for (const [id, path, revision, summary] of entries) {
  const text = (await readFile(new URL(path, root), 'utf8')).replaceAll('\r\n', '\n');
  const sha256 = createHash('sha256').update(text).digest('hex'),
    prior = previous.documents.find((doc) => doc.id === id);
  if (prior?.sha256 === sha256) {
    documents.push(prior);
    continue;
  }
  const nextRevision = prior ? prior.revision + 1 : revision;
  documents.push({
    id,
    path,
    revision: nextRevision,
    updated: new Date().toISOString().slice(0, 10),
    sha256,
    history: [...(prior?.history ?? []), { revision: nextRevision, summary }],
  });
}
const sourceRevision = execFileSync('git', ['rev-parse', 'HEAD'], {
  cwd: fileURLToPath(root),
  encoding: 'utf8',
}).trim();
await writeFile(
  new URL('documentation.json', root),
  JSON.stringify({ ...previous, sourceRevision, documents }, null, 2) + '\n',
);
await mkdir(new URL('packages/mcp/docs/', root), { recursive: true });
for (const name of ['core', 'canvas', 'react', 'vue', 'markdown', 'export', 'charts']) {
  const text = (await readFile(new URL(`packages/${name}/README.md`, root), 'utf8'))
    .replaceAll('../../guides/', '../../../guides/')
    .replaceAll('../../examples/', '../../../examples/');
  await writeFile(new URL(`packages/mcp/docs/${name}.md`, root), text);
}
console.log(`Synced ${documents.length} versioned documents and public API catalogs.`);
