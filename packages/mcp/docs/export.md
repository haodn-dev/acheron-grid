# @acheron-grid/export

Optional, free MIT-licensed CSV and XLSX selection export. Unreleased source preview; this package is not yet on npm. It uses public core APIs and requires no browser globals. The host owns saving/downloading the returned text or bytes.

```ts
import { exportSelectionCsv } from '@acheron-grid/export';

const csv = exportSelectionCsv(engine, { includeHeaders: true, bom: true });
```

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
