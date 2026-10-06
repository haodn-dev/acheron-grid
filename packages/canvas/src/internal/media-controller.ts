import type { Column, GridEngine, PasteOptions, SelectionRange } from '@acheron-grid/core';
import { encodeBlocks } from '@acheron-grid/core';
import type { GridOptions } from '../grid.js';
import type { CanvasTranslator } from '../locale.js';
import type { MediaItem } from '../media.js';
import { mediaItems, validateMediaValue } from '../media.js';
import { createOverlay } from './overlay.js';

interface MediaControllerContext {
  readonly avatarColumns: ReadonlySet<string>;
  readonly columns: readonly Column[];
  readonly destroyed: boolean;
  readonly doc: Document;
  readonly engine: GridEngine;
  readonly finishEdit: (commit: boolean) => boolean;
  readonly getSelectionRanges: () => SelectionRange[];
  readonly mediaColumn: (key: string) => boolean;
  readonly options: GridOptions;
  readonly overlay: ReturnType<typeof createOverlay>;
  readonly pasteSelectionBlocks: (text: string, pasteOptions?: PasteOptions) => void;
  readonly root: HTMLDivElement;
  readonly scroller: HTMLDivElement;
  readonly t: CanvasTranslator;
  readonly win: Window & typeof globalThis;
}

