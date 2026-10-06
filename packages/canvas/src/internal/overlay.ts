import type { GridEngine } from '@acheron-grid/core';
import type { GridOptions } from '../grid.js';
import type { CanvasTranslator } from '../locale.js';
import { safeWebUrl } from '../links.js';
import type { detectLinks } from '../links.js';
import type { icons } from '../icons.js';

interface OverlayContext {
  readonly win: Window & typeof globalThis;
  readonly doc: Document;
  readonly root: HTMLElement;
  readonly engine: GridEngine;
  readonly options: Pick<GridOptions, 'allowOpenLinks' | 'linkPreview'>;
  readonly t: CanvasTranslator;
  readonly scroller: HTMLElement;
  readonly destroyed: boolean;
  readonly cellLinks: (row: number, col: number) => ReturnType<typeof detectLinks>;
  readonly svgIcon: (name: keyof typeof icons, size?: number) => Element;
  readonly exitSurface: (node: HTMLElement) => void;
}

export function createOverlay(context: OverlayContext) {
  let menu: HTMLDivElement | null = null;
  let previewAbort: AbortController | undefined;
  let activeDialog: HTMLDialogElement | null = null;
  let linkHoverTimer = 0;
  let linkHoverKey = '';
  function closeMenu(focus = false): void {
    previewAbort?.abort();
    previewAbort = undefined;
    if (menu) context.exitSurface(menu);
    menu = null;
    if (focus && !context.destroyed) context.scroller.focus({ preventScroll: true });
  }

  function cancelLinkPreviewHover(): void {
    context.win.clearTimeout(linkHoverTimer);
    linkHoverKey = '';
  }

  function openLinks(row: number, col: number, x: number, y: number, focus = true): void {
    if (context.options.allowOpenLinks === false || !context.engine.getCellPermission(row, col).selectable) return;
    const links = context.cellLinks(row, col);
    if (!links.length) return;
    closeMenu();
    const popup = context.doc.createElement('div');
    menu = popup;
    popup.popover = 'auto';
    popup.setAttribute('role', 'dialog');
    popup.setAttribute('aria-label', context.t('Cell links'));
    popup.style.cssText =
      'position:fixed;margin:0;padding:12px;max-width:calc(100vw - 24px);max-height:calc(100vh - 24px);overflow:auto;border:1px solid var(--acheron-grid-line-color);border-radius:8px;background:var(--acheron-background);color:var(--acheron-text-color);font:var(--acheron-font);box-shadow:0 12px 32px #0003';
    const metadataAllowed =
      typeof context.options.linkPreview === 'object' && context.options.linkPreview.allowMetadata !== false;
    let previews =
      metadataAllowed &&
      typeof context.options.linkPreview === 'object' &&
      context.options.linkPreview.enabled !== false;
    const toggle = context.doc.createElement('button');
    toggle.type = 'button';
    toggle.textContent = previews ? context.t('Hide website details') : context.t('Show website details');
    toggle.setAttribute('aria-pressed', String(previews));
    toggle.style.cssText =
      'padding:6px 10px;margin:0 0 8px;border:1px solid var(--acheron-grid-line-color);border-radius:6px;background:var(--acheron-header-background);color:inherit;font:inherit';
    if (metadataAllowed) popup.append(toggle);
    const entries = context.doc.createElement('div');
    entries.style.cssText = 'display:grid;gap:8px;max-width:420px';
    popup.append(entries);
    function positionLinks(): void {
      if (!popup.isConnected) return;
      popup.style.left = `${Math.max(8, Math.min(x, context.win.innerWidth - popup.offsetWidth - 8))}px`;
      popup.style.top = `${Math.max(8, Math.min(y, context.win.innerHeight - popup.offsetHeight - 8))}px`;
    }
    async function drawLinks(): Promise<void> {
      previewAbort?.abort();
      const controller = new context.win.AbortController();
      previewAbort = controller;
      entries.replaceChildren();
      for (const link of links) {
        const card = context.doc.createElement('div');
        card.style.cssText =
          'padding:10px;border:1px solid var(--acheron-grid-line-color);border-radius:6px;overflow-wrap:anywhere';
        const anchor = context.doc.createElement('a');
        anchor.textContent = link.text === link.href ? new URL(link.href).hostname : link.text;
        anchor.href = link.href;
        anchor.target = '_blank';
        anchor.rel = 'noopener noreferrer';
        anchor.referrerPolicy = 'no-referrer';
        anchor.setAttribute('aria-label', link.text);
        anchor.style.cssText =
          'display:flex;align-items:center;justify-content:space-between;gap:12px;color:var(--acheron-link-color);text-decoration:underline;text-underline-offset:3px';
        const icon = context.svgIcon('external-link');
        icon.setAttribute('width', '16');
        icon.setAttribute('height', '16');
        icon.setAttribute('aria-hidden', 'true');
        icon.setAttribute('style', 'flex-shrink:0');
        anchor.append(icon);
        card.append(anchor);
        const address = context.doc.createElement('div');
        address.textContent = link.href;
        address.style.cssText = 'margin-top:5px;font-size:12px;color:var(--acheron-header-text-color)';
        card.append(address);
        entries.append(card);
        if (!metadataAllowed || !previews || typeof context.options.linkPreview !== 'object') continue;
        const detail = context.doc.createElement('div');
        detail.style.cssText = 'margin-top:8px';
        detail.textContent = new URL(link.href).hostname;
        card.append(detail);
        if (typeof context.options.linkPreview !== 'object') continue;
        detail.textContent = context.t('Loading preview...');
        detail.setAttribute('role', 'status');
        const load = context.options.linkPreview.load;
        void Promise.resolve()
          .then(() => load(link.href, controller.signal))
          .then((info) => {
            if (controller.signal.aborted || menu !== popup) return;
            detail.replaceChildren();
            const title = context.doc.createElement('strong');
            title.textContent = (info.title ?? new URL(link.href).hostname).slice(0, 160);
            detail.append(title);
            if (info.description) {
              const description = context.doc.createElement('p');
              description.textContent = info.description.slice(0, 320);
              description.style.margin = '6px 0 0';
              detail.append(description);
            }
            const image = info.image && safeWebUrl(info.image);
            if (image) {
              const img = context.doc.createElement('img');
              img.crossOrigin = 'anonymous';
              img.alt = '';
              img.referrerPolicy = 'no-referrer';
              img.src = image;
              img.style.cssText = 'width:100%;max-height:140px;object-fit:cover;border-radius:4px;margin-top:8px';
              img.addEventListener('load', positionLinks, { once: true });
              detail.append(img);
            }
            positionLinks();
          })
          .catch(() => {
            if (!controller.signal.aborted && menu === popup) {
              detail.textContent = context.t('Preview unavailable. The link is still available.');
              positionLinks();
            }
          });
      }
    }
    toggle.addEventListener('click', () => {
      previews = !previews;
      toggle.textContent = previews ? context.t('Hide website details') : context.t('Show website details');
      toggle.setAttribute('aria-pressed', String(previews));
      void drawLinks();
      positionLinks();
    });
    void drawLinks();
    const close = context.doc.createElement('button');
    close.type = 'button';
    close.textContent = context.t('Close');
    close.style.cssText =
      'margin:8px;padding:6px 12px;border:1px solid var(--acheron-grid-line-color);border-radius:4px;background:var(--acheron-header-background);color:inherit;font:inherit';
    close.addEventListener('click', () => closeMenu(true));
    popup.append(close);
    popup.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        closeMenu(true);
      }
    });
    popup.addEventListener('toggle', () => {
      if (!popup.matches(':popover-open') && menu === popup) closeMenu();
    });
    context.root.append(popup);
    popup.showPopover();
    const bounds = popup.getBoundingClientRect();
    popup.style.left = `${Math.max(8, Math.min(x, context.win.innerWidth - bounds.width - 8))}px`;
    popup.style.top = `${Math.max(8, Math.min(y, context.win.innerHeight - bounds.height - 8))}px`;
    if (focus) popup.querySelector('a')?.focus();
  }
  return {
    closeMenu,
    cancelLinkPreviewHover,
    openLinks,
    get menu() {
      return menu;
    },
    set menu(value: HTMLDivElement | null) {
      menu = value;
    },
    get activeDialog() {
      return activeDialog;
    },
    set activeDialog(value: HTMLDialogElement | null) {
      activeDialog = value;
    },
    get linkHoverTimer() {
      return linkHoverTimer;
    },
    set linkHoverTimer(value: number) {
      linkHoverTimer = value;
    },
    get linkHoverKey() {
      return linkHoverKey;
    },
    set linkHoverKey(value: string) {
      linkHoverKey = value;
    },
  };
}
