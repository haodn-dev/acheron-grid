import type { CellFormat, ClipboardBlock, Column, GridEngine, PasteOptions, SelectionRange } from '@acheron-grid/core';
import { blocksToTsv, decodeBlocks, encodeBlocks, gridClipboardType } from '@acheron-grid/core';
import type { CellEditor, ColumnEditor } from '../grid.js';
import type { CanvasTranslator } from '../locale.js';
import { validateMediaValue } from '../media.js';
import type { RichText } from '../rich-text.js';
import { readHtml, richTextHtml } from '../rich-text.js';

interface ClipboardContext {
  readonly columnAxis: GridEngine['columnsLayout'];
  readonly columnEditors: Map<string, ColumnEditor>;
  columns: readonly Column[];
  readonly copyFeedback: HTMLDivElement;
  destroyed: boolean;
  readonly doc: Document;
  editor: CellEditor | null;
  readonly engine: GridEngine;
  readonly getSelectionRanges: () => SelectionRange[];
  headerHeight: number;
  indexWidth: number;
  readonly mediaColumn: (key: string) => boolean;
  readonly motionDuration: number;
  readonly motionEnabled: () => boolean;
  readonly pasteImages: (files: readonly File[]) => Promise<void>;
  readonly richText: (value: unknown, key: string, contentFormat?: CellFormat['contentFormat']) => RichText | undefined;
  readonly rowAxis: GridEngine['rows'];
  rowCount: number;
  readonly t: CanvasTranslator;
  readonly viewport: () => Readonly<{
    hitTest(x: number, y: number): { row: number; col: number } | null;
    cellRect(
      row: number,
      col: number,
    ): Readonly<{
      x: number;
      y: number;
      width: number;
      height: number;
      clip: Readonly<{ x: number; y: number; width: number; height: number }>;
    }>;
    width: number;
    height: number;
    scrollLeft: number;
    scrollTop: number;
    frozenWidth: number;
    frozenHeight: number;
    regions: readonly import('@acheron-grid/core').ViewportRegion[];
  }>;
  readonly win: Window & typeof globalThis;
}

