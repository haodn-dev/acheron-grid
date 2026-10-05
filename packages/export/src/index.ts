import { decodeBlocks } from '@acheron-grid/core';
import type { GridEngine } from '@acheron-grid/core';

export interface CsvExportOptions {
  readonly includeHeaders?: boolean;
  readonly bom?: boolean;
  readonly formulaProtection?: 'escape' | 'preserve';
}

/** Text export through core's copy permissions, visible selection and clipboard budgets. */
export function exportSelectionCsv(engine: Pick<GridEngine, 'getSelectionRanges' | 'copySelectionBlocks' | 'columns'>, options: CsvExportOptions = {}): string {
  if (options.includeHeaders !== undefined && typeof options.includeHeaders !== 'boolean' || options.bom !== undefined && typeof options.bom !== 'boolean' || options.formulaProtection !== undefined && !['escape', 'preserve'].includes(options.formulaProtection)) throw new TypeError('Invalid CSV options.');
  const ranges = engine.getSelectionRanges();
  if (ranges.length !== 1) throw new Error('CSV export requires one rectangular selection.');
  const range = ranges[0]!;
  const blocks = decodeBlocks(engine.copySelectionBlocks());
  if (blocks.length !== 1) throw new Error('CSV export requires one rectangular selection.');
  const rows: readonly (readonly string[])[] = options.includeHeaders
    ? [engine.columns.slice(range.startColumn, range.endColumn + 1).map(column => column.title), ...blocks[0]!.values]
    : blocks[0]!.values;
  let length = options.bom ? 1 : 0;
  const lines = rows.map((row, rowIndex) => {
    const fields = row.map((text, columnIndex) => {
      if (options.formulaProtection !== 'preserve' && /^\s*[=+\-@]/.test(text)) text = "'" + text;
      const field = /[,"\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
      length += field.length + (columnIndex ? 1 : 0);
      if (length > 10_000_000) throw new RangeError('CSV output is too large.');
      return field;
    });
    if (rowIndex) length += 2;
    if (length > 10_000_000) throw new RangeError('CSV output is too large.');
    return fields.join(',');
  });
  return (options.bom ? '\uFEFF' : '') + lines.join('\r\n');
}
