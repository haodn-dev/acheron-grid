// cap clipboard work at 100,000 cells / 10M UTF-16 code units; streaming for larger transfers.
export const clipboardCellLimit = 100_000;
export const clipboardTextLimit = 10_000_000;

export function encodeTsv(rows: readonly (readonly string[])[]): string {
  return rows
    .map((row) => row.map((value) => (/[\t\r\n"]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value)).join('\t'))
    .join('\r\n');
}

import { drain } from './internal/bulk.js';
import type { BulkSteps } from './internal/bulk.js';

export function* decodeTsvSteps(text: string, cooperative = false): BulkSteps<string[][]> {
  if (text.length > clipboardTextLimit) throw new RangeError('Clipboard text is too large.');
  const rows: string[][] = [];
  let row: string[] = [];
  let value = '';
  let quoted = false;
  let closed = false;
  let cells = 0;
  function field(): void {
    if (++cells > clipboardCellLimit) throw new RangeError('Clipboard has too many cells.');
    row.push(value);
    value = '';
    closed = false;
  }
  for (let i = 0; i < text.length; i++) {
    if (cooperative && i > 0 && i % 8192 === 0) yield { phase: 'parse', completed: i, total: text.length };
    const char = text[i]!;
    if (quoted) {
      if (char !== '"') value += char;
      else if (text[i + 1] === '"') {
        value += '"';
        i++;
      } else {
        quoted = false;
        closed = true;
      }
    } else if (char === '\t') field();
    else if (char === '\n' || char === '\r') {
      field();
      rows.push(row);
      row = [];
      if (char === '\r' && text[i + 1] === '\n') i++;
    } else if (closed) throw new Error('Unexpected text after quoted clipboard field.');
    else if (char === '"' && value === '') quoted = true;
    else value += char;
  }
  if (quoted) throw new Error('Unterminated quoted clipboard field.');
  // A final row separator is a terminator, not an additional empty row.
  if (row.length || value || closed || !rows.length || !/[\r\n]$/.test(text)) {
    field();
    rows.push(row);
  }
  const width = rows[0]!.length;
  if (rows.some((row) => row.length !== width)) throw new Error('Clipboard rows must have equal widths.');
  return rows;
}
export function decodeTsv(text: string): string[][] {
  return drain(decodeTsvSteps(text));
}

/** Validate and copy external decoder output without trusting its worker boundary. */
export function* validateTsvSteps(input: unknown): BulkSteps<string[][]> {
  if (!Array.isArray(input) || !input.length || input.length > clipboardCellLimit)
    throw new TypeError('Invalid decoded TSV.');
  const width = Array.isArray(input[0]) ? input[0].length : 0;
  if (!width || width * input.length > clipboardCellLimit) throw new RangeError('Clipboard has too many cells.');
  const rows: string[][] = [];
  let length = 0,
    cells = 0;
  for (const row of input) {
    if (!Array.isArray(row) || row.length !== width) throw new TypeError('Invalid decoded TSV.');
    const copy: string[] = [];
    for (const value of row) {
      if (typeof value !== 'string') throw new TypeError('Invalid decoded TSV.');
      length += value.length;
      if (length > clipboardTextLimit) throw new RangeError('Clipboard text is too large.');
      copy.push(value);
      if (++cells % 256 === 0) yield { phase: 'parse', completed: cells, total: width * input.length };
    }
    rows.push(copy);
  }
  return rows;
}
