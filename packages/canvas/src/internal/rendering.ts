import type {
  CellFormat,
  CellUpdate,
  Column,
  GridEngine,
  LocalViewOptions,
  NumberFormat,
  SelectionRange,
  ViewportRegion,
} from '@acheron-grid/core';
import type { ColumnEditor, GridOptions, GridTheme } from '../grid.js';
import type { HeaderCell } from '../headers.js';
import { headerLayout } from '../headers.js';
import { icons } from '../icons.js';
import { detectLinks } from '../links.js';
import type { CanvasTranslator } from '../locale.js';
import { mediaItems } from '../media.js';
import type { RichText } from '../rich-text.js';
import { layoutRichText } from '../rich-text.js';
import { createAccessibility } from './accessibility.js';
import { createEditors } from './editors.js';
import { createInteraction } from './interaction.js';
import { createMediaController } from './media-controller.js';

interface RenderingContext {
  readonly accessibility: ReturnType<typeof createAccessibility>;
  readonly accessibleBody: HTMLDivElement;
  readonly accessibleCell: (row: number, col: number, value: unknown) => HTMLElement;
  readonly actionError: HTMLDivElement;
  readonly activeBorderWidth: number;
  readonly activeCell: HTMLDivElement;
  readonly activeRow: HTMLDivElement;
  readonly avatarColumns: ReadonlySet<string>;
  readonly canvas: HTMLCanvasElement;
  readonly closeMenu: (focus?: boolean) => void;
  readonly columnAxis: GridEngine['columnsLayout'];
  readonly columnEditors: Map<string, ColumnEditor>;
  readonly columns: readonly Column[];
  readonly context: CanvasRenderingContext2D | null;
  readonly currentView: LocalViewOptions | undefined;
  readonly destroyed: boolean;
  readonly doc: Document;
  readonly editors: ReturnType<typeof createEditors>;
  readonly endResize: () => void;
  readonly engine: GridEngine;
  readonly enteringGroups: Set<string>;
  readonly finishEdit: (commit: boolean) => boolean;
  readonly freezeHorizontal: HTMLDivElement;
  readonly freezeVertical: HTMLDivElement;
  readonly getSelectionRange: () => SelectionRange | null;
  readonly getSelectionRanges: () => SelectionRange[];
  readonly headerHeight: number;
  readonly headerRowHeight: number;
  readonly headerSurface: HTMLDivElement;
  readonly headerTintOpacity: number;
  readonly headers: ReturnType<typeof headerLayout>;
  readonly highlightSearch: (x: number, y: number, width: number, height: number, row: number, col: number) => void;
  readonly indexGutter: HTMLDivElement;
  readonly indexWidth: number;
  readonly interaction: ReturnType<typeof createInteraction>;
  readonly leafHeaders: HeaderCell[];
  readonly measureRowHeight: (index: number, allColumns?: boolean) => number;
  readonly mediaColumn: (key: string) => boolean;
  readonly mediaController: ReturnType<typeof createMediaController>;
  readonly mediaLimit: number;
  readonly mediaSize: number;
  readonly motionEnabled: () => boolean;
  readonly numberText: (value: unknown, format?: NumberFormat) => string;
  readonly openMenu: (row: number, col: number, x: number, y: number, header?: boolean) => void;
  readonly options: GridOptions;
  readonly positionEditor: () => void;
  readonly rangeBorderWidth: number;
  readonly rangeTintOpacity: number;
  readonly releaseUnusedImages: () => void;
  readonly reorderHandle: (node: HTMLElement, axis: 'row' | 'column', first: number, last?: number) => void;
  readonly richText: (value: unknown, key: string, contentFormat?: CellFormat['contentFormat']) => RichText | undefined;
  readonly root: HTMLDivElement;
  readonly rowAxis: GridEngine['rows'];
  readonly rowCount: number;
  readonly rowLabels: (row: number) => string[];
  readonly rowLockSvg: HTMLElement;
  readonly scroller: HTMLDivElement;
  readonly selectAll: () => void;
  readonly selectHeaderGroup: (first: number, last: number, event: PointerEvent | KeyboardEvent) => void;
  readonly selectRow: (index: number) => void;
  readonly selectionHandles: HTMLButtonElement[];
  readonly startAxisSelection: (axis: 'row' | 'column', index: number, event: PointerEvent | KeyboardEvent) => void;
  readonly stateIconSvg: Readonly<Record<'lock' | 'arrow-up' | 'arrow-down' | 'funnel' | 'chevron-down', string>>;
  readonly stateIcons: { [k: string]: HTMLImageElement };
  readonly stateLabels: (row: number | null, col: number) => string[];
  readonly structureAction: <T>(run: () => T, axis?: 'row' | 'column') => T;
  readonly syncAccessibleCell: () => void;
  readonly t: CanvasTranslator;
  readonly theme: GridTheme;
  readonly viewportAccessibility: boolean;
  readonly visibleIndices: (axis: 'row' | 'column') => Set<number>;
  readonly win: Window & typeof globalThis;
}

