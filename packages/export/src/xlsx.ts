import { zipSync, strToU8 } from 'fflate';
import { decodeBlocks } from '@acheron-grid/core';
import type { GridEngine } from '@acheron-grid/core';
export interface XlsxExportOptions {
  readonly includeHeaders?: boolean;
  readonly sheetName?: string;
}
const xml = (value: string, excelEscapes = false) => {
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\uFFFE\uFFFF\uD800-\uDFFF]/u.test(value))
    throw new TypeError('Text contains invalid XML characters.');
  return (excelEscapes ? value.replace(/_x[0-9a-fA-F]{4}_/g, (match) => '_x005F_' + match.slice(1)) : value)
    .replace(
      /[&<>"']/g,
      (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[character]!,
    )
    .replace(/\r/g, '&#13;');
};
function columnName(index: number): string {
  let name = '';
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  return name;
}
/** Single-sheet values export; strings never become formulas. Host owns saving the bytes. */
export function exportSelectionXlsx(
  engine: Pick<GridEngine, 'columns' | 'getSelectionRanges' | 'copySelectionBlocks' | 'getValue'>,
  options: XlsxExportOptions = {},
): Uint8Array {
  const sheetName = options.sheetName ?? 'Selection';
  if (
    (options.includeHeaders !== undefined && typeof options.includeHeaders !== 'boolean') ||
    typeof sheetName !== 'string' ||
    !sheetName ||
    sheetName.length > 31 ||
    /[\[\]:*?/\\]/.test(sheetName) ||
    sheetName.startsWith("'") ||
    sheetName.endsWith("'")
  )
    throw new TypeError('Invalid XLSX options.');
  const safeSheetName = xml(sheetName),
    ranges = engine.getSelectionRanges();
  if (ranges.length !== 1) throw new Error('XLSX export requires one rectangular selection.');
  const range = ranges[0]!,
    blocks = decodeBlocks(engine.copySelectionBlocks());
  if (blocks.length !== 1) throw new Error('XLSX export requires one rectangular selection.');
  const values = blocks[0]!.values;
  if (
    values.length + (options.includeHeaders ? 1 : 0) > 1_048_576 ||
    engine.columns.slice(range.startColumn, range.endColumn + 1).length > 16_384
  )
    throw new RangeError('Excel sheet dimensions exceeded.');
  let characters = 0;
  function rowXml(texts: readonly string[], index: number, header: boolean): string {
    const cells = texts
      .map((text, col) => {
        const address = columnName(col) + (index + 1);
        const raw =
          header || text === ''
            ? text
            : engine.getValue(
                range.startRow + index - (options.includeHeaders ? 1 : 0),
                engine.columns[range.startColumn + col]!.key,
              );
        let cell: string;
        if (typeof raw === 'number' && Number.isFinite(raw) && String(raw) === text)
          cell = `<c r="${address}"><v>${raw}</v></c>`;
        else if (typeof raw === 'boolean' && String(raw) === text)
          cell = `<c r="${address}" t="b"><v>${raw ? 1 : 0}</v></c>`;
        else {
          if (text.length > 32_767) throw new RangeError('Excel text cell is too long.');
          cell = `<c r="${address}" t="inlineStr"><is><t xml:space="preserve">${xml(text, true)}</t></is></c>`;
        }
        characters += cell.length;
        if (characters > 20_000_000) throw new RangeError('XLSX XML budget exceeded.');
        return cell;
      })
      .join('');
    return `<row r="${index + 1}">${cells}</row>`;
  }
  const rows = values.map((row, index) => rowXml(row, index + (options.includeHeaders ? 1 : 0), false));
  if (options.includeHeaders)
    rows.unshift(
      rowXml(
        engine.columns.slice(range.startColumn, range.endColumn + 1).map((column) => column.title),
        0,
        true,
      ),
    );
  const ns = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main',
    relations = 'http://schemas.openxmlformats.org/package/2006/relationships';
  const files = {
    '[Content_Types].xml':
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
    '_rels/.rels': `<Relationships xmlns="${relations}"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
    'xl/workbook.xml': `<workbook xmlns="${ns}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${safeSheetName}" sheetId="1" r:id="rId1"/></sheets></workbook>`,
    'xl/_rels/workbook.xml.rels': `<Relationships xmlns="${relations}"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
    'xl/worksheets/sheet1.xml': `<worksheet xmlns="${ns}"><sheetData>${rows.join('')}</sheetData></worksheet>`,
  };
  let bytes = 0,
    xmlCharacters = 0;
  const archive = Object.fromEntries(
    Object.entries(files).map(([name, text]) => {
      xmlCharacters += text.length;
      if (xmlCharacters > 20_000_000) throw new RangeError('XLSX XML budget exceeded.');
      const data = strToU8(text);
      bytes += data.length;
      if (bytes > 40_000_000) throw new RangeError('XLSX byte budget exceeded.');
      return [name, data];
    }),
  );
  return zipSync(archive, { level: 6 });
}
