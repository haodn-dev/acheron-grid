# @acheron-grid/export

Optional, free MIT-licensed CSV selection export. Unreleased source preview; this package is not yet on npm. It uses public core APIs and requires no browser globals. The host owns saving/downloading the returned text.

```ts
import { exportSelectionCsv } from '@acheron-grid/export';

const csv = exportSelectionCsv(engine, { includeHeaders: true, bom: true });
```

Select exactly one rectangular range before exporting. The core copy pipeline enforces `copyable`, visible order, merged-cell placeholders and clipboard limits (100,000 cells / 10 million UTF-16 code units). Disjoint selections are rejected. CSV uses commas, CRLF and double-quote escaping. Output also has a 10-million-unit cap after escaping, including headers, separators and an optional UTF-8 BOM marker.

Formula protection defaults to prefixing an apostrophe when text begins with `=`, `+`, `-` or `@` after whitespace. Since clipboard values are text, this also escapes negative numeric text. Set `formulaProtection: 'preserve'` only when you intentionally need exact text and control how recipients import it. Spreadsheet applications may transform escaping on import/resave; CSV is not an authorization boundary.

This is text export, not a typed workbook: no styles, images, formulas, XLSX, streaming or automatic remote dataset traversal. Copy permission does not replace server authorization.
