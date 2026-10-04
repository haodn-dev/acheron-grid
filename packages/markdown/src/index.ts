import { Marked } from 'marked';

const parser = new Marked({ gfm: false, async: false, renderer: { html: () => '' } });

/** CommonMark-oriented parsing with raw HTML disabled. Output is not sanitized HTML. */
export function markdownToHtml(source: string): string {
  if (source.length > 100_000) throw new RangeError('Markdown source exceeds 100,000 characters.');
  return parser.parse(source, { async: false });
}
