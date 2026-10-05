import ts from 'typescript';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';

const root=new URL('../',import.meta.url);
const program=ts.createProgram(['packages/core/src/engine.ts','packages/canvas/src/grid.ts'],{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.NodeNext,moduleResolution:ts.ModuleResolutionKind.NodeNext,strict:true,skipLibCheck:true});
const checker=program.getTypeChecker();
const groups={
  'Data and lifecycle':/^(getValue|getRowId|updateCells|editCell|replaceText|refreshData|captureRowIdentity|subscribe|takeObserverErrors|destroy|render|rowCount|sourceRowCount|columns)$/,
  'Selection and clipboard':/^(select|navigate|extend|clearSelection|getSelection|copySelection|paste|cutSelection|cancelCut)/,
  'History':/^(undo|redo|canUndo|canRedo)$/,
  'Views and persistence':/^(setView|view|export|restore)/,
  'Structure and groups':/^(insert|delete|move|getMerge|getMerged|canMerge|mergeCells|unmergeCells|getRowGroups|groupRows|ungroupRows|setGroupCollapsed)/,
  'Permissions and formatting':/^(getCellPermission|isLocked|canManageLocks|setLocked|getFormat|canFormat|format)$/,
  'Layout and browser controls':/.*/,
};
const descriptions={updateCells:'Typed values; no parsing. Column validation and writable permissions run before one atomic write. Uses visible indices.',editCell:'Editor-style text command: applies parsers, editable/writable permissions and validation.',replaceText:'Source-only bounded literal replacement. One undo command; permission/validation failures leave the batch unchanged.',refreshData:'External writes are outside history. All refresh modes clear undo/redo; values mode requires unchanged row IDs/order/count.',captureRowIdentity:'Capture before external structural changes. Explicitly scans all row IDs.',destroy:'Release this instance. Idempotent; host-owned sources and external subscriptions still need host cleanup.',setView:'Set local sort/filter criteria, not a server query. Structural commands require clearing the projected view.',exportState:'Domain UI state only: excludes row data, callbacks, source transport and undo history.',restoreState:'Validate unknown state before committing; application permissions cannot be replaced by saved state.',copySelection:'TSV text through copy permissions. No direct operating-system clipboard access in core.',paste:'Parse TSV/editor text and preflight the complete destination before writing.',undo:'Replay the last command only if current identities/values/permissions allow it; returns whether replay occurred.',redo:'Reapply a previously undone command under current identity/value/permission checks.',setColumnEditor:'Replace a configured browser editor. Host callbacks remain trusted code.',setTheme:'Validated theme patch; does not recreate the grid or resize rows.',render:'Schedule a browser repaint. It is not an identity reconciliation command; use refreshData after external changes.',exportConfiguration:'JSON-safe column order/widths, frozen counts and core-owned view; excludes data, callbacks and history.'};
for(const [name,file,typeName,optionsName] of [['core','packages/core/src/engine.ts','GridEngine','GridEngineOptions'],['canvas','packages/canvas/src/grid.ts','Grid','GridOptions']]){
  const source=program.getSourceFile(file);const exported=checker.getExportsOfModule(checker.getSymbolAtLocation(source));
  const type=checker.getDeclaredTypeOfSymbol(exported.find(symbol=>symbol.name===typeName));
  const grouped=new Map(Object.keys(groups).map(group=>[group,[]]));
  for(const symbol of type.getProperties()){
    const declaration=symbol.valueDeclaration??symbol.declarations[0];const value=checker.getTypeOfSymbolAtLocation(symbol,declaration);
    const signature=checker.typeToString(value,declaration,ts.TypeFormatFlags.NoTruncation|ts.TypeFormatFlags.UseAliasDefinedOutsideCurrentScope);
    const group=Object.entries(groups).find(([,pattern])=>pattern.test(symbol.name))[0];
    grouped.get(group).push(`### ${symbol.name}\n\n\`\`\`ts\n${symbol.name}: ${signature}\n\`\`\`\n\n${descriptions[symbol.name]??ts.displayPartsToString(symbol.getDocumentationComment(checker))??''}\n`);
  }
  let markdown=`# ${name==='core'?'Core':'Canvas'} API signatures\n\nSource-preview catalog generated from the exported TypeScript ${typeName} type. Use the package guide for behavior/examples; do not copy source-only members into an npm 0.1.0 application. Coordinates are zero-based visible indices unless a contract states otherwise.\n\n[Package guide](../packages/${name}/README.md) · [Version policy](versions.md)\n\n`;
  for(const [group,entries] of grouped)if(entries.length)markdown+=`## ${group}\n\n${entries.join('\n')}\n`;
  const options=checker.getDeclaredTypeOfSymbol(exported.find(symbol=>symbol.name===optionsName));
  markdown+=`## Construction options\n\nCall ${name==='core'?'createGridEngine':'createGrid'} with ${optionsName}. Required fields are marked; options are read at construction unless the package guide specifies a runtime setter.\n\n| Field | Required | Type |\n| --- | --- | --- |\n`;
  for(const symbol of options.getProperties()){
    const declaration=symbol.valueDeclaration??symbol.declarations[0];const signature=checker.typeToString(checker.getTypeOfSymbolAtLocation(symbol,declaration),declaration,ts.TypeFormatFlags.NoTruncation|ts.TypeFormatFlags.UseAliasDefinedOutsideCurrentScope).replaceAll('|','\\|');
    markdown+=`| ${symbol.name} | ${symbol.flags&ts.SymbolFlags.Optional?'No':'Yes'} | \`${signature}\` |\n`;
  }
  await writeFile(new URL(`guides/${name}-api.md`,root),markdown);
}
const entries=[
 ['getting-started','guides/getting-started.md',1,'Complete pinned-install browser example and troubleshooting.'],
 ['integration','guides/integration.md',2,'Clarify typed values, parsing, coordinates, lifecycle and permissions.'],
 ['frameworks','guides/frameworks.md',1,'Canonical React/Vue lifecycle guide.'],
 ['ai','guides/ai-integration.md',1,'Canonical public integration and host boundaries.'],
 ['versions','guides/versions.md',1,'Separate package releases, source previews and per-document revisions.'],
 ['core-api','guides/core-api.md',1,'Generated source API signatures and construction options.'],
 ['canvas-api','guides/canvas-api.md',1,'Generated source API signatures and construction options.'],
 ...['core','canvas','react','vue','markdown','mcp','export','charts'].map(name=>[name,`packages/${name}/README.md`,2,'Align publication status, installation and current source contracts.']),
 ['security','SECURITY.md',1,'Host authorization and untrusted-data boundaries.'],
 ['support','SUPPORT.md',1,'Verified environments and practical limits.'],
];
const documents=[];
for(const [id,path,revision,summary] of entries){
 const text=(await readFile(new URL(path,root),'utf8')).replaceAll('\r\n','\n');
 documents.push({id,path,revision,updated:'2026-10-05',sha256:createHash('sha256').update(text).digest('hex'),history:[...(revision>1?[{revision:1,summary:'Previous public reference; see source revision 9cff1ab.'}]:[]),{revision,summary}]});
}
await writeFile(new URL('documentation.json',root),JSON.stringify({schema:1,sourceRevision:'9cff1ab87353f39cdbf2bedb0b5de3219ef60e92',release:{version:'0.1.0',tag:'v0.1.0',revision:'f34e22765456d644bcae08ebb52241ae6a71238b'},documents},null,2)+'\n');
await mkdir(new URL('packages/mcp/docs/',root),{recursive:true});
for(const name of ['core','canvas','react','vue','markdown','export','charts']){
  const text=(await readFile(new URL(`packages/${name}/README.md`,root),'utf8')).replaceAll('../../guides/','../../../guides/').replaceAll('../../examples/','../../../examples/');
  await writeFile(new URL(`packages/mcp/docs/${name}.md`,root),text);
}
console.log(`Synced ${documents.length} versioned documents and public API catalogs.`);
