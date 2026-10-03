# @acheron-grid/markdown

Optional Markdown adapter for Acheron Grid. This experimental package depends on `marked`; core and Canvas do not. It does not require a DOM or import either grid package at runtime.

Build the repository, then install this package alongside core and Canvas in an application with an ESM bundler:

```sh
npm install /path/to/acheron-grid-engine/packages/markdown
```

```ts
import { markdownToHtml } from '@acheron-grid/markdown';

const grid = createGrid({
  container, columns, dataSource,
  richTextColumns: { notes: 'markdown', description: 'html' },
  markdownToHtml,
  wrapText: true,
  autoRowHeight: true,
  multilineEditor: true,
});
```

The adapter uses a private Marked instance with GFM disabled and raw HTML tokens omitted. It supports CommonMark-oriented syntax, including emphasis, links, code and lists. It is not a full document renderer or a claim of complete CommonMark conformance. Underline is available only in HTML columns using `<u>`; `__text__` means bold in Markdown. Soft line breaks become spaces; use two trailing spaces or a backslash before a newline for a hard break.

`markdownToHtml(source)` returns HTML for the Canvas text projection. **It does not sanitize HTML for arbitrary DOM insertion.** Canvas reads allowed formatting from an inert template, validates link URLs and paints text rather than mounting the markup. Applications inserting the output into the DOM must sanitize it independently. Images are shown as alt text, with no resource loading. Sources longer than 100,000 characters are rejected by the adapter; Canvas falls back to plain source text.

Applications may provide their own synchronous `markdownToHtml` callback instead. Canvas still applies its restricted text projection and URL validation. The standalone default playground does not import this adapter; direct browser users need an import map for the adapter and its `marked` dependency.

Licensed under MIT. Marked retains its own MIT license.