export function createMediaController(context: MediaControllerContext) {
  const ownedImageUrls = new Set<string>();
  let mediaUpload: AbortController | undefined;
  const imageCache = new Map<string, { image: HTMLImageElement; state: 'loading' | 'ready' | 'error' }>();
  const visibleImages = new Set<string>();
  async function pasteImages(files: readonly File[]): Promise<void> {
    const selection = context.engine.getSelection();
    if (!selection) return;
    const key = selection.columnKey,
      ranges = context.getSelectionRanges(),
      target = JSON.stringify(ranges),
      created: string[] = [];
    let controller: AbortController | undefined, status: HTMLDivElement | undefined;
    try {
      if (!context.mediaColumn(key)) throw new Error('Select an image or people column before pasting images.');
      if (files.length > 100 || files.some((file) => file.size > 20 * 1024 * 1024))
        throw new Error('Paste at most 100 images, each no larger than 20 MiB.');
      if (!context.engine.canPaste()) throw new Error('This cell does not allow pasting.');
      if (
        ranges.reduce(
          (count, range) => count + (range.endRow - range.startRow + 1) * (range.endColumn - range.startColumn + 1),
          0,
        ) > 100_000
      )
        throw new RangeError('Image paste selection is too large.');
      const destinations = ranges.flatMap((range) =>
        Array.from({ length: range.endRow - range.startRow + 1 }, (_, i) =>
          Array.from({ length: range.endColumn - range.startColumn + 1 }, (_, j) => {
            const row = range.startRow + i,
              col = range.startColumn + j;
            return {
              row,
              key: context.columns[col]!.key,
              id: context.engine.getRowId(row),
              value: context.engine.getValue(row, context.columns[col]!.key),
            };
          }),
        ).flat(),
      );
      const concurrency = context.options.mediaOptions?.maxConcurrentUploads ?? 4;
      if (!Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 100)
        throw new RangeError('Invalid upload concurrency.');
      mediaUpload?.abort();
      controller = new context.win.AbortController();
      mediaUpload = controller;
      status = context.doc.createElement('div');
      status.setAttribute('aria-label', context.t('Image upload'));
      status.setAttribute('role', 'status');
      status.style.cssText =
        'position:absolute;z-index:40;right:12px;bottom:12px;padding:10px;display:flex;gap:12px;align-items:center;background:var(--acheron-background);color:var(--acheron-text-color);border:1px solid var(--acheron-grid-line-color);font:13px sans-serif';
      const label = context.doc.createElement('span'),
        cancel = context.doc.createElement('button');
      cancel.type = 'button';
      cancel.textContent = context.t('Cancel upload');
      cancel.addEventListener('click', () => controller?.abort());
      status.append(label, cancel);
      context.root.append(status);
      controller.signal.addEventListener('abort', () => status?.remove(), { once: true });
      const progress = new Map<number, number>();
      let completed = 0,
        nextFile = 0;
      const values: MediaItem[] = [];
      function reportProgress(): void {
        label.textContent = context.t(
          'Uploading images: {0}/{1} completed{2}',
          completed,
          files.length,
          progress.size
            ? context.t(
                ', {0} bytes',
                [...progress.values()].reduce((sum, value) => sum + value, 0),
              )
            : '',
        );
      }
      reportProgress();
      await Promise.all(
        Array.from({ length: Math.min(concurrency, files.length) }, async () => {
          while (nextFile < files.length) {
            if (controller!.signal.aborted) throw new Error('Image upload canceled.');
            const index = nextFile++,
              file = files[index]!;
            if (context.options.mediaOptions?.upload)
              values[index] = await context.options.mediaOptions.upload(
                file,
                Object.freeze({
                  columnKey: key,
                  signal: controller!.signal,
                  onProgress: (loaded: number, total?: number) => {
                    if (
                      mediaUpload !== controller ||
                      controller!.signal.aborted ||
                      !Number.isFinite(loaded) ||
                      loaded < 0 ||
                      (total !== undefined && (!Number.isFinite(total) || total < loaded))
                    )
                      return;
                    progress.set(index, loaded);
                    reportProgress();
                  },
                }),
              );
            else {
              const src = context.win.URL.createObjectURL(file);
              created.push(src);
              values[index] = { src, alt: file.name };
            }
            completed++;
            reportProgress();
          }
        }),
      );
      if (
        context.destroyed ||
        controller.signal.aborted ||
        JSON.stringify(context.getSelectionRanges()) !== target ||
        context.engine.getSelection()?.rowId !== selection.rowId ||
        context.engine.getSelection()?.columnKey !== key ||
        destinations.some(
          (cell) =>
            cell.row >= context.engine.rowCount ||
            context.engine.getRowId(cell.row) !== cell.id ||
            !Object.is(context.engine.getValue(cell.row, cell.key), cell.value),
        )
      )
        throw new Error('Image paste canceled because its destination changed.');
      const value = validateMediaValue(values);
      context.pasteSelectionBlocks(encodeBlocks([{ row: 0, column: 0, values: [[JSON.stringify(value)]] }]));
      for (const src of created) ownedImageUrls.add(src);
      if (mediaUpload === controller) mediaUpload = undefined;
    } catch (error) {
      const current = !controller || (mediaUpload === controller && !controller.signal.aborted);
      controller?.abort();
      if (mediaUpload === controller) mediaUpload = undefined;
      for (const src of created) context.win.URL.revokeObjectURL(src);
      if (!context.destroyed && current)
        context.win.alert(error instanceof Error ? context.t(error.message) : context.t('Unable to paste images.'));
    } finally {
      status?.remove();
    }
  }

  function openMedia(row: number, col: number): boolean {
    const key = context.columns[col]!.key;
    if (!context.mediaColumn(key)) return false;
    if (context.overlay.activeDialog?.open || !context.finishEdit(true)) return true;
    const items = mediaItems(context.engine.getValue(row, key)),
      avatars = context.avatarColumns.has(key);
    const dialog = context.doc.createElement('dialog');
    dialog.dataset.gridDialog = '';
    dialog.setAttribute('aria-label', avatars ? context.t('Cell people') : context.t('Cell images'));
    context.overlay.activeDialog = dialog;
    dialog.style.cssText = 'width:min(560px,calc(100vw - 48px));max-height:75vh;box-sizing:border-box';
    const title = context.doc.createElement('h2');
    title.textContent = context.columns[col]!.title + ' · ' + items.length;
    const list = context.doc.createElement('div');
    list.style.cssText = avatars
      ? 'display:grid;gap:12px'
      : 'display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px';
    for (const [i, item] of items.entries()) {
      const figure = context.doc.createElement('figure');
      figure.style.cssText =
        'margin:0;display:flex;gap:12px;' + (avatars ? 'align-items:center' : 'flex-direction:column');
      const label = item.name ?? item.alt ?? (avatars ? context.t('Person ') : context.t('Image ')) + (i + 1);
      const fallback = context.doc.createElement('span');
      fallback.textContent = avatars
        ? label
            .trim()
            .split(/\s+/)
            .slice(0, 2)
            .map((part) => part[0])
            .join('')
            .toLocaleUpperCase()
        : context.t('Image unavailable');
      fallback.style.cssText =
        'display:grid;place-items:center;background:var(--acheron-header-background);min-height:48px;padding:8px;border-radius:8px';
      figure.append(fallback);
      if (item.src) {
        try {
          const url = new context.win.URL(item.src, context.doc.baseURI);
          if (
            url.username ||
            url.password ||
            !['http:', 'https:', 'blob:', 'data:'].includes(url.protocol) ||
            (url.protocol === 'data:' && !/^data:image\//i.test(item.src))
          )
            throw new Error();
          const image = context.doc.createElement('img');
          image.crossOrigin = 'anonymous';
          image.alt = label;
          image.referrerPolicy = 'no-referrer';
          image.loading = 'lazy';
          image.style.cssText = avatars
            ? 'width:44px;height:44px;object-fit:cover;border-radius:50%'
            : 'width:100%;height:160px;object-fit:contain;border-radius:8px';
          image.onload = () => fallback.remove();
          image.onerror = () => image.remove();
          image.src = url.href;
          figure.prepend(image);
        } catch {
          /* Keep a readable fallback for invalid image URLs. */
        }
      }
      const caption = context.doc.createElement('figcaption');
      caption.textContent = label;
      figure.append(caption);
      list.append(figure);
    }
    if (!items.length) list.textContent = avatars ? context.t('No people') : context.t('No images');
    const close = context.doc.createElement('button');
    close.type = 'button';
    close.textContent = context.t('Close');
    close.onclick = () => dialog.close();
    dialog.append(title, list, close);
    context.root.append(dialog);
    dialog.addEventListener('close', () => {
      dialog.remove();
      if (context.overlay.activeDialog === dialog) context.overlay.activeDialog = null;
      if (!context.destroyed) context.scroller.focus({ preventScroll: true });
    });
    dialog.showModal();
    close.focus();
    return true;
  }

  function releaseUnusedImages(): void {
    for (const [src, record] of imageCache)
      if (!visibleImages.has(src)) {
        record.image.onload = record.image.onerror = null;
        imageCache.delete(src);
      }
  }
  return {
    pasteImages,
    openMedia,
    releaseUnusedImages,
    get ownedImageUrls() {
      return ownedImageUrls;
    },
    get mediaUpload() {
      return mediaUpload;
    },
    set mediaUpload(value: AbortController | undefined) {
      mediaUpload = value;
    },
    get imageCache() {
      return imageCache;
    },
    get visibleImages() {
      return visibleImages;
    },
  };
}