export function createClipboard(context: ClipboardContext) {
  let copiedRanges: readonly SelectionRange[] = [];
  let copyFeedbackRevision = 0;
  let pendingCutText: string | undefined;
  let cutRevision = 0;
  function clearCopyFeedback(): void {
    copyFeedbackRevision++;
    copiedRanges = [];
    if (!context.copyFeedback.hasChildNodes()) return;
    context.copyFeedback.getAnimations({ subtree: true }).forEach((animation) => animation.cancel());
    context.copyFeedback.replaceChildren();
  }

  function showCopyFeedback(ranges: readonly SelectionRange[], cut = false): void {
    clearCopyFeedback();
    if (context.destroyed || !ranges.length) return;
    context.copyFeedback.dataset.operation = cut ? 'cut' : 'copy';
    copiedRanges = ranges.slice(0, 64).map((range) => ({ ...range }));
    renderCopyFeedback();
    if (context.motionEnabled())
      context.copyFeedback.animate([{ opacity: 0.35 }, { opacity: 1 }], {
        duration: Math.min(120, context.motionDuration),
        easing: 'cubic-bezier(.22,1,.36,1)',
      });
  }

  function renderCopyFeedback(): void {
    if (context.destroyed || !copiedRanges.length) return;
    context.copyFeedback.getAnimations({ subtree: true }).forEach((animation) => animation.cancel());
    context.copyFeedback.replaceChildren();
    const view = context.viewport();
    // Bound visual feedback independently of clipboard data size.
    for (const region of view.regions)
      for (const range of copiedRanges) {
        if (
          range.endRow < region.rows.start ||
          range.startRow >= region.rows.end ||
          range.endColumn < region.columns.start ||
          range.startColumn >= region.columns.end
        )
          continue;
        const clip = region.clip;
        const pane = context.doc.createElement('div');
        pane.style.cssText = `position:absolute;overflow:hidden;left:${context.indexWidth + clip.x}px;top:${context.headerHeight + clip.y}px;width:${clip.width}px;height:${clip.height}px`;
        const border = context.doc.createElement('div');
        border.style.cssText = `position:absolute;box-sizing:border-box;left:${context.columnAxis.position(range.startColumn) + region.offsetX - clip.x}px;top:${context.rowAxis.position(range.startRow) + region.offsetY - clip.y}px;width:${context.columnAxis.position(range.endColumn + 1) - context.columnAxis.position(range.startColumn)}px;height:${context.rowAxis.position(range.endRow + 1) - context.rowAxis.position(range.startRow)}px;border:1px solid var(--acheron-background)`;
        const dashes = context.doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
        dashes.style.cssText =
          'position:absolute;left:-1px;top:-1px;width:calc(100% + 2px);height:calc(100% + 2px);overflow:visible';
        const outline = context.doc.createElementNS('http://www.w3.org/2000/svg', 'rect');
        outline.setAttribute('x', '.5');
        outline.setAttribute('y', '.5');
        const cutting = context.copyFeedback.dataset.operation === 'cut';
        outline.style.cssText = `width:calc(100% - 1px);height:calc(100% - 1px);fill:${cutting ? 'var(--acheron-selection-color)' : 'none'};fill-opacity:.08;stroke:var(--acheron-selection-color);stroke-width:1;stroke-dasharray:${cutting ? '8 6' : '4 3'}`;
        dashes.append(outline);
        border.append(dashes);
        pane.append(border);
        context.copyFeedback.append(pane);
        if (context.motionEnabled())
          outline.animate([{ strokeDashoffset: '0' }, { strokeDashoffset: '-14' }], {
            duration: 1200,
            iterations: Infinity,
            easing: 'linear',
          });
      }
  }

  function clipboardBlocks(): ClipboardBlock[] {
    const ranges = context.getSelectionRanges();
    if (!ranges.length) return [];
    const blocks = decodeBlocks(context.engine.copySelectionBlocks());
    const firstRow = Math.min(...ranges.map((range) => range.startRow)),
      firstColumn = Math.min(...ranges.map((range) => range.startColumn));
    return blocks.map((block) => {
      const formats: CellFormat[][] = [];
      const values = block.values.map((line, row) =>
        line.map((text, col) => {
          const rowIndex = firstRow + block.row + row,
            columnIndex = firstColumn + block.column + col;
          const format = block.formats?.[row]?.[col] ?? context.engine.getFormat(rowIndex, columnIndex),
            rich = context.richText(text, context.columns[columnIndex]!.key, format.contentFormat);
          if (rich?.unavailable) throw new Error('Rich text cannot be copied until it can be displayed.');
          (formats[row] ??= []).push({ ...format, ...(rich ? { contentFormat: 'html' as const } : {}) });
          if (context.mediaColumn(context.columns[columnIndex]!.key)) {
            const value = context.engine.getValue(rowIndex, context.columns[columnIndex]!.key);
            return Array.isArray(value) ? JSON.stringify(validateMediaValue(value)) : text;
          }
          return rich ? richTextHtml(rich, context.doc) : text;
        }),
      );
      return { ...block, values, formats };
    });
  }

  function cancelCut(): void {
    cutRevision++;
    pendingCutText = undefined;
    context.engine.cancelCut();
    clearCopyFeedback();
  }

  function cutSelectionBlocks(): string {
    cancelCut();
    const blocks = clipboardBlocks();
    context.engine.cutSelectionBlocks();
    pendingCutText = encodeBlocks(blocks);
    showCopyFeedback(context.getSelectionRanges(), true);
    return pendingCutText;
  }

  function copySelectionBlocks(): string {
    cancelCut();
    const text = encodeBlocks(clipboardBlocks());
    showCopyFeedback(context.getSelectionRanges());
    return text;
  }

  function pasteSelectionBlocks(text: string, pasteOptions?: PasteOptions): void {
    if (pasteOptions?.transpose || pasteOptions?.mode === 'formats') {
      if (context.destroyed || context.editor) throw new Error('Finish editing before pasting cells.');
      context.engine.pasteSelectionBlocks(text, pasteOptions);
      cancelCut();
      return;
    }
    if (context.destroyed || context.editor) throw new Error('Finish editing before pasting cells.');
    const ranges = context
      .getSelectionRanges()
      .sort((a, b) => a.startRow - b.startRow || a.startColumn - b.startColumn);
    const moving = !pasteOptions && pendingCutText !== undefined && text === pendingCutText;
    const original = decodeBlocks(text);
    const scalar =
      !moving && original.length === 1 && original[0]!.values.length === 1 && original[0]!.values[0]!.length === 1;
    if (
      scalar &&
      ranges.reduce(
        (total, range) => total + (range.endRow - range.startRow + 1) * (range.endColumn - range.startColumn + 1),
        0,
      ) > 100_000
    )
      throw new RangeError('Paste has too many cells.');
    const expanded =
      scalar && ranges.length
        ? ranges.map((range) => {
            const first = original[0]!,
              height = range.endRow - range.startRow + 1,
              width = range.endColumn - range.startColumn + 1;
            return {
              ...first,
              row: 0,
              column: 0,
              values: Array.from({ length: height }, () => Array<string>(width).fill(first.values[0]![0]!)),
              ...(first.formats
                ? {
                    formats: Array.from({ length: height }, () =>
                      Array.from({ length: width }, () => ({ ...first.formats![0]![0]! })),
                    ),
                  }
                : {}),
            };
          })
        : original;
    const blocks = expanded.map((block, index) => {
      const range = ranges.length > 1 ? ranges[index] : ranges[0];
      if (!range) return block;
      const formats = block.formats?.map((line) => line.map((format) => ({ ...format })));
      const values = block.values.map((line, row) =>
        line.map((value, col) => {
          const rowIndex = range.startRow + row + (ranges.length === 1 ? block.row : 0),
            columnIndex = range.startColumn + col + (ranges.length === 1 ? block.column : 0);
          if (
            formats?.[row]?.[col]?.contentFormat === 'html' &&
            rowIndex < context.rowCount &&
            columnIndex < context.columns.length
          ) {
            const current = context.engine.getValue(rowIndex, context.columns[columnIndex]!.key);
            if (
              typeof current === 'number' ||
              typeof current === 'boolean' ||
              context.columnEditors.has(context.columns[columnIndex]!.key)
            ) {
              delete formats[row]![col]!.contentFormat;
              return readHtml(value, context.doc).text;
            }
          }
          return value;
        }),
      );
      return { ...block, values, ...(formats ? { formats } : {}) };
    });
    if (moving) {
      context.engine.pasteCutSelectionBlocks(encodeBlocks(blocks));
      pendingCutText = undefined;
    } else {
      context.engine.pasteSelectionBlocks(encodeBlocks(blocks), pasteOptions);
      if (pendingCutText) cancelCut();
    }
  }

  function clipboardPlain(blocks: readonly ClipboardBlock[]): string {
    return blocksToTsv(
      blocks.map((block) => ({
        ...block,
        values: block.values.map((line, row) =>
          line.map((value, col) =>
            block.formats?.[row]?.[col]?.contentFormat === 'html' ? readHtml(value, context.doc).text : value,
          ),
        ),
      })),
    );
  }

  function clipboardHtml(blocks: readonly ClipboardBlock[]): string {
    const table = context.doc.createElement('table');
    table.setAttribute('data-acheron-blocks', encodeBlocks(blocks));
    for (const block of blocks)
      for (const [row, line] of block.values.entries()) {
        const tr = context.doc.createElement('tr');
        table.append(tr);
        for (const [col, value] of line.entries()) {
          const td = context.doc.createElement('td'),
            format = block.formats?.[row]?.[col];
          if (format?.contentFormat === 'html') td.innerHTML = richTextHtml(readHtml(value, context.doc), context.doc);
          else td.textContent = value;
          if (format?.background) td.style.backgroundColor = format.background;
          if (format?.textColor) td.style.color = format.textColor;
          tr.append(td);
        }
      }
    return table.outerHTML;
  }

  function htmlClipboardBlocks(html: string): ClipboardBlock[] {
    if (html.length > 10_000_000) throw new RangeError('Clipboard text is too large.');
    const template = context.doc.createElement('template');
    template.innerHTML = html;
    const encoded = template.content.querySelector('table')?.getAttribute('data-acheron-blocks');
    if (encoded) return decodeBlocks(encoded);
    const rows = Array.from(template.content.querySelectorAll('table tr'));
    const cells = rows.length
      ? rows.map((row) => Array.from(row.children).filter((cell) => ['TD', 'TH'].includes(cell.tagName)))
      : [];
    const values = cells.length
      ? cells.map((line) => line.map((cell) => richTextHtml(readHtml(cell.innerHTML, context.doc), context.doc)))
      : [[richTextHtml(readHtml(html, context.doc), context.doc)]];
    const formats = values.map((line) => line.map(() => ({ contentFormat: 'html' as const })));
    return decodeBlocks(encodeBlocks([{ row: 0, column: 0, values, formats }]));
  }

  async function writeClipboard(cut = false): Promise<void> {
    cancelCut();
    const cutRequest = cutRevision;
    const blocks = clipboardBlocks();
    const text = clipboardPlain(blocks);
    const copiedRanges = context.getSelectionRanges().map((range) => ({ ...range }));
    const revision = copyFeedbackRevision;
    if (cut) context.engine.cutSelectionBlocks();
    if (context.win.navigator.clipboard.write && context.win.ClipboardItem)
      await context.win.navigator.clipboard.write([
        new context.win.ClipboardItem({
          'text/plain': new context.win.Blob([text], { type: 'text/plain' }),
          'text/html': new context.win.Blob([clipboardHtml(blocks)], { type: 'text/html' }),
        }),
      ]);
    else await context.win.navigator.clipboard.writeText(text);
    if (cut && cutRequest !== cutRevision) return;
    if (cut && !context.destroyed && revision === copyFeedbackRevision) pendingCutText = encodeBlocks(blocks);
    else if (cut) context.engine.cancelCut();
    if (!context.destroyed && revision === copyFeedbackRevision) showCopyFeedback(copiedRanges, cut);
  }

  function copySelection(): string {
    if (context.destroyed) throw new Error('Grid is destroyed.');
    if (context.editor) throw new Error('Finish editing before copying cells.');
    cancelCut();
    const text = clipboardPlain(clipboardBlocks());
    showCopyFeedback(context.getSelectionRanges());
    return text;
  }

  function paste(text: string, pasteOptions?: PasteOptions): void {
    if (context.destroyed) throw new Error('Grid is destroyed.');
    if (context.editor) throw new Error('Finish editing before pasting cells.');
    context.engine.paste(text, pasteOptions);
  }

  function onCut(event: ClipboardEvent): void {
    if (event.target === context.editor || !context.engine.getSelection() || !event.clipboardData) return;
    event.preventDefault();
    cancelCut();
    try {
      const blocks = clipboardBlocks();
      context.engine.cutSelectionBlocks();
      event.clipboardData.setData('text/plain', clipboardPlain(blocks));
      event.clipboardData.setData('text/html', clipboardHtml(blocks));
      pendingCutText = encodeBlocks(blocks);
      event.clipboardData.setData(gridClipboardType, pendingCutText);
      showCopyFeedback(context.getSelectionRanges(), true);
    } catch (error) {
      pendingCutText = undefined;
      context.engine.cancelCut();
      context.win.alert(error instanceof Error ? context.t(error.message) : context.t('Unable to cut cells.'));
    }
  }

  function onCopy(event: ClipboardEvent): void {
    const selection = context.engine.getSelection();
    if (event.target === context.editor || !selection || !event.clipboardData) return;
    event.preventDefault();
    cancelCut();
    try {
      const blocks = clipboardBlocks();
      event.clipboardData.setData('text/plain', clipboardPlain(blocks));
      event.clipboardData.setData('text/html', clipboardHtml(blocks));
      event.clipboardData.setData(gridClipboardType, encodeBlocks(blocks));
      showCopyFeedback(context.getSelectionRanges());
    } catch (error) {
      context.win.alert(error instanceof Error ? context.t(error.message) : context.t('Unable to copy cells.'));
    }
  }

  function onPaste(event: ClipboardEvent): void {
    const selection = context.engine.getSelection();
    const files = Array.from(event.clipboardData?.files ?? []).filter((file) => file.type.startsWith('image/'));
    if (event.target !== context.editor && selection && files.length) {
      event.preventDefault();
      void context.pasteImages(files);
      return;
    }
    if (
      event.target === context.editor ||
      !selection ||
      !event.clipboardData ||
      !event.clipboardData.types.some((type) => ['text/plain', 'text/html', gridClipboardType].includes(type))
    )
      return;
    event.preventDefault();
    try {
      if (event.clipboardData.types.includes(gridClipboardType))
        pasteSelectionBlocks(event.clipboardData.getData(gridClipboardType));
      else if (event.clipboardData.types.includes('text/html'))
        pasteSelectionBlocks(encodeBlocks(htmlClipboardBlocks(event.clipboardData.getData('text/html'))));
      else paste(event.clipboardData.getData('text/plain'));
    } catch (error) {
      context.win.alert(error instanceof Error ? context.t(error.message) : context.t('Unable to paste cells.'));
    }
  }
  return {
    clearCopyFeedback,
    showCopyFeedback,
    renderCopyFeedback,
    clipboardBlocks,
    cancelCut,
    cutSelectionBlocks,
    copySelectionBlocks,
    pasteSelectionBlocks,
    clipboardPlain,
    clipboardHtml,
    htmlClipboardBlocks,
    writeClipboard,
    copySelection,
    paste,
    onCut,
    onCopy,
    onPaste,
    get copiedRanges() {
      return copiedRanges;
    },
    set copiedRanges(value: readonly SelectionRange[]) {
      copiedRanges = value;
    },
    get copyFeedbackRevision() {
      return copyFeedbackRevision;
    },
    set copyFeedbackRevision(value: number) {
      copyFeedbackRevision = value;
    },
    get pendingCutText() {
      return pendingCutText;
    },
    set pendingCutText(value: string | undefined) {
      pendingCutText = value;
    },
    get cutRevision() {
      return cutRevision;
    },
    set cutRevision(value: number) {
      cutRevision = value;
    },
  };
}
