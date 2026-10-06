import type { CellFormat, NumberFormat } from '@acheron-grid/core';
import type { GridOptions } from '../grid.js';
import type { CanvasTranslator } from '../locale.js';
import type { RichText } from '../rich-text.js';
import { readHtml } from '../rich-text.js';

export function createNumberDisplay(options: Pick<GridOptions, 'locale' | 'currency'>) {
  const numberFormats = new Map<NumberFormat, Intl.NumberFormat>(
    ['decimal', 'integer', 'percent', 'currency'].map((kind) => [
      kind as NumberFormat,
      new Intl.NumberFormat(
        options.locale ?? 'en',
        kind === 'currency'
          ? { style: 'currency', currency: options.currency ?? 'USD' }
          : kind === 'percent'
            ? { style: 'percent', maximumFractionDigits: 2 }
            : { maximumFractionDigits: kind === 'integer' ? 0 : 2 },
      ),
    ]),
  );
  function numberText(value: unknown, format?: NumberFormat): string {
    return typeof value === 'number' && Number.isFinite(value) && format
      ? numberFormats.get(format)!.format(value)
      : String(value ?? '');
  }
  return numberText;
}

export function createRichDisplay({
  options,
  doc,
  t,
  numberText,
}: {
  options: Pick<GridOptions, 'richTextColumns' | 'markdownToHtml'>;
  doc: Document;
  t: CanvasTranslator;
  numberText: ReturnType<typeof createNumberDisplay>;
}) {
  const richTextColumns = new Map(Object.entries(options.richTextColumns ?? {}));
  for (const format of richTextColumns.values()) {
    if (format !== 'html' && format !== 'markdown') throw new TypeError('Unsupported rich text format.');
    if (format === 'markdown' && !options.markdownToHtml)
      throw new TypeError('Markdown columns require a markdownToHtml adapter.');
  }
  const richCache = new Map<string, RichText>();
  function richText(value: unknown, key: string, contentFormat?: CellFormat['contentFormat']): RichText | undefined {
    const format = contentFormat ?? richTextColumns.get(key);
    if (!format || format === 'plain' || typeof value !== 'string') return undefined;
    if (value.length > 100_000)
      return {
        text: t('Rich text is too large to display'),
        runs: [{ text: t('Rich text is too large to display') }],
        unavailable: true,
      };
    const cacheKey = format + ':' + value;
    let rich = richCache.get(cacheKey);
    if (!rich) {
      try {
        rich = readHtml(format === 'markdown' ? options.markdownToHtml!(value) : value, doc);
      } catch {
        rich = { text: t('Rich text unavailable'), runs: [{ text: t('Rich text unavailable') }], unavailable: true };
      }
      if (value.length <= 4096) {
        if (richCache.size >= 256) richCache.delete(richCache.keys().next().value!);
        richCache.set(cacheKey, rich);
      }
    }
    return rich;
  }
  function displayedText(
    value: unknown,
    key: string,
    contentFormat?: CellFormat['contentFormat'],
    numberFormat?: NumberFormat,
  ): string {
    return richText(value, key, contentFormat)?.text ?? numberText(value, numberFormat);
  }
  return { richTextColumns, richText, displayedText, clearDisplayCache: () => richCache.clear() };
}
