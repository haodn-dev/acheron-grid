import type { Column, GridEngine } from '@acheron-grid/core';

export type HtmlTableSource = Pick<GridEngine, 'columns' | 'rowCount' | 'getValue'> &
  Partial<Pick<GridEngine, 'getCellPermission' | 'isRowHidden' | 'isColumnHidden' | 'getMerge'>>;

export interface HtmlTableOptions {
  /** Host authorization is required, including for sources without engine permissions. */
  readonly authorize: (rowIndex: number, columnKey: string) => boolean;
  readonly columns?: readonly string[];
  readonly offset?: number;
  readonly limit?: number;
  readonly caption?: string;
  readonly lang?: string;
  /** Return text only. The result is always escaped, including custom HTML/Markdown. */
  readonly getCellLabel?: (rowIndex: number, column: Readonly<Column>, value: unknown) => string;
}

/** Bounded, synchronous HTML snapshot; never changes selection or loads remote pages. */
export function renderHtmlTable(source: HtmlTableSource, options: HtmlTableOptions): string {
  const offset = options?.offset === undefined ? 0 : options.offset;
  const limit = options?.limit === undefined ? 100 : options.limit;
  if (!options || typeof options.authorize !== 'function') throw new TypeError('HTML requires host authorization.');
  if (
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    !Number.isSafeInteger(limit) ||
    limit < 0 ||
    limit > 100_000 ||
    !Number.isSafeInteger(source.rowCount) ||
    source.rowCount < 0
  )
    throw new RangeError('Invalid HTML page bounds.');
  if (
    (options.caption !== undefined && typeof options.caption !== 'string') ||
    (options.lang !== undefined && typeof options.lang !== 'string') ||
    (options.getCellLabel !== undefined && typeof options.getCellLabel !== 'function') ||
    (options.columns !== undefined &&
      (!Array.isArray(options.columns) || [...options.columns].some((key) => typeof key !== 'string')))
  )
    throw new TypeError('Invalid HTML options.');
  const keys = options.columns ?? source.columns.map((column) => column.key);
  if (new Set(keys).size !== keys.length) throw new TypeError('Duplicate HTML columns.');
  const available = new Map(source.columns.map((column, index) => [column.key, { column, index }]));
  if (available.size !== source.columns.length) throw new TypeError('Duplicate HTML source columns.');
  const columns = keys
    .map((key) => {
      const entry = available.get(key);
      if (!entry) throw new RangeError('Unknown HTML column.');
      return entry;
    })
    .filter(({ index }) => !source.isColumnHidden?.(index));
  const end = offset + Math.min(limit, Math.max(0, source.rowCount - offset));
  if ((end - offset) * columns.length > 100_000) throw new RangeError('HTML page is too large.');
  const rows: number[] = [];
  if (columns.length)
    for (let row = offset; row < end; row++) {
      if (source.isRowHidden?.(row)) continue;
      for (const { column, index } of columns) {
        if (
          options.authorize(row, column.key) !== true ||
          (source.getCellPermission && source.getCellPermission(row, index).copyable !== true)
        )
          throw new Error('HTML cell export is not authorized or copyable.');
      }
      rows.push(row);
    }
  let length = 0;
  const chunks: string[] = [];
  const append = (text: string) => {
    length += text.length;
    if (length > 10_000_000) throw new RangeError('HTML output is too large.');
    chunks.push(text);
  };
  const escape = (text: string): string => {
    if (typeof text !== 'string') throw new TypeError('HTML labels must be strings.');
    if (text.length + length > 10_000_000) throw new RangeError('HTML output is too large.');
    return text.replace(
      /[&<>"']/g,
      (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!,
    );
  };
  append('<table' + (options.lang === undefined ? '' : ' lang="' + escape(options.lang) + '"') + '>');
  if (options.caption !== undefined) append('<caption>' + escape(options.caption) + '</caption>');
  append('<thead><tr>');
  for (const { column } of columns) append('<th scope="col">' + escape(column.title) + '</th>');
  append('</tr></thead><tbody>');
  for (const row of rows) {
    append('<tr>');
    for (const { column, index } of columns) {
      const merge = source.getMerge?.(row, index);
      const covered = merge && (merge.startRow !== row || merge.startColumn !== index);
      const value = covered ? null : source.getValue(row, column.key);
      const text = covered
        ? ''
        : options.getCellLabel
          ? options.getCellLabel(row, column, value)
          : value === null || value === undefined
            ? ''
            : ['string', 'boolean'].includes(typeof value) || (typeof value === 'number' && Number.isFinite(value))
              ? String(value)
              : '';
      append('<td>' + escape(text) + '</td>');
    }
    append('</tr>');
  }
  append('</tbody></table>');
  return chunks.join('');
}