export function createRendering(context: RenderingContext) {
  const measuredRows = new Set<number>();
  let frame: number | undefined;
  let fullDraw = true;
  const dirty = new Map<string, { rowIndex: number; columnKey: string }>();
  const rowLockCache = new Map<number, boolean>();
  function svgIcon(name: keyof typeof icons, size = 16): Element {
    const svg = new context.win.DOMParser().parseFromString(icons[name], 'image/svg+xml').documentElement;
    svg.setAttribute('width', String(size));
    svg.setAttribute('height', String(size));
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    return context.doc.importNode(svg, true);
  }

  function stateIcon(name: keyof typeof context.stateIconSvg, x: number, y: number): void {
    const image = context.stateIcons[name]!;
    if (image.complete && image.naturalWidth) context.context!.drawImage(image, x, y, 16, 16);
  }

  function invalidate(changes: readonly { rowIndex: number; columnKey: string }[]): void {
    const selection = context.engine.getSelection();
    for (const change of changes) {
      dirty.set(JSON.stringify([change.rowIndex, change.columnKey]), change);
      if (context.mediaColumn(change.columnKey)) fullDraw = true;
    }
    if (
      selection &&
      changes.some((change) => change.rowIndex === selection.rowIndex && change.columnKey === selection.columnKey)
    )
      context.syncAccessibleCell();
    schedule();
  }

  function updateCells(updates: readonly CellUpdate[]): void {
    if (context.destroyed) throw new Error('Grid is destroyed.');
    if (context.editors.editor) throw new Error('Finish editing before updating cells.');
    context.engine.updateCells(updates);
  }

  function replay(redo: boolean): boolean {
    if (context.destroyed || context.editors.editor) return false;
    return redo ? context.engine.redo() : context.engine.undo();
  }

  function cellLinks(row: number, col: number) {
    return linksForValue(
      context.engine.getValue(row, context.columns[col]!.key),
      context.columns[col]!.key,
      context.engine.getFormat(row, col).contentFormat,
    );
  }

  function linksForValue(value: unknown, key: string, contentFormat?: CellFormat['contentFormat']) {
    if (context.options.detectLinks === false || context.mediaColumn(key)) return [];
    const rich = context.richText(value, key, contentFormat);
    if (!rich) return detectLinks(value);
    const links = detectLinks(rich.text);
    let offset = 0;
    for (const run of rich.runs) {
      if (run.href) links.push({ text: run.text, href: run.href, start: offset, end: offset + run.text.length });
      offset += run.text.length;
    }
    return links.filter(
      (link, index) => links.findIndex((other) => other.href === link.href && other.start === link.start) === index,
    );
  }

  function validationMessage(value: unknown, columnIndex: number): string | undefined {
    return context.columns[columnIndex]?.validate?.(value);
  }

  function rowValueLocked(row: number): boolean {
    const cached = rowLockCache.get(row);
    if (cached !== undefined) return cached;
    const locked =
      context.engine.isLocked({ scope: 'row', rowIndex: row }) ||
      (context.columns.length > 0 &&
        context.columns.every(
          (_, columnIndex) =>
            context.engine.isLocked({ scope: 'cell', rowIndex: row, columnIndex }) ||
            context.engine.isLocked({ scope: 'column', columnIndex }),
        ));
    rowLockCache.set(row, locked);
    return locked;
  }

  function cell(
    value: unknown,
    x: number,
    y: number,
    width: number,
    height: number,
    header: boolean,
    rowIndex = 0,
    columnIndex = 0,
  ): void {
    paintCell(value, x, y, width, height, header, rowIndex, columnIndex);
    const labels = context.stateLabels(header ? null : rowIndex, columnIndex);
    const ctx = context.context!;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, width, height);
    ctx.clip();
    if (!header && rowValueLocked(rowIndex)) {
      ctx.globalAlpha = 0.06;
      ctx.fillStyle = context.theme.textColor;
      ctx.fillRect(x, y, width, height);
      ctx.globalAlpha = 1;
    }
    const range = context
      .getSelectionRanges()
      .find(
        (range) =>
          rowIndex >= range.startRow &&
          rowIndex <= range.endRow &&
          columnIndex >= range.startColumn &&
          columnIndex <= range.endColumn,
      );
    if (
      !header &&
      range &&
      rowIndex >= range.startRow &&
      rowIndex <= range.endRow &&
      columnIndex >= range.startColumn &&
      columnIndex <= range.endColumn
    ) {
      ctx.globalAlpha = context.rangeTintOpacity;
      ctx.fillStyle = context.theme.selectionColor;
      ctx.fillRect(x, y, width, height);
      ctx.globalAlpha = 1;
    }
    if (header) {
      const sort =
        context.currentView?.sorts?.find((item) => item.columnKey === context.columns[columnIndex]!.key) ??
        context.currentView?.sort;
      if (sort?.columnKey === context.columns[columnIndex]!.key) {
        stateIcon(sort.direction === 'asc' ? 'arrow-up' : 'arrow-down', x + width - 36, y + (height - 16) / 2);
      }
      if (context.currentView?.filters?.some((filter) => filter.columnKey === context.columns[columnIndex]!.key)) {
        stateIcon('funnel', x + width - 54, y + (height - 16) / 2);
      }
    }
    if (labels.some((label) => label.includes('disabled'))) {
      ctx.globalAlpha = 0.22;
      ctx.fillStyle = context.theme.background;
      ctx.fillRect(x, y, width, height);
      ctx.globalAlpha = 0.07;
      ctx.fillStyle = '#64748b';
      ctx.fillRect(x, y, width, height);
      ctx.globalAlpha = 1;
    }
    const leading = columnIndex === 0 || (x <= 0 && x + width > 0);
    const locked = header
      ? labels.some((label) => label.endsWith('locked'))
      : (!rowValueLocked(rowIndex) && context.engine.isLocked({ scope: 'cell', rowIndex, columnIndex })) ||
        (!context.indexWidth && rowValueLocked(rowIndex));
    if (locked && width >= 24 && height >= 20) {
      const left = x + width - 18;
      const top = y + 4;
      stateIcon('lock', left, top);
    }
    if (!header && validationMessage(value, columnIndex)) {
      ctx.fillStyle = context.columns[columnIndex]?.invalidInput === 'allow' ? '#d97706' : '#ef4444';
      ctx.beginPath();
      ctx.moveTo(x + width - 8, y + 1);
      ctx.lineTo(x + width - 1, y + 1);
      ctx.lineTo(x + width - 1, y + 8);
      ctx.closePath();
      ctx.fill();
    }
    if (
      !header &&
      context.editors.hoveredChoice?.row === rowIndex &&
      context.editors.hoveredChoice.col === columnIndex &&
      width >= 28 &&
      height >= 20 &&
      context.engine.canEdit(rowIndex, columnIndex)
    )
      stateIcon('chevron-down', x + width - 22, y + (height - 16) / 2);
    ctx.restore();
    ctx.save();
    ctx.strokeStyle = context.theme.gridLineColor;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x + width - 0.5, y);
    ctx.lineTo(x + width - 0.5, y + height - 0.5);
    ctx.lineTo(x, y + height - 0.5);
    ctx.stroke();
    ctx.restore();
  }

  function paintCell(
    value: unknown,
    x: number,
    y: number,
    width: number,
    height: number,
    header: boolean,
    rowIndex = 0,
    columnIndex = 0,
  ): void {
    const selection = context.engine.getSelection();
    const ctx = context.context!;
    ctx.clearRect(x, y, width, height);
    const format = header ? null : context.engine.getFormat(rowIndex, columnIndex);
    const cellFont =
      format?.fontStyle || format?.fontWeight
        ? `${format?.fontStyle === 'italic' ? 'italic ' : ''}${format?.fontWeight === 'bold' ? '700 ' : ''}${context.theme.font.replace(/\b(?:italic|oblique|normal|[1-9]00|bold)\s+/g, '')}`
        : context.theme.font;
    const background = format?.background ?? context.theme.background;
    const textColor = format?.textColor ?? context.theme.textColor;
    ctx.fillStyle = header ? context.theme.headerBackground : background;
    ctx.fillRect(x, y, width, height);
    const range = context.getSelectionRange();
    const wholeColumn = context
      .getSelectionRanges()
      .some(
        (range) =>
          range.startRow === 0 &&
          range.endRow === context.rowCount - 1 &&
          columnIndex >= range.startColumn &&
          columnIndex <= range.endColumn,
      );
    if (header && context.engine.isLocked({ scope: 'column', columnIndex })) {
      ctx.save();
      ctx.globalAlpha = 0.08;
      ctx.fillStyle = context.theme.headerTextColor;
      ctx.fillRect(x, y, width, height);
      ctx.restore();
    }
    if (header && (wholeColumn || context.engine.getSelection()?.columnIndex === columnIndex)) {
      ctx.save();
      ctx.globalAlpha = context.headerTintOpacity;
      ctx.fillStyle = context.theme.selectionColor;
      ctx.fillRect(x, y, width, height);
      ctx.restore();
    }
    if (!header && context.options.renderCell) {
      ctx.font = cellFont;
      let handled = false;
      ctx.save();
      try {
        ctx.beginPath();
        ctx.rect(x, y, width, height);
        ctx.clip();
        handled = context.options.renderCell(
          ctx,
          Object.freeze({
            value,
            format: format!,
            rowIndex,
            rowId: context.engine.getRowId(rowIndex),
            columnIndex,
            columnKey: context.columns[columnIndex]!.key,
            x,
            y,
            width,
            height,
          }),
        );
      } catch (error) {
        context.win.console.error(context.t('Cell renderer failed.'), error);
      } finally {
        ctx.restore();
        ctx.beginPath();
      }
      if (handled) {
        context.highlightSearch(x, y, width, height, rowIndex, columnIndex);
        return;
      }
      ctx.clearRect(x, y, width, height);
      ctx.fillStyle = background;
      ctx.fillRect(x, y, width, height);
    }
    if (!header && context.mediaColumn(context.columns[columnIndex]!.key)) {
      if (context.avatarColumns.has(context.columns[columnIndex]!.key) || Array.isArray(value))
        mediaCell(value, x, y, width, height, textColor, context.avatarColumns.has(context.columns[columnIndex]!.key));
      else imageCell(value, x, y, width, height, textColor);
      context.highlightSearch(x, y, width, height, rowIndex, columnIndex);
      return;
    }
    if (
      !header &&
      context.columnEditors.get(context.columns[columnIndex]!.key)?.type === 'checkbox' &&
      typeof value === 'boolean'
    ) {
      const size = Math.max(0, Math.min(16, width - 20, height - 8));
      const left = x + 10;
      const top = y + (height - size) / 2;
      ctx.save();
      ctx.strokeStyle = textColor;
      ctx.lineWidth = 1;
      if (size > 0) {
        ctx.strokeRect(left + 0.5, top + 0.5, size - 1, size - 1);
        if (value) {
          ctx.beginPath();
          ctx.moveTo(left + size * 0.2, top + size * 0.5);
          ctx.lineTo(left + size * 0.45, top + size * 0.75);
          ctx.lineTo(left + size * 0.8, top + size * 0.25);
          ctx.lineWidth = 2;
          ctx.stroke();
        }
      }
      ctx.restore();
      context.highlightSearch(x, y, width, height, rowIndex, columnIndex);
      return;
    }
    const rich = !header
      ? context.richText(value, context.columns[columnIndex]!.key, format?.contentFormat)
      : undefined;
    if (rich) {
      ctx.save();
      ctx.beginPath();
      ctx.rect(x + 8, y, Math.max(0, width - 16), height);
      ctx.clip();
      ctx.font = cellFont;
      const metrics = ctx.measureText('M');
      const lineHeight = Math.ceil(metrics.fontBoundingBoxAscent + metrics.fontBoundingBoxDescent) || 18;
      const layout = layoutRichText(
        ctx,
        rich,
        cellFont,
        Math.max(0, width - 20),
        !!context.options.wrapText,
        Math.max(1, Math.floor((height - 4) / lineHeight)),
      );
      ctx.textBaseline = 'top';
      for (const piece of layout.pieces) {
        const top =
          y +
          (context.options.wrapText || layout.lines > 1 ? 4 : (height - layout.lineHeight) / 2) +
          piece.line * layout.lineHeight;
        if (top + layout.lineHeight > y + height) break;
        ctx.font = piece.font;
        ctx.fillStyle =
          piece.run.href && context.options.detectLinks !== false
            ? (format?.textColor ?? context.theme.linkColor)
            : textColor;
        ctx.fillText(piece.text, x + 10 + piece.x, top);
        if (piece.run.underline || (piece.run.href && context.options.detectLinks !== false))
          ctx.fillRect(x + 10 + piece.x, top + layout.lineHeight - 1, piece.width, 1);
      }
      ctx.restore();
      context.highlightSearch(x, y, width, height, rowIndex, columnIndex);
      return;
    }
    ctx.save();
    ctx.beginPath();
    ctx.rect(x + 8, y, Math.max(0, width - 16), height);
    ctx.clip();
    ctx.fillStyle = header ? context.theme.headerTextColor : textColor;
    ctx.font = header ? context.theme.headerFont : cellFont;
    ctx.textBaseline = 'middle';
    const text = header ? String(value ?? '') : context.numberText(value, format?.numberFormat);
    const links = !header && context.options.detectLinks !== false ? detectLinks(value) : [];
    const paintText = (line: string, offset: number, top: number, lineHeight = 0) => {
      let left = x + 10;
      let position = 0;
      for (const link of links) {
        const start = Math.max(0, link.start - offset);
        const end = Math.min(line.length, link.end - offset);
        if (end <= start || start >= line.length) continue;
        const plain = line.slice(position, start);
        ctx.fillStyle = textColor;
        ctx.fillText(plain, left, top);
        left += ctx.measureText(plain).width;
        const part = line.slice(start, end);
        ctx.fillStyle = format?.textColor ?? context.theme.linkColor;
        ctx.fillText(part, left, top);
        const w = ctx.measureText(part).width;
        ctx.fillRect(left, top + (lineHeight ? lineHeight - 1 : 8), w, 1);
        left += w;
        position = end;
      }
      ctx.fillStyle = header ? context.theme.headerTextColor : textColor;
      ctx.fillText(line.slice(position), left, top);
    };
    if (!header && context.options.wrapText) {
      ctx.textBaseline = 'top';
      const metrics = ctx.measureText('M');
      const lineHeight = Math.ceil(metrics.fontBoundingBoxAscent + metrics.fontBoundingBoxDescent) || 18;
      if (!text.includes('\n') && ctx.measureText(text).width <= Math.max(0, width - 20)) {
        if (y + 4 + lineHeight <= y + height) paintText(text, 0, y + 4, lineHeight);
        ctx.restore();
        context.highlightSearch(x, y, width, height, rowIndex, columnIndex);
        return;
      }
      let line = '';
      let top = y + 4;
      let offset = 0;
      for (const character of text) {
        if (top + lineHeight > y + height) break;
        if (character === '\n' || (line && ctx.measureText(line + character).width > Math.max(0, width - 20))) {
          paintText(line, offset, top, lineHeight);
          offset += line.length + (character === '\n' ? 1 : 0);
          top += lineHeight;
          line = '';
        }
        if (character !== '\n') line += character;
      }
      if (top + lineHeight <= y + height) paintText(line, offset, top, lineHeight);
    } else if (header && context.headers.levels > 1) {
      ctx.textAlign = 'center';
      ctx.fillText(text, x + width / 2, y + height / 2);
    } else paintText(text, 0, y + height / 2);
    ctx.restore();
    if (!header) context.highlightSearch(x, y, width, height, rowIndex, columnIndex);
  }

  function imageCell(
    value: unknown,
    x: number,
    y: number,
    width: number,
    height: number,
    textColor: string,
    shape?: 'avatar' | 'thumbnail',
    label = '',
  ): void {
    if (!shape && (value == null || value === '')) return;
    let item: { image: HTMLImageElement; state: 'loading' | 'ready' | 'error' } | undefined;
    try {
      if (typeof value !== 'string') throw new TypeError('Image URL must be a string.');
      const url = new context.win.URL(value, context.doc.baseURI);
      if (
        url.username ||
        url.password ||
        !['http:', 'https:', 'blob:', 'data:'].includes(url.protocol) ||
        (url.protocol === 'data:' && !/^data:image\//i.test(value))
      )
        throw new TypeError('Unsupported image URL.');
      const src = url.href;
      context.mediaController.visibleImages.add(src);
      item = context.mediaController.imageCache.get(src);
      if (!item) {
        const image = context.doc.createElement('img');
        const record = { image, state: 'loading' as 'loading' | 'ready' | 'error' };
        context.mediaController.imageCache.set(src, record);
        item = record;
        image.crossOrigin = 'anonymous';
        image.referrerPolicy = 'no-referrer';
        image.decoding = 'async';
        const loaded = (state: 'ready' | 'error') => {
          if (context.destroyed || context.mediaController.imageCache.get(src) !== record) return;
          record.state = state;
          fullDraw = true;
          schedule();
        };
        image.onload = () => loaded(image.naturalWidth && image.naturalHeight ? 'ready' : 'error');
        image.onerror = () => loaded('error');
        image.src = src;
      }
    } catch {
      /* Invalid URLs use the same unavailable state as failed image loads. */
    }
    const ctx = context.context!;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x + 1, y + 1, Math.max(0, width - 2), Math.max(0, height - 2));
    ctx.clip();
    if (shape) {
      ctx.beginPath();
      ctx.roundRect(x + 1, y + 1, width - 2, height - 2, shape === 'avatar' ? width / 2 : 6);
      ctx.clip();
      ctx.fillStyle = context.theme.headerBackground;
      ctx.fillRect(x, y, width, height);
    }
    if (item?.state === 'ready') {
      const image = item.image;
      const ratio = shape
        ? Math.max(width / image.naturalWidth, height / image.naturalHeight)
        : Math.max(0, Math.min(1, (width - 16) / image.naturalWidth, (height - 8) / image.naturalHeight));
      const w = image.naturalWidth * ratio;
      const h = image.naturalHeight * ratio;
      if (ratio > 0) {
        ctx.save();
        if (!shape) {
          ctx.beginPath();
          ctx.roundRect(x + (width - w) / 2, y + (height - h) / 2, w, h, 6);
          ctx.clip();
        }
        ctx.drawImage(image, x + (width - w) / 2, y + (height - h) / 2, w, h);
        ctx.restore();
      }
    } else {
      ctx.font = context.theme.font;
      ctx.fillStyle = textColor;
      ctx.textBaseline = 'middle';
      if (shape) {
        ctx.textAlign = 'center';
        ctx.fillText(
          shape === 'avatar'
            ? label
                .trim()
                .split(/\s+/)
                .slice(0, 2)
                .map((part) => part[0])
                .join('')
                .toLocaleUpperCase() || '?'
            : item?.state === 'loading'
              ? '…'
              : '—',
          x + width / 2,
          y + height / 2,
        );
      } else
        ctx.fillText(
          item?.state === 'loading' ? context.t('Loading…') : context.t('Image unavailable'),
          x + 8,
          y + height / 2,
        );
    }
    ctx.restore();
    ctx.beginPath();
    if (shape) {
      ctx.save();
      ctx.strokeStyle = context.theme.background;
      ctx.lineWidth = 2;
      ctx.roundRect(x + 1, y + 1, width - 2, height - 2, shape === 'avatar' ? width / 2 : 6);
      ctx.stroke();
      ctx.restore();
      ctx.beginPath();
    }
  }

  function mediaCell(
    value: unknown,
    x: number,
    y: number,
    width: number,
    height: number,
    textColor: string,
    avatars: boolean,
  ): void {
    const items = mediaItems(value);
    if (!items.length) return;
    const size = Math.max(0, Math.min(context.mediaSize, height - 8, width - 16));
    if (size < 12) return;
    const step = avatars ? size * 0.76 : size + 6,
      available = Math.max(0, width - 16);
    let count = Math.min(context.mediaLimit, items.length, Math.max(1, Math.floor((available - size) / step) + 1));
    if (count < items.length && count * step + size > available) count = Math.max(0, count - 1);
    for (let i = 0; i < count; i++) {
      const item = items[i]!;
      imageCell(
        item.src,
        x + 8 + i * step,
        y + (height - size) / 2,
        size,
        size,
        textColor,
        avatars ? 'avatar' : 'thumbnail',
        item.name ?? item.alt ?? '',
      );
    }
    if (count < items.length) {
      const ctx = context.context!;
      ctx.save();
      ctx.fillStyle = context.theme.headerBackground;
      ctx.beginPath();
      ctx.roundRect(x + 8 + count * step, y + (height - size) / 2, size, size, avatars ? size / 2 : 6);
      ctx.fill();
      ctx.fillStyle = textColor;
      ctx.font = context.theme.font;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('+' + (items.length - count), x + 8 + count * step + size / 2, y + height / 2);
      ctx.restore();
      ctx.beginPath();
    }
  }

  function viewport() {
    return context.engine.getViewport({
      width: context.scroller.clientWidth,
      height: context.scroller.clientHeight,
      scrollLeft: context.scroller.scrollLeft,
      scrollTop: context.scroller.scrollTop,
    });
  }

  function clipRegion(region: ViewportRegion): void {
    const clip = region.clip;
    context.context!.beginPath();
    context.context!.rect(clip.x, context.headerHeight + clip.y, clip.width, clip.height);
    context.context!.clip();
  }

  function draw(): void {
    rowLockCache.clear();
    frame = undefined;
    if (context.destroyed) return;
    if (context.options.autoRowHeight && !context.editors.editor && !context.interaction.resizing)
      for (const row of context.visibleIndices('row')) {
        if (context.engine.isRowHeightManual(row) || measuredRows.has(row)) continue;
        const height = context.measureRowHeight(row, true);
        measuredRows.add(row);
        if (height !== context.rowAxis.size(row)) context.engine.measureRowHeight(row, height);
      }
    const view = viewport();
    if (!fullDraw) {
      for (const change of dirty.values()) {
        const col = context.columns.findIndex((column) => column.key === change.columnKey);
        const rect = view.cellRect(change.rowIndex, col);
        const clip = rect.clip;
        if (
          rect.x >= clip.x + clip.width ||
          rect.x + rect.width <= clip.x ||
          rect.y >= clip.y + clip.height ||
          rect.y + rect.height <= clip.y ||
          clip.width <= 0 ||
          clip.height <= 0
        )
          continue;
        context.context!.save();
        context.context!.beginPath();
        context.context!.rect(clip.x, context.headerHeight + clip.y, clip.width, clip.height);
        context.context!.clip();
        context.context!.beginPath();
        context.context!.rect(rect.x, context.headerHeight + rect.y, rect.width, rect.height);
        context.context!.clip();
        const value = context.engine.getValue(change.rowIndex, change.columnKey);
        if (context.viewportAccessibility) context.accessibleCell(change.rowIndex, col, value);
        cell(value, rect.x, context.headerHeight + rect.y, rect.width, rect.height, false, change.rowIndex, col);
        drawSelection(view.regions);
        context.context!.restore();
      }
      dirty.clear();
      return;
    }
    fullDraw = false;
    const pendingAccessible: { row: number; col: number; value: unknown }[] = [];
    const accessibleRows = new Map<number, HTMLElement>();
    const seenCells = new Set<string>();
    const headerNodes: HTMLElement[] = [];
    context.mediaController.visibleImages.clear();
    dirty.clear();
    const ratio = context.win.devicePixelRatio || 1;
    const height = Math.min(context.root.clientHeight, view.height + context.headerHeight);
    const pixelWidth = Math.max(0, Math.round(view.width * ratio));
    const pixelHeight = Math.max(0, Math.round(height * ratio));
    if (context.canvas.width !== pixelWidth) context.canvas.width = pixelWidth;
    if (context.canvas.height !== pixelHeight) context.canvas.height = pixelHeight;
    context.canvas.style.width = `${view.width}px`;
    context.canvas.style.height = `${height}px`;
    context.context!.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.context!.clearRect(0, 0, view.width, height);
    for (const region of view.regions) {
      context.context!.save();
      clipRegion(region);
      const painted = new Set<string>();
      for (let row = region.rows.start; row < region.rows.end; row++) {
        if (context.rowAxis.size(row) === 0) {
          row = context.rowAxis.indexAt(context.rowAxis.position(row));
          if (row >= region.rows.end) break;
        }
        for (let col = region.columns.start; col < region.columns.end; col++) {
          if (context.columnAxis.size(col) === 0) {
            col = context.columnAxis.indexAt(context.columnAxis.position(col));
            if (col >= region.columns.end) break;
          }
          const span = context.engine.getMerge(row, col),
            paintRow = span?.startRow ?? row,
            paintCol = span?.startColumn ?? col;
          const key = `${paintRow}:${paintCol}`;
          if (painted.has(key)) continue;
          painted.add(key);
          const rect = view.cellRect(paintRow, paintCol);
          const value = context.engine.getValue(paintRow, context.columns[paintCol]!.key);
          if (context.viewportAccessibility) pendingAccessible.push({ row: paintRow, col: paintCol, value });
          cell(value, rect.x, context.headerHeight + rect.y, rect.width, rect.height, false, paintRow, paintCol);
        }
      }
      context.context!.restore();
    }
    drawSelection(view.regions);
    const fixed = context.columnAxis.range(0, view.frozenWidth);
    const moving = context.columnAxis.range(
      context.columnAxis.position(context.engine.frozenColumns) + view.scrollLeft,
      view.width - view.frozenWidth,
    );
    for (const band of [
      { start: 0, end: Math.min(context.engine.frozenColumns, fixed.end), x: 0, width: view.frozenWidth, offset: 0 },
      {
        start: Math.max(context.engine.frozenColumns, moving.start),
        end: moving.end,
        x: view.frozenWidth,
        width: view.width - view.frozenWidth,
        offset: -view.scrollLeft,
      },
    ]) {
      if (band.width <= 0) continue;
      context.context!.save();
      context.context!.beginPath();
      context.context!.rect(band.x, 0, band.width, context.headerHeight);
      context.context!.clip();
      for (let col = band.start; col < band.end; col++) {
        if (context.columnAxis.size(col) === 0) {
          col = context.columnAxis.indexAt(context.columnAxis.position(col));
          if (col >= band.end) break;
        }
        const layout = context.leafHeaders[col]!;
        cell(
          context.columns[col]!.title,
          context.columnAxis.position(col) + band.offset,
          layout.level * context.headerRowHeight,
          context.columnAxis.size(col),
          layout.rowSpan * context.headerRowHeight,
          true,
          0,
          col,
        );
        const header = context.doc.createElement('div');
        header.dataset.gridHeaderCell = String(col);
        header.tabIndex = 0;
        header.setAttribute('role', context.viewportAccessibility ? 'columnheader' : 'button');
        header.setAttribute(
          'aria-label',
          context.viewportAccessibility
            ? context.columns[col]!.title
            : context.t('Select column {0}', context.columns[col]!.title),
        );
        header.addEventListener('keydown', (event) => {
          if (event.key === 'ContextMenu' || (event.key === 'F10' && event.shiftKey)) {
            event.preventDefault();
            const bounds = header.getBoundingClientRect();
            context.openMenu(0, col, bounds.left, bounds.bottom, true);
          } else if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            if (context.rowCount && context.finishEdit(true)) {
              context.startAxisSelection('column', col, event);
              context.scroller.focus({ preventScroll: true });
            }
          }
        });
        header.style.cssText = `position:absolute;left:${Math.max(band.x, context.columnAxis.position(col) + band.offset)}px;top:${layout.level * context.headerRowHeight}px;width:${Math.max(0, Math.min(band.x + band.width, context.columnAxis.position(col + 1) + band.offset) - Math.max(band.x, context.columnAxis.position(col) + band.offset))}px;height:${layout.rowSpan * context.headerRowHeight}px`;
        header.dataset.headerLevel = String(layout.level);
        header.setAttribute('aria-rowspan', String(layout.rowSpan));
        if (context.viewportAccessibility) {
          header.setAttribute('role', 'columnheader');
          header.setAttribute('aria-colindex', String(col + 1));
          header.setAttribute('aria-label', context.columns[col]!.title);
          header.setAttribute(
            'aria-description',
            context
              .stateLabels(null, col)
              .map((label) => context.t(label))
              .join('; '),
          );
          const sort = context.currentView?.sorts?.[0] ?? context.currentView?.sort;
          header.setAttribute(
            'aria-sort',
            sort?.columnKey === context.columns[col]!.key
              ? (context.currentView?.sorts?.length ?? 0) > 1
                ? 'other'
                : sort.direction === 'asc'
                  ? 'ascending'
                  : 'descending'
              : 'none',
          );
        }
        context.reorderHandle(header, 'column', col);
        headerNodes.push(header);
      }
      for (const group of context.headers.cells.filter(
        (cell) => !cell.leaf && cell.start < band.end && cell.end > band.start,
      )) {
        const x = context.columnAxis.position(group.start) + band.offset;
        const width = context.columnAxis.position(group.end) - context.columnAxis.position(group.start);
        const y = group.level * context.headerRowHeight;
        context.context!.fillStyle = context.theme.headerBackground;
        context.context!.fillRect(x, y, width, context.headerRowHeight);
        const activeColumn = context.engine.getSelection()?.columnIndex;
        if (
          (activeColumn !== undefined && activeColumn >= group.start && activeColumn < group.end) ||
          context
            .getSelectionRanges()
            .some(
              (range) =>
                range.startRow === 0 &&
                range.endRow === context.rowCount - 1 &&
                range.startColumn < group.end &&
                range.endColumn >= group.start,
            )
        ) {
          context.context!.save();
          context.context!.globalAlpha = context.headerTintOpacity;
          context.context!.fillStyle = context.theme.selectionColor;
          context.context!.fillRect(x, y, width, context.headerRowHeight);
          context.context!.restore();
        }
        context.context!.strokeStyle = context.theme.gridLineColor;
        context.context!.lineWidth = 1;
        context.context!.beginPath();
        context.context!.moveTo(x + width - 0.5, y);
        context.context!.lineTo(x + width - 0.5, y + context.headerRowHeight - 0.5);
        context.context!.lineTo(x, y + context.headerRowHeight - 0.5);
        context.context!.stroke();
        context.context!.save();
        context.context!.beginPath();
        context.context!.rect(x + 6, y, Math.max(0, width - 12), context.headerRowHeight);
        context.context!.clip();
        context.context!.font = context.theme.headerFont;
        context.context!.fillStyle = context.theme.headerTextColor;
        context.context!.textAlign = 'center';
        context.context!.textBaseline = 'middle';
        context.context!.fillText(
          group.title,
          (Math.max(band.x, x) + Math.min(band.x + band.width, x + width)) / 2,
          y + context.headerRowHeight / 2,
        );
        context.context!.restore();
        const node = context.doc.createElement('div');
        node.dataset.gridHeaderGroup = group.title;
        node.dataset.headerLevel = String(group.level);
        node.setAttribute('role', 'columnheader');
        node.setAttribute('aria-label', group.title);
        node.setAttribute('aria-colindex', String(group.start + 1));
        node.setAttribute('aria-colspan', String(group.end - group.start));
        node.style.cssText = `position:absolute;left:${Math.max(band.x, x)}px;top:${y}px;width:${Math.max(0, Math.min(band.x + band.width, x + width) - Math.max(band.x, x))}px;height:${context.headerRowHeight}px`;
        node.tabIndex = 0;
        node.dataset.groupStart = String(group.start);
        node.dataset.groupEnd = String(group.end - 1);
        node.addEventListener('keydown', (event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            context.selectHeaderGroup(group.start, group.end - 1, event);
          }
        });
        context.reorderHandle(node, 'column', group.start, group.end - 1);
        headerNodes.push(node);
      }
      context.context!.restore();
    }
    const focusedHeader = context.headerSurface.contains(context.doc.activeElement)
      ? (context.doc.activeElement as HTMLElement).dataset.gridHeaderCell
      : undefined;
    const focusedGroup = context.headerSurface.contains(context.doc.activeElement)
      ? (context.doc.activeElement as HTMLElement).dataset.gridHeaderGroup
      : undefined;
    const focusedGroupStart = context.headerSurface.contains(context.doc.activeElement)
      ? (context.doc.activeElement as HTMLElement).dataset.groupStart
      : undefined;
    if (context.viewportAccessibility && context.headers.levels > 1) {
      const rows = Array.from({ length: context.headers.levels }, (_, level) => {
        const row = context.doc.createElement('div');
        row.setAttribute('role', 'row');
        row.setAttribute('aria-rowindex', String(level + 1));
        row.append(...headerNodes.filter((node) => Number(node.dataset.headerLevel) === level));
        return row;
      });
      context.headerSurface.replaceChildren(...rows);
    } else context.headerSurface.replaceChildren(...headerNodes);
    if (focusedHeader !== undefined)
      headerNodes.find((node) => node.dataset.gridHeaderCell === focusedHeader)?.focus({ preventScroll: true });
    else if (focusedGroup !== undefined)
      headerNodes
        .find((node) => node.dataset.gridHeaderGroup === focusedGroup && node.dataset.groupStart === focusedGroupStart)
        ?.focus({ preventScroll: true });
    for (const { row, col, value } of pendingAccessible) {
      let rowNode = accessibleRows.get(row);
      if (!rowNode) {
        rowNode = context.doc.createElement('div');
        rowNode.setAttribute('role', 'row');
        rowNode.setAttribute('aria-rowindex', String(row + context.headers.levels + 1));
        accessibleRows.set(row, rowNode);
      }
      seenCells.add(`${row}:${col}`);
      rowNode.append(context.accessibleCell(row, col, value));
    }
    if (context.viewportAccessibility) {
      for (const key of context.accessibility.accessibleCells.keys())
        if (!seenCells.has(key)) context.accessibility.accessibleCells.delete(key);
      context.accessibleBody.replaceChildren(
        ...[...accessibleRows.entries()].sort(([a], [b]) => a - b).map(([, row]) => row),
      );
      const selection = context.engine.getSelection();
      const node =
        selection && context.accessibility.accessibleCells.get(`${selection.rowIndex}:${selection.columnIndex}`);
      if (node) {
        context.activeRow.hidden = true;
        context.scroller.setAttribute('aria-activedescendant', node.id);
      } else if (selection) {
        context.activeRow.hidden = false;
        context.scroller.setAttribute('aria-activedescendant', context.activeCell.id);
      }
    }
    drawIndex();
    context.releaseUnusedImages();
  }

  function drawIndex(): void {
    if (!context.indexWidth) return;
    const outline = context.engine.getRowGroups();
    const depths = new Map(
      outline.map((group) => [
        group.id,
        outline.filter(
          (other) => other.id !== group.id && other.startRow <= group.startRow && other.endRow >= group.endRow,
        ).length,
      ]),
    );
    const levels = outline.reduce((max, group) => Math.max(max, depths.get(group.id)! + 1), 0);
    const view = viewport();
    const range = context.getSelectionRange();
    context.indexGutter.style.height = `${context.headerHeight + view.height}px`;
    const corner = context.doc.createElement('button');
    corner.type = 'button';
    corner.tabIndex = -1;
    corner.textContent = '#';
    corner.title = context.t('Select all cells');
    corner.setAttribute('aria-label', context.t('Select all cells'));
    corner.disabled = !context.rowCount || !context.columns.length;
    corner.setAttribute(
      'aria-pressed',
      String(
        !!range &&
          range.startRow === 0 &&
          range.endRow === context.rowCount - 1 &&
          range.startColumn === 0 &&
          range.endColumn === context.columns.length - 1,
      ),
    );
    corner.addEventListener('click', (event) => {
      if (event.detail === 0) {
        context.selectAll();
        context.scroller.focus({ preventScroll: true });
      }
    });
    corner.style.cssText = `width:100%;padding:0;border:0;background:transparent;color:inherit;font:inherit;cursor:pointer;height:${context.headerHeight}px;display:flex;align-items:center;justify-content:center;border-bottom:1px solid var(--acheron-grid-line-color);border-right:1px solid var(--acheron-grid-line-color);box-sizing:border-box`;
    const children: HTMLElement[] = [corner];
    const fixed = context.rowAxis.range(0, view.frozenHeight);
    const moving = context.rowAxis.range(
      context.rowAxis.position(context.engine.frozenRows) + view.scrollTop,
      view.height - view.frozenHeight,
    );
    for (const band of [
      { start: 0, end: Math.min(context.engine.frozenRows, fixed.end), y: 0, height: view.frozenHeight, offset: 0 },
      {
        start: Math.max(context.engine.frozenRows, moving.start),
        end: moving.end,
        y: view.frozenHeight,
        height: view.height - view.frozenHeight,
        offset: -view.scrollTop,
      },
    ]) {
      if (band.height <= 0) continue;
      const pane = context.doc.createElement('div');
      pane.style.cssText = `position:absolute;left:0;top:${context.headerHeight + band.y}px;width:100%;height:${band.height}px;overflow:hidden`;
      for (let row = band.start; row < band.end; row++) {
        if (context.rowAxis.size(row) === 0) {
          row = context.rowAxis.indexAt(context.rowAxis.position(row));
          if (row >= band.end) break;
        }
        const button = context.doc.createElement('button');
        button.type = 'button';
        button.tabIndex = -1;
        const sourceIndex = context.engine.getRowSourceIndex(row);
        button.textContent = String(sourceIndex + 1);
        button.setAttribute('aria-label', context.t('Select row {0}', sourceIndex + 1));
        const labels = context.rowLabels(row);
        const locked = labels.includes(context.t('Row locked'));
        button.title = [context.t('Select row {0}', sourceIndex + 1), ...labels].join('; ');
        button.setAttribute('aria-description', labels.map((label) => context.t(label)).join('; '));
        if (locked) {
          const icon = context.rowLockSvg.cloneNode(true) as Element;
          icon.setAttribute('width', '12');
          icon.setAttribute('height', '12');
          icon.setAttribute('aria-hidden', 'true');
          icon.setAttribute(
            'style',
            'position:absolute;right:3px;top:4px;pointer-events:none;color:var(--acheron-icon-color)',
          );
          button.append(context.doc.importNode(icon, true));
        }
        const selected = context
          .getSelectionRanges()
          .some(
            (range) =>
              range.startColumn === 0 &&
              range.endColumn === context.columns.length - 1 &&
              row >= range.startRow &&
              row <= range.endRow,
          );
        button.setAttribute('aria-pressed', String(selected));
        button.style.cssText = `position:absolute;left:0;top:${context.rowAxis.position(row) + band.offset - band.y}px;width:100%;height:${context.rowAxis.size(row)}px;box-sizing:border-box;border:0;border-right:1px solid var(--acheron-grid-line-color);border-bottom:1px solid var(--acheron-grid-line-color);background:var(--acheron-header-background);color:inherit;font:inherit;cursor:pointer;${selected || context.engine.getSelection()?.rowIndex === row ? 'box-shadow:inset 0 0 0 9999px color-mix(in srgb,var(--acheron-selection-color) 16%,transparent)' : ''}`;
        if (locked) {
          button.style.background =
            'color-mix(in srgb,var(--acheron-header-text-color) 12%,var(--acheron-header-background))';
          button.style.padding = '0 16px 0 2px';
        }
        button.addEventListener('click', (event) => {
          if (event.detail === 0 && context.finishEdit(true)) {
            context.selectRow(row);
            context.scroller.focus({ preventScroll: true });
          }
        });
        const resizeHandle = context.doc.createElement('span');
        resizeHandle.dataset.gridRowResize = String(row);
        resizeHandle.setAttribute('aria-hidden', 'true');
        resizeHandle.title = 'Drag to resize row; double-click to fit';
        resizeHandle.style.cssText = 'position:absolute;bottom:0;left:0;width:100%;height:5px;cursor:row-resize';
        button.append(resizeHandle);
        context.reorderHandle(button, 'row', row);
        pane.append(button);
        if (outline.length) button.style.paddingLeft = `${levels * 24}px`;
        for (const group of outline.filter(
          (group) => !group.collapsed && group.startRow <= sourceIndex && group.endRow >= sourceIndex,
        )) {
          const depth = depths.get(group.id)!;
          const line = context.doc.createElement('span');
          line.setAttribute('aria-hidden', 'true');
          line.style.cssText = `position:absolute;left:${depth * 24 + 12}px;top:${context.rowAxis.position(row) + band.offset - band.y + (group.startRow === sourceIndex ? context.rowAxis.size(row) / 2 + 10 : 0)}px;width:6px;height:${group.startRow === sourceIndex ? Math.max(0, context.rowAxis.size(row) / 2 - 10) : group.endRow === sourceIndex ? context.rowAxis.size(row) / 2 : context.rowAxis.size(row)}px;box-sizing:border-box;border-left:1px solid color-mix(in srgb,var(--acheron-icon-color) 35%,var(--acheron-grid-line-color));${group.endRow === sourceIndex ? 'border-bottom:1px solid var(--acheron-grid-line-color);border-bottom-left-radius:4px;' : ''}pointer-events:none;transform-origin:top`;
          pane.append(line);
          if (context.enteringGroups.has(group.id) && context.motionEnabled())
            line.animate(
              [
                { opacity: 0, transform: 'scaleY(.6)' },
                { opacity: 1, transform: 'scaleY(1)' },
              ],
              { duration: 180, easing: 'cubic-bezier(.22,1,.36,1)' },
            );
        }
        for (const group of outline
          .filter((group) => group.startRow === sourceIndex)
          .sort((a, b) => b.endRow - a.endRow)) {
          const depth = depths.get(group.id)!;
          const toggle = context.doc.createElement('button');
          toggle.type = 'button';
          toggle.dataset.gridRowGroup = group.id;
          toggle.setAttribute(
            'aria-label',
            context.t(
              '{0} rows {1}–{2}',
              group.collapsed ? context.t('Expand') : context.t('Collapse'),
              group.startRow + 1,
              group.endRow + 1,
            ),
          );
          toggle.setAttribute('aria-expanded', String(!group.collapsed));
          toggle.disabled = !context.engine.canChangeLayout({ kind: group.collapsed ? 'expand' : 'collapse', group });
          toggle.title =
            toggle.getAttribute('aria-label')! + ' · ' + context.t('{0} rows', group.endRow - group.startRow + 1);
          const glyph = svgIcon('chevron-down');
          if (group.collapsed) glyph.setAttribute('style', 'transform:rotate(-90deg)');
          glyph.setAttribute('width', '12');
          glyph.setAttribute('height', '12');
          toggle.append(glyph);
          toggle.style.cssText = `position:absolute;left:${depth * 24 + 3}px;top:${context.rowAxis.position(row) + band.offset - band.y + Math.max(0, (context.rowAxis.size(row) - 20) / 2)}px;width:20px;height:20px;display:flex;align-items:center;justify-content:center;padding:2px;border:0;border-radius:6px;background:color-mix(in srgb,var(--acheron-icon-color) 7%,var(--acheron-header-background));color:var(--acheron-header-text-color);cursor:pointer`;
          if (context.enteringGroups.has(group.id) && context.motionEnabled())
            toggle.animate(
              [
                { opacity: 0, transform: 'scale(.8)' },
                { opacity: 1, transform: 'scale(1)' },
              ],
              { duration: 180, easing: 'cubic-bezier(.22,1,.36,1)' },
            );
          toggle.addEventListener('pointerdown', (event) => {
            event.stopPropagation();
          });
          toggle.addEventListener('click', (event) => {
            event.stopPropagation();
            try {
              context.structureAction(() => context.engine.setGroupCollapsed(group.id, !group.collapsed), 'row');
            } catch (error) {
              context.actionError.textContent =
                error instanceof Error ? context.t(error.message) : context.t('Unable to toggle row group.');
              context.actionError.style.display = 'block';
            }
          });
          pane.append(toggle);
        }
      }
      children.push(pane);
    }
    context.indexGutter.replaceChildren(...children);
    context.enteringGroups.clear();
  }

  function drawSelection(regions: readonly ViewportRegion[]): void {
    const selection = context.engine.getSelection();
    const original = context.getSelectionRanges();
    const ranges: SelectionRange[] = [];
    for (const axis of ['row', 'column'] as const) {
      const full = (range: SelectionRange) =>
        axis === 'row'
          ? range.startColumn === 0 && range.endColumn === context.columns.length - 1
          : range.startRow === 0 &&
            range.endRow === context.rowCount - 1 &&
            !(range.startColumn === 0 && range.endColumn === context.columns.length - 1);
      const start = axis === 'row' ? 'startRow' : 'startColumn';
      const end = axis === 'row' ? 'endRow' : 'endColumn';
      const merged: SelectionRange[] = [];
      for (const range of original
        .filter(full)
        .map((range) => ({ ...range }))
        .sort((a, b) => a[start] - b[start])) {
        const previous = merged.at(-1);
        if (previous && range[start] <= previous[end] + 1) previous[end] = Math.max(previous[end], range[end]);
        else merged.push(range);
      }
      ranges.push(...merged);
    }
    ranges.push(
      ...original.filter(
        (range) =>
          !(range.startColumn === 0 && range.endColumn === context.columns.length - 1) &&
          !(range.startRow === 0 && range.endRow === context.rowCount - 1),
      ),
    );
    if (!selection || !ranges.length) return;
    const activeScope = original.some(
      (range) =>
        selection.rowIndex >= range.startRow &&
        selection.rowIndex <= range.endRow &&
        selection.columnIndex >= range.startColumn &&
        selection.columnIndex <= range.endColumn &&
        ((range.startColumn === 0 && range.endColumn === context.columns.length - 1) ||
          (range.startRow === 0 && range.endRow === context.rowCount - 1)),
    );
    for (const region of regions) {
      context.context!.save();
      clipRegion(region);
      context.context!.strokeStyle = context.theme.selectionColor;
      context.context!.lineWidth = context.rangeBorderWidth;
      for (const range of ranges) {
        if (
          !activeScope &&
          range.startRow === range.endRow &&
          range.startColumn === range.endColumn &&
          range.startRow === selection.rowIndex &&
          range.startColumn === selection.columnIndex
        )
          continue;
        context.context!.strokeRect(
          context.columnAxis.position(range.startColumn) + region.offsetX + context.rangeBorderWidth / 2,
          context.headerHeight +
            context.rowAxis.position(range.startRow) +
            region.offsetY +
            context.rangeBorderWidth / 2,
          Math.max(
            0,
            context.columnAxis.position(range.endColumn + 1) -
              context.columnAxis.position(range.startColumn) -
              context.rangeBorderWidth,
          ),
          Math.max(
            0,
            context.rowAxis.position(range.endRow + 1) -
              context.rowAxis.position(range.startRow) -
              context.rangeBorderWidth,
          ),
        );
      }
      // Draw the active cell once in its own pane, above semantic cell colors.
      if (
        !activeScope &&
        (context.options.selectionStyle?.activeCellBorderInRange ||
          !context
            .getSelectionRanges()
            .some(
              (range) =>
                (range.startRow !== range.endRow || range.startColumn !== range.endColumn) &&
                selection.rowIndex >= range.startRow &&
                selection.rowIndex <= range.endRow &&
                selection.columnIndex >= range.startColumn &&
                selection.columnIndex <= range.endColumn,
            )) &&
        !context.engine.getMerge(selection.rowIndex, selection.columnIndex) &&
        selection.rowIndex >= region.rows.start &&
        selection.rowIndex < region.rows.end &&
        selection.columnIndex >= region.columns.start &&
        selection.columnIndex < region.columns.end
      ) {
        const x = context.columnAxis.position(selection.columnIndex) + region.offsetX;
        const y = context.headerHeight + context.rowAxis.position(selection.rowIndex) + region.offsetY;
        const width = context.columnAxis.size(selection.columnIndex);
        const height = context.rowAxis.size(selection.rowIndex);
        context.context!.strokeStyle = context.theme.selectionColor;
        context.context!.lineWidth = context.activeBorderWidth;
        context.context!.strokeRect(
          x + context.activeBorderWidth / 2,
          y + context.activeBorderWidth / 2,
          Math.max(0, width - context.activeBorderWidth),
          Math.max(0, height - context.activeBorderWidth),
        );
      }
      context.context!.restore();
    }
  }

  function render(): void {
    if (context.destroyed) return;
    context.syncAccessibleCell();
    const view = viewport();
    context.freezeVertical.hidden = !context.engine.frozenColumns || view.frozenWidth >= view.width;
    context.freezeVertical.style.left = `${context.indexWidth + Math.max(0, view.frozenWidth - 1)}px`;
    context.freezeVertical.style.top = '0px';
    context.freezeVertical.style.width = '2px';
    context.freezeVertical.style.height = `${context.headerHeight + view.height}px`;
    context.freezeHorizontal.hidden = !context.engine.frozenRows || view.frozenHeight >= view.height;
    context.freezeHorizontal.style.top = `${context.headerHeight + Math.max(0, view.frozenHeight - 1)}px`;
    context.freezeHorizontal.style.left = '0px';
    context.freezeHorizontal.style.height = '2px';
    context.freezeHorizontal.style.width = `${context.indexWidth + view.width}px`;
    // Show selected boundaries above the frozen seam without breaking the rest of the separator.
    for (const [line, axis, seam, offset] of [
      [context.freezeVertical, 'column', context.engine.frozenColumns, context.headerHeight],
      [context.freezeHorizontal, 'row', context.engine.frozenRows, context.indexWidth],
    ] as const) {
      const segments: string[] = [];
      for (const range of context.getSelectionRanges()) {
        const first = axis === 'column' ? range.startColumn : range.startRow,
          last = axis === 'column' ? range.endColumn : range.endRow;
        if (first !== seam && last + 1 !== seam) continue;
        for (const region of view.regions) {
          const start =
            axis === 'column'
              ? Math.max(range.startRow, region.rows.start)
              : Math.max(range.startColumn, region.columns.start);
          const end =
            axis === 'column'
              ? Math.min(range.endRow + 1, region.rows.end)
              : Math.min(range.endColumn + 1, region.columns.end);
          if (start >= end) continue;
          const layout = axis === 'column' ? context.rowAxis : context.columnAxis,
            shift = axis === 'column' ? region.offsetY : region.offsetX;
          const clipStart = axis === 'column' ? region.clip.y : region.clip.x,
            clipEnd = clipStart + (axis === 'column' ? region.clip.height : region.clip.width);
          const from = offset + Math.max(clipStart, layout.position(start) + shift),
            to = offset + Math.min(clipEnd, layout.position(end) + shift);
          if (to > from)
            segments.push(
              `linear-gradient(${axis === 'column' ? 'to bottom' : 'to right'},transparent ${from}px,var(--acheron-selection-color) ${from}px,var(--acheron-selection-color) ${to}px,transparent ${to}px)`,
            );
        }
      }
      line.style.background = segments.length
        ? segments.join(',') + ',var(--acheron-freeze-color)'
        : 'var(--acheron-freeze-color)';
    }
    context.endResize();
    context.positionEditor();
    const range = context.getSelectionRange();
    context.selectionHandles.forEach((button, i) => {
      button.hidden = (!context.interaction.touchSelection && i === 0) || !range || !!context.editors.editor;
      if (button.hidden || !range) return;
      const size = context.interaction.touchSelection ? 20 : 10;
      const half = size / 2;
      button.style.width = button.style.height = `${size}px`;
      button.style.borderRadius = context.interaction.touchSelection ? '50%' : '0';
      button.style.borderWidth = context.interaction.touchSelection ? '3px' : '2px';
      const rect = view.cellRect(
        i === 0 ? range.startRow : range.endRow,
        i === 0 ? range.startColumn : range.endColumn,
      );
      const x = rect.x + (i ? rect.width : 0);
      const y = rect.y + (i ? rect.height : 0);
      button.hidden =
        x < rect.clip.x || x > rect.clip.x + rect.clip.width || y < rect.clip.y || y > rect.clip.y + rect.clip.height;
      button.style.left = `${context.indexWidth + Math.max(half, Math.min(view.width - half, x)) - half}px`;
      button.style.top = `${context.headerHeight + Math.max(half, Math.min(view.height - half, y)) - half}px`;
    });
    context.closeMenu();
    fullDraw = true;
    schedule();
  }

  function schedule(): void {
    if (!context.destroyed && frame === undefined) frame = context.win.requestAnimationFrame(draw);
  }
  return {
    svgIcon,
    invalidate,
    updateCells,
    replay,
    cellLinks,
    linksForValue,
    validationMessage,
    rowValueLocked,
    viewport,
    draw,
    render,
    schedule,
    get measuredRows() {
      return measuredRows;
    },
    get dirty() {
      return dirty;
    },
    get fullDraw() {
      return fullDraw;
    },
    set fullDraw(value: boolean) {
      fullDraw = value;
    },
    get rowLockCache() {
      return rowLockCache;
    },
    get frame() {
      return frame;
    },
    set frame(value: number | undefined) {
      frame = value;
    },
  };
}
