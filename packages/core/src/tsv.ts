// cap clipboard work at 100,000 cells / 10M UTF-16 code units; streaming for larger transfers.
export const clipboardCellLimit = 100_000;
export const clipboardTextLimit = 10_000_000;

export function encodeTsv(rows: readonly (readonly string[])[]): string {
  return rows
    .map((row) => row.map((value) => (/[\t\r\n"]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value)).join('\t'))
    .join('\r\n');
}

export function decodeTsv(text: string): string[][] {
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
