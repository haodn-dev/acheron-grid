# @acheron-grid/export

Optional, free Apache-2.0-licensed CSV and XLSX selection export. Unreleased source preview; this package is not yet on npm. It uses public core APIs and requires no browser globals. The host owns saving/downloading the returned text or bytes.

## Installation and complete example

Build a source revision that includes export. Pack core and export, then install both tarballs in the same command; `npm install @acheron-grid/export@0.1.0` is not a published installation path. See [source installation](../../../guides/getting-started.md#build-a-source-preview).

```ts
import { createGridEngine, LocalDataSource } from '@acheron-grid/core';
import { exportSelectionCsv, exportSelectionXlsx } from '@acheron-grid/export';

const engine = createGridEngine({
  columns: [{key:'name',title:'Name'}, {key:'score',title:'Score'}],
  dataSource: new LocalDataSource([{id:'r1',name:'Ada',score:42}], row=>row.id),
});
engine.selectRange({startRow:0,endRow:0,startColumn:0,endColumn:1});
const csv = exportSelectionCsv(engine, {includeHeaders:true,bom:true});
const workbook = exportSelectionXlsx(engine, {includeHeaders:true,sheetName:'Scores'});
console.log(csv, workbook.byteLength);
engine.destroy();
```

The example is headless and does not download a file. In the browser, create a Blob from the result, trigger your application's download and revoke its object URL afterward.

Select exactly one rectangular range before exporting. The core copy pipeline enforces `copyable`, visible order, merged-cell placeholders and clipboard limits (100,000 cells / 10 million UTF-16 code units). Disjoint selections are rejected. CSV uses commas, CRLF and double-quote escaping. Output also has a 10-million-unit cap after escaping, including headers, separators and an optional UTF-8 BOM marker.

Formula protection defaults to prefixing an apostrophe when text begins with `=`, `+`, `-` or `@` after whitespace. Since clipboard values are text, this also escapes negative numeric text. Set `formulaProtection: 'preserve'` only when you intentionally need exact text and control how recipients import it. Spreadsheet applications may transform escaping on import/resave; CSV is not an authorization boundary.

CSV is text export; it does not preserve workbook types. Copy permission does not replace server authorization.

## XLSX values export

```ts
import { exportSelectionXlsx } from '@acheron-grid/export';
const bytes = exportSelectionXlsx(engine, { includeHeaders: true, sheetName: 'Data' });
```

Returns a single-sheet XLSX `Uint8Array`. It uses the same rectangular copy permission/order/merge-placeholder pipeline. Finite numbers and booleans retain types when raw values match the clipboard text; other cells are inline strings. Formula-looking strings remain text and never become formulas or hyperlinks. XML escaping, Unicode and literal Excel `_xNNNN_` sequences are preserved; invalid XML characters are rejected. Numeric precision remains subject to the receiving spreadsheet application's limits.

Existing clipboard limits apply. Additional limits: 32,767 UTF-16 units per text cell, 20 million units across XML parts, 40 MB of uncompressed archive input and Excel's sheet/name dimensions. ZIP creation is synchronous, intended for bounded selections. Use a host worker for expensive exports. No workbook import, styles, media, formulas, date semantics, merged spans, multi-sheet export, streaming or automatic remote traversal.

ZIP/UTF-8 support comes from [fflate](https://github.com/101arrowz/fflate), MIT licensed, confined to this optional module. Its license is included in the package.

Default CSV escaping also covers leading control characters and full-width formula operators. Spreadsheet applications can reinterpret CSV after edits or re-saving; use XLSX inline strings for untrusted text when available. CSV escaping is not a universal spreadsheet execution guarantee. See [CSV injection guidance](https://community.owasp.org/attacks/CSV_Injection).
